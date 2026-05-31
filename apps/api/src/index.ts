import 'dotenv/config';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { listCatalogProfileOverrides } from './accountStore.js';
import { registerAccountRoutes } from './accountRoutes.js';
import { registerAuthRoutes } from './authRoutes.js';
import { registerBillingRoutes } from './billingRoutes.js';
import { startBillingReconcileSweep } from './billingReconciliation.js';
import { persistCatalogSnapshot, readPersistedCatalog } from './catalogCache.js';
import { registerCatalogRoutes } from './catalogRoutes.js';
import { registerMediaRoutes } from './mediaRoutes.js';
import { registerShareRoutes } from './shareRoutes.js';
import { installObservability, recordCatalogFallback } from './observability.js';
import { registerStationProfileRoutes } from './stationProfileRoutes.js';

const DEFAULT_API_URLS = [
  'https://de1.api.radio-browser.info/json/stations/search',
  'https://nl1.api.radio-browser.info/json/stations/search',
  'https://fr1.api.radio-browser.info/json/stations/search',
  'https://all.api.radio-browser.info/json/stations/search'
];

const USER_AGENT = 'RadioAtlas/1.0';
const CACHE_TTL_MS = 1000 * 60 * 30;
const PAGE_LIMIT = 10000;
const FAST_LIMIT = 10000;
// Radio Browser publishes ~80–110k stations on most days. We pull up to
// 12 pages of 10k each so the globe can paint the long tail (русские
// FM/интернет, Latam, Africa, etc.) instead of capping at the top 50k.
// Override per-deploy via CATALOG_MAX_PAGES if memory is tight.
const MAX_PAGES = Math.max(1, Number(process.env.CATALOG_MAX_PAGES) || 12);
const EXTRACTOR_URL = process.env.EXTRACTOR_URL || '';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const VK_CLIENT_ID = process.env.VK_CLIENT_ID || '';
const VK_CLIENT_SECRET = process.env.VK_CLIENT_SECRET || '';
const VK_REDIRECT_URI = process.env.VK_REDIRECT_URI || '';
const INTERNAL_WEBHOOK_TOKEN = process.env.INTERNAL_WEBHOOK_TOKEN || '';
// T0.2c: opt-out flag for the billing reconciliation sweep. Defaults
// to ENABLED. Set BILLING_RECONCILE_ENABLED=0 in tests/CI so the
// in-process setInterval doesn't fire spurious Telegram-API calls
// (the contract test triggers individual sweep cycles via
// /test/billing/trigger-reconcile instead).
const BILLING_RECONCILE_ENABLED = process.env.BILLING_RECONCILE_ENABLED !== '0';
const ENABLE_TEST_AUTH_FIXTURES = process.env.ENABLE_TEST_AUTH_FIXTURES === '1';
const NODE_ENV = process.env.NODE_ENV || 'development';
const ALLOWED_ORIGINS_RAW = process.env.ALLOWED_ORIGINS || '';
// Localhost defaults exist solely for dev convenience; production never
// falls back to them because the boot assertion below refuses to start
// with an empty ALLOWED_ORIGINS when NODE_ENV=production.
const DEV_DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174'
];

if (NODE_ENV === 'production' && !ALLOWED_ORIGINS_RAW.trim()) {
  console.error('ALLOWED_ORIGINS is required in production');
  process.exit(1);
}

// T0.7: the /test/auth/seed-conflict, /test/auth/{issue,expire,inspect}
// -session, and /test/billing/seed-purchase fixture routes can mint
// authenticated sessions and flip billing state by accountId. A
// misconfigured deploy that leaves ENABLE_TEST_AUTH_FIXTURES=1 in
// production would let anyone seed an authenticated account. The
// googleAuth / vkAuth fixture decoders also short-circuit on the same
// env var. Treat the combination as fatal at boot.
if (NODE_ENV === 'production' && ENABLE_TEST_AUTH_FIXTURES) {
  console.error(
    'ENABLE_TEST_AUTH_FIXTURES must not be set in production (NODE_ENV=production)'
  );
  process.exit(1);
}

const ALLOWED_ORIGINS = (() => {
  const parsed = ALLOWED_ORIGINS_RAW
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (parsed.length) return new Set(parsed);
  return new Set(DEV_DEFAULT_ALLOWED_ORIGINS.map((value) => value.toLowerCase()));
})();

const isAllowedOrigin = (origin: string): boolean => {
  if (!origin) return false;
  const normalised = origin.toLowerCase();
  if (normalised === 'null') return false; // sandboxed iframes, file://
  return ALLOWED_ORIGINS.has(normalised);
};
const WEBAPP_URL = process.env.WEBAPP_URL || '';
const OAUTH_TTL_MS = 1000 * 60 * 10;
const METADATA_CACHE_TTL_MS = 1000 * 15;
const METADATA_NEGATIVE_CACHE_TTL_MS = Number(process.env.METADATA_NEGATIVE_CACHE_TTL_MS || 5000);
const METADATA_PROBE_TIMEOUT_MS = Number(process.env.METADATA_PROBE_TIMEOUT_MS || 5000);
const METADATA_STREAM_TIMEOUT_MS = Number(process.env.METADATA_STREAM_TIMEOUT_MS || 7000);
const STREAM_PROXY_TIMEOUT_MS = Number(process.env.STREAM_PROXY_TIMEOUT_MS || 8000);
const FETCH_CACHE_TTL_MS = Number(process.env.FETCH_CACHE_TTL_MS || 5000);
const FETCH_NEGATIVE_CACHE_TTL_MS = Number(process.env.FETCH_NEGATIVE_CACHE_TTL_MS || 2500);
const MEDIA_RATE_LIMIT_WINDOW_MS = Number(process.env.MEDIA_RATE_LIMIT_WINDOW_MS || 60000);
const METADATA_RATE_LIMIT_PER_WINDOW = Number(process.env.METADATA_RATE_LIMIT_PER_WINDOW || 120);
const FETCH_RATE_LIMIT_PER_WINDOW = Number(process.env.FETCH_RATE_LIMIT_PER_WINDOW || 180);
const STREAM_RATE_LIMIT_PER_WINDOW = Number(process.env.STREAM_RATE_LIMIT_PER_WINDOW || 90);
const IMAGE_RATE_LIMIT_PER_WINDOW = Number(process.env.IMAGE_RATE_LIMIT_PER_WINDOW || 180);
const MEDIA_SHARED_CONCURRENCY = Number(process.env.MEDIA_SHARED_CONCURRENCY || 8);
const METADATA_CONCURRENCY = Number(process.env.METADATA_CONCURRENCY || 4);
const FETCH_CONCURRENCY = Number(process.env.FETCH_CONCURRENCY || 6);
const STREAM_CONCURRENCY = Number(process.env.STREAM_CONCURRENCY || 6);
const IMAGE_CONCURRENCY = Number(process.env.IMAGE_CONCURRENCY || 8);
const FETCH_RESPONSE_LIMIT_BYTES = Number(process.env.FETCH_RESPONSE_LIMIT_BYTES || 262144);
const CATALOG_FETCH_TIMEOUT_MS = Number(process.env.CATALOG_FETCH_TIMEOUT_MS || 8000);
// T_audit_5: when set, getCatalog serves the bundled catalogue artifact directly
// and skips the live Radio Browser fetch entirely. The contract test (which only
// asserts payload SHAPE) sets this so it is hermetic — no dependency on Radio
// Browser being reachable, no 8s×MAX_PAGES timeout chain on a cold first request
// that was blowing past the test runner's cap. Prod never sets it, so the live
// path below is untouched in production.
const CATALOG_ARTIFACT_ONLY = process.env.CATALOG_ARTIFACT_ONLY === '1';
const CATALOG_ARTIFACT_FAST_URL = new URL('../../../artifacts/catalog-fast.json', import.meta.url);
const CATALOG_ARTIFACT_FULL_URL = new URL('../../../artifacts/catalog-full.json', import.meta.url);
// T_share_3: bundled assets (Story-card fonts + static fallback PNG). `../assets/`
// resolves to apps/api/assets/ from BOTH src/index.ts (dev, tsx) and
// dist/index.js (prod, tsup bundle) — src and dist are siblings under apps/api.
const ASSETS_DIR = new URL('../assets/', import.meta.url);
const API_URLS = String(process.env.RADIO_BROWSER_URLS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const RADIO_BROWSER_URLS = API_URLS.length ? API_URLS : DEFAULT_API_URLS;

type Station = {
  stationuuid: string;
  name: string;
  url: string;
  url_resolved: string;
  homepage: string;
  favicon: string;
  tags: string;
  country: string;
  countrycode: string;
  state: string;
  language: string;
  codec: string;
  bitrate: number;
  geo_lat: number | null;
  geo_long: number | null;
  stationArtwork?: string | null;
  isClaimed?: boolean;
  isVerified?: boolean;
  promoted?: boolean;
  description?: string | null;
  websiteUrl?: string | null;
  scheduleNote?: string | null;
};

type CacheEntry = {
  ts: number;
  data: Station[];
};

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

const corsHeaders = (req: express.Request, res: express.Response) => {
  const rawOrigin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
  if (!rawOrigin) {
    // No Origin header -> non-CORS request (curl, server-to-server, k8s
    // liveness probes). Browsers will treat the response as same-origin.
    return;
  }
  // Always Vary on Origin once we've inspected it so an intermediate cache
  // (Caddy, CDN, Express trust-proxy chains) does not serve a no-ACAO
  // response back to a different, allow-listed origin.
  res.setHeader('Vary', 'Origin');
  if (!isAllowedOrigin(rawOrigin)) {
    return;
  }
  res.setHeader('Access-Control-Allow-Origin', rawOrigin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Authorization, X-Internal-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Length, Content-Range, Accept-Ranges, Content-Type'
  );
};

app.use((req, res, next) => {
  corsHeaders(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});
installObservability(app);

let fastCache: CacheEntry | null = null;
let fullCache: CacheEntry | null = null;

const cacheCatalog = (mode: 'fast' | 'full', data: Station[]) => {
  const entry = { ts: Date.now(), data };
  if (mode === 'fast') {
    fastCache = entry;
  } else {
    fullCache = entry;
  }
  return data;
};

const normalizeStation = (raw: Station): Station => {
  // Radio Browser ships lastcheckok as 0 or 1 plus an ISO date.
  // Normalise to a numeric flag + epoch ms so consumers don't
  // re-parse strings on every render. Falls back to undefined if
  // the field is absent (artifact from before this column existed).
  const rawLast = raw as Station & {
    lastcheckok?: 0 | 1 | string;
    lastchecktime_iso8601?: string | null;
    lastlocalchecktime_iso8601?: string | null;
  };
  const lastcheckokRaw = rawLast.lastcheckok;
  const lastcheckok =
    lastcheckokRaw === 1 || lastcheckokRaw === '1'
      ? 1
      : lastcheckokRaw === 0 || lastcheckokRaw === '0'
        ? 0
        : undefined;
  const lastIso =
    rawLast.lastchecktime_iso8601 || rawLast.lastlocalchecktime_iso8601 || null;
  const lastcheckokAt = lastIso ? Date.parse(lastIso) : null;
  return {
    ...raw,
    name: raw.name?.trim() || 'Unknown Station',
    url_resolved: raw.url_resolved || raw.url,
    geo_lat: asNumber(raw.geo_lat),
    geo_long: asNumber(raw.geo_long),
    ...(lastcheckok !== undefined ? { lastcheckok } : {}),
    ...(lastcheckokAt && Number.isFinite(lastcheckokAt)
      ? { lastcheckok_at: lastcheckokAt }
      : {})
  };
};

const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized === 'null' || normalized === 'undefined') {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const fetchWithTimeout = async (url: string, ms: number) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        'X-User-Agent': USER_AGENT
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
};

const fetchFromEndpoint = async (endpoint: string, limit: number, maxPages: number) => {
  const collected: Station[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(endpoint);
    url.searchParams.set('order', 'clickcount');
    url.searchParams.set('reverse', 'true');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(page * limit));

    const response = await fetchWithTimeout(url.toString(), CATALOG_FETCH_TIMEOUT_MS);
    if (!response.ok) {
      throw new Error(`Radio Browser error: ${response.status}`);
    }
    const raw = (await response.json()) as Station[];
    collected.push(...raw);
    if (raw.length < limit) {
      break;
    }
  }
  return collected;
};

const readCatalogArtifact = async (mode: 'fast' | 'full') => {
  const target = mode === 'fast' ? CATALOG_ARTIFACT_FAST_URL : CATALOG_ARTIFACT_FULL_URL;
  const raw = await readFile(target, 'utf8');
  const parsed = JSON.parse(raw) as Station[];
  return parsed.map(normalizeStation).filter((station) => Boolean(station.url_resolved));
};

const readCatalogSnapshot = async (mode: 'fast' | 'full') => {
  const parsed = await readPersistedCatalog<Station>(mode);
  return parsed.map(normalizeStation).filter((station) => Boolean(station.url_resolved));
};

const getCatalog = async (mode: 'fast' | 'full') => {
  const cache = mode === 'fast' ? fastCache : fullCache;
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return cache.data;
  }

  // T_audit_5: artifact-only mode — the bundled artifact IS the configured
  // source here, not a fallback, so we skip the live fetch and do NOT record a
  // catalog_fallback counter. Same normalization as the fallback path below
  // (readCatalogArtifact → normalizeStation → cacheCatalog), so the summary the
  // contract test validates is prod-shaped, not raw artifact.
  if (CATALOG_ARTIFACT_ONLY) {
    return cacheCatalog(mode, await readCatalogArtifact(mode));
  }

  const limit = mode === 'fast' ? FAST_LIMIT : PAGE_LIMIT;
  const maxPages = mode === 'fast' ? 1 : MAX_PAGES;

  let raw: Station[] = [];
  const tasks = RADIO_BROWSER_URLS.map((endpoint) =>
    fetchFromEndpoint(endpoint, limit, maxPages).then((data) => {
      if (!data.length) {
        throw new Error('Empty response');
      }
      return data;
    })
  );

  try {
    raw = await Promise.any(tasks);
  } catch (networkError) {
    try {
      recordCatalogFallback('snapshot');
      return cacheCatalog(mode, await readCatalogSnapshot(mode));
    } catch {
      try {
        const artifactStations = await readCatalogArtifact(mode);
        recordCatalogFallback('artifact');
        void persistCatalogSnapshot(mode, artifactStations);
        return cacheCatalog(mode, artifactStations);
      } catch {
        throw networkError;
      }
    }
  }

  const byId = new Map<string, Station>();
  raw.forEach((item) => {
    if (!item?.stationuuid) return;
    if (!byId.has(item.stationuuid)) {
      byId.set(item.stationuuid, item);
    }
  });

  const stations = Array.from(byId.values())
    .map(normalizeStation)
    .filter((station) => Boolean(station.url_resolved));

  void persistCatalogSnapshot(mode, stations);
  return cacheCatalog(mode, stations);
};

const withStationProfiles = async (stations: Station[]) => {
  const profiles = await listCatalogProfileOverrides();
  if (!profiles.length) return stations;
  const byId = new Map(profiles.map((profile) => [profile.stationuuid, profile]));
  return stations.map((station) => {
    const profile = byId.get(station.stationuuid);
    if (!profile) return station;
    return {
      ...station,
      stationArtwork: profile.artworkUrl || station.favicon || '',
      isClaimed: Boolean(profile.ownerAccountId),
      isVerified: profile.isVerified,
      promoted: profile.isPromoted && (!profile.promotedUntil || profile.promotedUntil > Date.now()),
      description: profile.description,
      websiteUrl: profile.websiteUrl || station.homepage,
      scheduleNote: profile.scheduleNote
    };
  });
};

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

registerAuthRoutes(app, {
  telegramBotToken: TELEGRAM_BOT_TOKEN,
  googleClientId: GOOGLE_CLIENT_ID,
  vkClientId: VK_CLIENT_ID,
  vkClientSecret: VK_CLIENT_SECRET,
  vkRedirectUri: VK_REDIRECT_URI,
  oauthTtlMs: OAUTH_TTL_MS,
  webappUrl: WEBAPP_URL,
  enableTestAuthFixtures: ENABLE_TEST_AUTH_FIXTURES,
  nodeEnv: NODE_ENV
});
registerAccountRoutes(app);
registerBillingRoutes(app, {
  telegramBotToken: TELEGRAM_BOT_TOKEN,
  internalWebhookToken: INTERNAL_WEBHOOK_TOKEN,
  enableTestAuthFixtures: ENABLE_TEST_AUTH_FIXTURES,
  nodeEnv: NODE_ENV
});
registerStationProfileRoutes(app);
const catalogService = registerCatalogRoutes(app, {
  getCatalog,
  withStationProfiles
});
// T_share_3 (PR-A): the Story-card endpoint. Resolves the station via the warm
// catalog (getStationById is ~16ms post-#43); render/SSRF/cache live in the
// share/* modules. The native render dep is lazy-loaded there so a bad binary
// degrades only this endpoint, not boot.
registerShareRoutes(app, {
  getStationById: (id) => catalogService.getStationById(id),
  assetsDir: ASSETS_DIR,
  userAgent: USER_AGENT
});
registerMediaRoutes(app, {
  userAgent: USER_AGENT,
  extractorUrl: EXTRACTOR_URL,
  metadataCacheTtlMs: METADATA_CACHE_TTL_MS,
  metadataNegativeCacheTtlMs: METADATA_NEGATIVE_CACHE_TTL_MS,
  metadataProbeTimeoutMs: METADATA_PROBE_TIMEOUT_MS,
  metadataStreamTimeoutMs: METADATA_STREAM_TIMEOUT_MS,
  fetchCacheTtlMs: FETCH_CACHE_TTL_MS,
  fetchNegativeCacheTtlMs: FETCH_NEGATIVE_CACHE_TTL_MS,
  upstreamTimeoutMs: STREAM_PROXY_TIMEOUT_MS,
  metadataRateLimitPerWindow: METADATA_RATE_LIMIT_PER_WINDOW,
  fetchRateLimitPerWindow: FETCH_RATE_LIMIT_PER_WINDOW,
  streamRateLimitPerWindow: STREAM_RATE_LIMIT_PER_WINDOW,
  imageRateLimitPerWindow: IMAGE_RATE_LIMIT_PER_WINDOW,
  rateLimitWindowMs: MEDIA_RATE_LIMIT_WINDOW_MS,
  metadataConcurrency: METADATA_CONCURRENCY,
  fetchConcurrency: FETCH_CONCURRENCY,
  streamConcurrency: STREAM_CONCURRENCY,
  imageConcurrency: IMAGE_CONCURRENCY,
  sharedConcurrency: MEDIA_SHARED_CONCURRENCY,
  fetchResponseLimitBytes: FETCH_RESPONSE_LIMIT_BYTES
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  console.log(`RadioAtlas API on ${port}`);
});

// T_api_bootwarm: prime the profiled 'full' catalog in the BACKGROUND right after
// listen, before real user traffic. The first getProfiledCatalog('full') parses
// the ~57k catalogue and runs the withStationProfiles map synchronously (a ~1s
// event-loop block); doing it now — with no concurrent user load — means the
// cold-boot /catalog/summary + /catalog/stations/<uuid> burst hits a warm cache
// and returns 200 instead of Caddy 503-ing a blocked upstream. Both endpoints go
// through getProfiledCatalog('full'), so warming the SERVICE path (not just the
// raw getCatalog dependency) primes the raw cache, the profiled cache, AND the
// profile map — the full block.
//
// NOT awaited before listen, and /health is a trivial route, so the deploy
// healthcheck poll is unaffected (it rides through the one-time ~1s parse via
// retries). Only 'full' is warmed: every route uses it; nothing routes to 'fast'
// (the webapp loads catalog-fast.json as a static file), and warming it would
// just double the boot transient with a second parse.
//
// Failure is non-fatal — the catalog lazy-loads on first request as before, with
// the #40 deep-link retry covering the residual race.
//
// Residual (follow-up, not fixed here): CACHE_TTL_MS is 30 min, so the cache
// re-expires and the next request after 30 min of inactivity re-triggers the
// parse (a single-request ~1s transient; the #40 retry covers any concurrent
// burst). A periodic re-warm isn't trivially clean — at the 29-min mark the
// cache is still fresh so a re-call is a no-op cache hit, and forcing a refresh
// before expiry would need a cache-bypass flag threaded through getCatalog /
// getProfiledCatalog. Deferred.
void (async () => {
  try {
    await catalogService.getCatalog('full');
    // T_api_summary_cache: also pre-compute the current hourly summary bucket so
    // the first cold visitor post-deploy hits a warm summary, not just a warm
    // catalog (the summary's ~0.85s build is the bigger block).
    await catalogService.getSummary(Date.now());
    console.log('Catalog warm complete');
  } catch (error) {
    console.warn('Catalog warm failed; will lazy-load on first request', error);
  }
})();

// T0.2c: start the billing reconciliation sweep after the API is
// listening. Single-instance assumption (RUNBOOK); see
// billingReconciliation.ts header for the cluster-mode notes.
// Disable via BILLING_RECONCILE_ENABLED=0 for tests/CI or for
// emergency stop. Skips silently if no bot token is wired (the
// reconciliation path requires `getStarTransactions` against the
// Telegram Bot API).
if (BILLING_RECONCILE_ENABLED && TELEGRAM_BOT_TOKEN) {
  startBillingReconcileSweep({ botToken: TELEGRAM_BOT_TOKEN });
  console.log('Billing reconciliation sweep started');
} else if (BILLING_RECONCILE_ENABLED) {
  console.warn(
    'BILLING_RECONCILE_ENABLED but TELEGRAM_BOT_TOKEN/BOT_TOKEN is missing - sweep skipped'
  );
}
