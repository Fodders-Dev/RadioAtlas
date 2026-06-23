// One-shot metadata harvester (station-intelligence). Reads the catalog
// artifact, picks a batch of reachable stations, probes each via OUR
// /api/metadata (status-JSON-first + ICY + radiovanya + capped cache — we never
// touch the origins directly), and writes observations + a supports_metadata
// flag + last_harvested_at to station-intelligence.sqlite. Concurrency, a global
// rate floor, per-request spacing, 429/Retry-After and a consecutive-failure
// circuit breaker keep it polite + bounded; the one-shot exit bounds memory.
//
// ROTATION: default HARVEST_ORDER=stale = least-recently-harvested-first
// (never-probed → oldest), so each run takes a FRESH slice and the whole
// reachable catalog is covered over many runs. HARVEST_ORDER=quality keeps the
// old top-by-quality behaviour.
//
// SAFE-FIRST / GATED OFF: refuses to run unless HARVESTER_ENABLED=1. The pm2
// cron app (ecosystem.config.cjs → radioatlas-harvester) ships with
// HARVESTER_ENABLED=0, so merge + deploy is INERT — Artem enables it manually.
//
// Manual run (repo root, api up on the box):
//   HARVESTER_ENABLED=1 HARVEST_LIMIT=100 \
//   STATION_INTEL_DB_PATH=/abs/shared/data/station-intelligence.sqlite \
//   API_BASE=http://localhost:3001 \
//   npx tsx scripts/harvestMetadata.mjs
//
// Enable the hourly cron (after the manual validation run looks good):
//   1) edit ecosystem.config.cjs → radioatlas-harvester env HARVESTER_ENABLED:'1'
//   2) pm2 startOrRestart ecosystem.config.cjs --only radioatlas-harvester
//   3) watch:  pm2 logs radioatlas-harvester   (a tripped breaker → [HARVEST-ALERT] on stderr)
//   Disable again: set it back to '0' + restart.

import 'dotenv/config'; // pm2 cron app runs with cwd=apps/api → loads the shared api.env
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  harvestQualityScore,
  runHarvestBatch,
  selectHarvestBatch
} from '../apps/api/src/intel/harvestPipeline.js';
import {
  OBSERVATION_RETENTION_MS,
  openStationIntelStore,
  resolveStationIntelDbPath
} from '../apps/api/src/intel/stationIntelDb.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const env = (key, fallback) => {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
};
const num = (key, fallback) => {
  const parsed = Number(env(key, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const HARVESTER_ENABLED = env('HARVESTER_ENABLED', '0') === '1';
// On the box the api listens on PORT (3001 via ecosystem) and /metadata is at
// the ROOT (no /api prefix). The cron app sets API_BASE=http://localhost:3001.
const API_BASE = env('API_BASE', 'http://localhost:4311').replace(/\/+$/, '');
const CATALOG_PATH = env('CATALOG_PATH', join(ROOT, 'artifacts', 'catalog-full.json'));
const LIMIT = num('HARVEST_LIMIT', 500);
const ORDER = env('HARVEST_ORDER', 'stale') === 'quality' ? 'quality' : 'stale';
const CONCURRENCY = Math.min(3, num('HARVEST_CONCURRENCY', 2));
const PAUSE_MS = num('HARVEST_PAUSE_MS', 400);
const MIN_INTERVAL_MS = num('HARVEST_MIN_INTERVAL_MS', 300);
const FAIL_LIMIT = num('HARVEST_FAIL_LIMIT', 8);
const REQUEST_TIMEOUT_MS = num('HARVEST_REQUEST_TIMEOUT_MS', 15_000);
// A contactable User-Agent (ToS-polite — identifies us + how to reach us).
const USER_AGENT = env(
  'HARVEST_USER_AGENT',
  'RadioAtlasHarvester/0.1 (+https://radioatlas.duckdns.org; contact: ahjkuio@gmail.com)'
);

const log = (msg) => console.log(`[harvest] ${msg}`);

if (!HARVESTER_ENABLED) {
  log('HARVESTER_ENABLED is not 1 — refusing to run (set HARVESTER_ENABLED=1 to harvest). No-op.');
  process.exit(0);
}

const main = async () => {
  log(`db=${resolveStationIntelDbPath()}`);
  log(
    `api=${API_BASE} catalog=${CATALOG_PATH} order=${ORDER} limit=${LIMIT} ` +
      `concurrency=${CONCURRENCY} pause=${PAUSE_MS}ms minInterval=${MIN_INTERVAL_MS}ms`
  );

  // Open the store first so rotation can read each station's last_harvested_at.
  const store = await openStationIntelStore();
  const harvestedAt = store.harvestedAtMap();
  log(`already-harvested stations on record: ${harvestedAt.size}`);

  const raw = await readFile(CATALOG_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const stations = Array.isArray(parsed) ? parsed : parsed.stations || parsed.items || [];
  log(`catalog stations: ${stations.length}`);

  const candidates = stations
    .filter((s) => s && s.stationuuid && s.url_resolved)
    .map((s) => ({
      stationUuid: s.stationuuid,
      urlResolved: s.url_resolved,
      lastcheckok: s.lastcheckok,
      quality: harvestQualityScore(s),
      // null (absent) → never harvested → sorts FIRST in 'stale' rotation.
      lastHarvestedAt: harvestedAt.has(s.stationuuid) ? harvestedAt.get(s.stationuuid) : null
    }));
  const batch = selectHarvestBatch(candidates, { limit: LIMIT, order: ORDER });
  log(`selected batch: ${batch.length} reachable stations (${ORDER}-ordered)`);
  if (!batch.length) {
    log('nothing to harvest.');
    store.close();
    process.exit(0);
  }

  const fetchMetadata = async (urlResolved) => {
    try {
      const res = await fetch(`${API_BASE}/metadata?url=${encodeURIComponent(urlResolved)}`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after')) || 1;
        return { status: 429, title: null, retryAfterMs: retryAfter * 1000 };
      }
      // /api/metadata returns 404 + {error} when there's simply no title — that
      // is a valid "checked, no metadata" outcome, NOT a circuit-breaker failure.
      if (res.status !== 200) return { status: res.status, title: null };
      const body = await res.json().catch(() => null);
      return { status: 200, title: body && typeof body.title === 'string' ? body.title : null };
    } catch {
      return { status: 599, title: null }; // network/timeout → counts as a failure
    }
  };

  const summary = await runHarvestBatch(batch, {
    fetchMetadata,
    store,
    now: () => Date.now(),
    concurrency: CONCURRENCY,
    perRequestPauseMs: PAUSE_MS,
    minRequestIntervalMs: MIN_INTERVAL_MS,
    consecutiveFailLimit: FAIL_LIMIT,
    log,
    // Make a tripped breaker LOUD on stderr so it stands out in the pm2 logs.
    onAlert: (msg) => console.error(`[harvest] ${msg}`)
  });

  const pruned = store.pruneObservations(Date.now(), OBSERVATION_RETENTION_MS);
  store.close();

  log(
    `done: processed=${summary.processed} withTitle=${summary.withTitle} ` +
      `withoutTitle=${summary.withoutTitle} recorded=${summary.recorded} ` +
      `failures=${summary.failures} tripped=${summary.tripped} pruned=${pruned}`
  );
  if (summary.tripped) {
    console.error('[harvest] [HARVEST-ALERT] run stopped by the circuit breaker — investigate upstream (429s/5xx) before re-running.');
    process.exit(2);
  }
};

main().catch((error) => {
  console.error('[harvest] fatal:', error);
  process.exit(1);
});
