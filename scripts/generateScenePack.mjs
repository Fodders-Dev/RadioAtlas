// Queue AI scene backgrounds for the stations a listener actually sees.
//
// Selection order is the whole point, and it lives in scripts/lib/sceneSelection.mjs:
// the catalog summary mixes RANKED shelves with RANDOM pools, and it used to be
// walked in plain object key order — which starts at `catalogPool`, a seeded
// sample over the entire ~61k catalogue re-drawn hourly. Every bootstrap pack
// spent its whole budget there.
//
// ⚠ This file is a PROGRAM: it does its work at import time and has NO `isMain`
// guard. The previous version guarded the whole body behind a comparison of
// import.meta.url against process.argv[1] so the test could import it safely.
// Node resolves an ESM entry point to its REAL path while argv[1] is only
// path.resolve()d, and the nightly job runs `cd /opt/RadioAtlas/current && node
// scripts/generateScenePack.mjs` where `current` is a SYMLINK — so that guard
// can silently evaluate false and the program exits 0 having done nothing:
// no output, no error, a green systemd unit and an unspent budget.
import {
  RANKED_SURFACES,
  selectRankedStationIds
} from './lib/sceneSelection.mjs';

const apiBase = String(process.env.RADIOATLAS_API_URL || 'http://127.0.0.1:3001')
  .trim()
  .replace(/\/+$/, '');
const token = String(process.env.INTERNAL_WEBHOOK_TOKEN || '').trim();
const requestedLimit = Number(process.env.SCENE_PACK_LIMIT || 50);
const limit = Math.min(50, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 50));
const priorityIds = String(process.env.SCENE_PACK_STATION_IDS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
// A station that already has an image resolves without spending quota, but it
// still burns one of the 50 slots in the request body. Drop those so a nightly
// run always carries a full batch of stations that actually need work.
const skipCovered = String(process.env.SCENE_PACK_SKIP_COVERED || '1').trim() !== '0';

if (!token) {
  throw new Error('INTERNAL_WEBHOOK_TOKEN is required');
}

const isCovered = async (stationId) => {
  try {
    const response = await fetch(`${apiBase}/artwork/scene/${encodeURIComponent(stationId)}`, {
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.status === 'ready';
  } catch {
    // A probe failure must never silently drop a station from the pack.
    return false;
  }
};

const cliIds = process.argv.slice(2).map((value) => value.trim()).filter(Boolean);
let candidates = cliIds;

if (!candidates.length) {
  const summaryResponse = await fetch(`${apiBase}/catalog/summary?seed=${Date.now()}`, {
    headers: { Accept: 'application/json' }
  });
  if (!summaryResponse.ok) {
    throw new Error(`catalog summary failed (${summaryResponse.status})`);
  }
  const summary = await summaryResponse.json();
  const selection = selectRankedStationIds(summary, priorityIds);
  candidates = selection.stationIds;
  console.error(
    `ranked candidates ${candidates.length} across ${RANKED_SURFACES.length} surfaces (${Object.entries(
      selection.perSurface
    )
      .map(([key, count]) => `${key}=${count}`)
      .join(' ')})`
  );
  if (selection.ignored.length) {
    console.error(
      `ignored random pools (an image there is a ~0.1% coin flip): ${selection.ignored.join(', ')}`
    );
  }
  // The summary answered but carried no ranked station at all — that is a
  // broken catalogue, not "nothing to do". Fail loudly rather than exit 0.
  if (!candidates.length) {
    throw new Error('catalog summary returned no ranked stations');
  }
}

candidates = [...new Set(candidates)];
let stationIds = candidates;

if (skipCovered && !cliIds.length) {
  let covered = 0;
  const needed = [];
  for (const stationId of candidates) {
    if (needed.length >= limit) break;
    // eslint-disable-next-line no-await-in-loop
    if (await isCovered(stationId)) covered += 1;
    else needed.push(stationId);
  }
  console.error(`already covered ${covered}; queuing ${needed.length} of ${candidates.length}`);
  stationIds = needed;
}

stationIds = stationIds.slice(0, limit);
if (!stationIds.length) {
  console.log(JSON.stringify({ items: [], note: 'every ranked station already has a scene' }));
  process.exit(0);
}

const response = await fetch(`${apiBase}/internal/artwork/scenes/generate`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Internal-Token': token
  },
  body: JSON.stringify({ stationIds })
});
const body = await response.text();
if (!response.ok) {
  throw new Error(`scene generation request failed (${response.status}): ${body}`);
}

console.log(body);
