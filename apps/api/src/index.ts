import 'dotenv/config';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { listCatalogProfileOverrides } from './accountStore.js';
import { registerAccountRoutes } from './accountRoutes.js';
import { registerAuthRoutes } from './authRoutes.js';
import { registerBillingRoutes } from './billingRoutes.js';
import { persistCatalogSnapshot, readPersistedCatalog } from './catalogCache.js';
import { registerCatalogRoutes } from './catalogRoutes.js';
import { registerMediaRoutes } from './mediaRoutes.js';
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
const MAX_PAGES = 5;
const EXTRACTOR_URL = process.env.EXTRACTOR_URL || '';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const VK_CLIENT_ID = process.env.VK_CLIENT_ID || '';
const VK_CLIENT_SECRET = process.env.VK_CLIENT_SECRET || '';
const VK_REDIRECT_URI = process.env.VK_REDIRECT_URI || '';
const ENABLE_TEST_AUTH_FIXTURES = process.env.ENABLE_TEST_AUTH_FIXTURES === '1';
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
const MEDIA_SHARED_CONCURRENCY = Number(process.env.MEDIA_SHARED_CONCURRENCY || 8);
const METADATA_CONCURRENCY = Number(process.env.METADATA_CONCURRENCY || 4);
const FETCH_CONCURRENCY = Number(process.env.FETCH_CONCURRENCY || 6);
const FETCH_RESPONSE_LIMIT_BYTES = Number(process.env.FETCH_RESPONSE_LIMIT_BYTES || 262144);
const CATALOG_FETCH_TIMEOUT_MS = Number(process.env.CATALOG_FETCH_TIMEOUT_MS || 8000);
const CATALOG_ARTIFACT_FAST_URL = new URL('../../../artifacts/catalog-fast.json', import.meta.url);
const CATALOG_ARTIFACT_FULL_URL = new URL('../../../artifacts/catalog-full.json', import.meta.url);
const API_URLS = String(process.env.RADIO_BROWSER_URLS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const BLOCKED_HOSTS = [
  'youtube.com',
  'youtu.be',
  'music.youtube.com',
  'youtube-nocookie.com'
];

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

const corsHeaders = (res: express.Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Length, Content-Range, Accept-Ranges, Content-Type'
  );
};

app.use((req, res, next) => {
  corsHeaders(res);
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

const normalizeStation = (raw: Station): Station => ({
  ...raw,
  name: raw.name?.trim() || 'Unknown Station',
  url_resolved: raw.url_resolved || raw.url,
  geo_lat: asNumber(raw.geo_lat),
  geo_long: asNumber(raw.geo_long)
});

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

const getHost = (value: string) => {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return '';
  }
};

const isBlockedHost = (value: string) =>
  BLOCKED_HOSTS.some((host) => getHost(value).includes(host));

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
  enableTestAuthFixtures: ENABLE_TEST_AUTH_FIXTURES
});
registerAccountRoutes(app);
registerBillingRoutes(app, {
  telegramBotToken: TELEGRAM_BOT_TOKEN
});
registerStationProfileRoutes(app);
registerCatalogRoutes(app, {
  getCatalog,
  withStationProfiles
});
registerMediaRoutes(app, {
  userAgent: USER_AGENT,
  extractorUrl: EXTRACTOR_URL,
  blockedHosts: BLOCKED_HOSTS,
  metadataCacheTtlMs: METADATA_CACHE_TTL_MS,
  metadataNegativeCacheTtlMs: METADATA_NEGATIVE_CACHE_TTL_MS,
  metadataProbeTimeoutMs: METADATA_PROBE_TIMEOUT_MS,
  metadataStreamTimeoutMs: METADATA_STREAM_TIMEOUT_MS,
  fetchCacheTtlMs: FETCH_CACHE_TTL_MS,
  fetchNegativeCacheTtlMs: FETCH_NEGATIVE_CACHE_TTL_MS,
  upstreamTimeoutMs: STREAM_PROXY_TIMEOUT_MS,
  metadataRateLimitPerWindow: METADATA_RATE_LIMIT_PER_WINDOW,
  fetchRateLimitPerWindow: FETCH_RATE_LIMIT_PER_WINDOW,
  rateLimitWindowMs: MEDIA_RATE_LIMIT_WINDOW_MS,
  metadataConcurrency: METADATA_CONCURRENCY,
  fetchConcurrency: FETCH_CONCURRENCY,
  sharedConcurrency: MEDIA_SHARED_CONCURRENCY,
  fetchResponseLimitBytes: FETCH_RESPONSE_LIMIT_BYTES
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  console.log(`RadioAtlas API on ${port}`);
});
