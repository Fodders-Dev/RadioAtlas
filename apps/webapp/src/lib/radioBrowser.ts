import type { Station } from '../types';
import { getApiBase } from './apiBase';

const API_URLS = [
  'https://de1.api.radio-browser.info/json/stations/search',
  'https://nl1.api.radio-browser.info/json/stations/search',
  'https://fr1.api.radio-browser.info/json/stations/search',
  'https://all.api.radio-browser.info/json/stations/search'
];
const CACHE_KEY = 'radio-cache:stations:v4';
const FAST_CACHE_KEY = 'radio-cache:stations:fast:v1';
const CACHE_TTL_MS = 1000 * 60 * 30;
const PAGE_LIMIT = 10000;
const MAX_PAGES = 5;
const FAST_LIMIT = 10000;

let memoryCache: { ts: number; data: Station[] } | null = null;
let fastMemoryCache: { ts: number; data: Station[] } | null = null;

const USER_AGENT = 'FodderRadio/0.1';
const isBrowser = typeof window !== 'undefined';

const normalizeBase = (value?: string) =>
  value ? value.replace(/\/+$/, '') : '';

const asNumber = (value: unknown): number | null => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
};

const normalizeStation = (raw: Station): Station => ({
  ...raw,
  name: raw.name?.trim() || 'Unknown Station',
  url_resolved: raw.url_resolved || raw.url,
  geo_lat: asNumber(raw.geo_lat),
  geo_long: asNumber(raw.geo_long)
});

const readCache = (key: string): Station[] | null => {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as { ts: number; data: Station[] };
    if (!parsed?.ts || !Array.isArray(parsed.data)) return null;
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
};

const writeCache = (key: string, data: Station[]) => {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // ignore cache failures
  }
};

export const clearStationsCache = () => {
  memoryCache = null;
  fastMemoryCache = null;
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(FAST_CACHE_KEY);
};

type FetchMode = 'fast' | 'full';

const fetchWithTimeout = async (url: string, headers: HeadersInit, ms: number) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const fetchLocalCatalog = async (mode: FetchMode): Promise<Station[]> => {
  if (!isBrowser) return [];
  const primary = mode === 'fast' ? '/catalog-fast.json' : '/catalog-full.json';
  const fallback = mode === 'full' ? '/catalog-fast.json' : null;

  const attempt = async (path: string) => {
    try {
      const response = await fetch(path, { cache: 'no-store' });
      if (!response.ok) return [];
      return (await response.json()) as Station[];
    } catch {
      return [];
    }
  };

  const primaryData = await attempt(primary);
  if (primaryData.length) return primaryData;
  if (fallback) {
    return await attempt(fallback);
  }
  return [];
};

export const fetchStations = async ({
  mode = 'full'
}: {
  mode?: FetchMode;
} = {}): Promise<Station[]> => {
  const now = Date.now();
  if (mode === 'full') {
    if (memoryCache && now - memoryCache.ts < CACHE_TTL_MS) {
      return memoryCache.data;
    }
  } else if (fastMemoryCache && now - fastMemoryCache.ts < CACHE_TTL_MS) {
    return fastMemoryCache.data;
  }

  const cached =
    mode === 'full' ? readCache(CACHE_KEY) : readCache(FAST_CACHE_KEY);
  if (cached) {
    if (mode === 'full') {
      memoryCache = { ts: now, data: cached };
    } else {
      fastMemoryCache = { ts: now, data: cached };
    }
    return cached;
  }

  const headers: HeadersInit = {
    Accept: 'application/json'
  };

  if (!isBrowser) {
    headers['User-Agent'] = USER_AGENT;
    headers['X-User-Agent'] = USER_AGENT;
  }

  let lastError: Error | null = null;

  const fetchFromApi = async () => {
    const base = normalizeBase(getApiBase());
    if (!base) return [];
    const url = new URL(`${base}/catalog`);
    url.searchParams.set('mode', mode);
    const response = await fetchWithTimeout(url.toString(), headers, 8000);
    if (!response.ok) {
      throw new Error(`Catalog proxy error: ${response.status}`);
    }
    return (await response.json()) as Station[];
  };

  const fetchFromEndpoint = async (endpoint: string) => {
    const collected: Station[] = [];
    const maxPages = mode === 'full' ? MAX_PAGES : 1;
    const limit = mode === 'full' ? PAGE_LIMIT : FAST_LIMIT;
    for (let page = 0; page < maxPages; page += 1) {
      const url = new URL(endpoint);
      url.searchParams.set('order', 'clickcount');
      url.searchParams.set('reverse', 'true');
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('offset', String(page * limit));

      const response = await fetchWithTimeout(url.toString(), headers, 8000);
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

  let raw: Station[] = [];
  const apiBase = getApiBase();

  raw = await fetchLocalCatalog(mode);

  if (!raw.length && apiBase) {
    try {
      raw = await fetchFromApi();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Failed to fetch');
    }
  }

  if (!raw.length) {
    try {
      const tasks = API_URLS.map((endpoint) =>
        fetchFromEndpoint(endpoint).then((data) => {
          if (!data.length) {
            throw new Error('Empty response');
          }
          return data;
        })
      );
      raw = await Promise.any(tasks);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Failed to fetch');
    }
  }

  if (!raw.length) {
    raw = await fetchLocalCatalog(mode);
  }

  if (!raw.length) {
    throw lastError ?? new Error('Failed to fetch Radio Browser catalog');
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

  if (mode === 'full') {
    memoryCache = { ts: now, data: stations };
    writeCache(CACHE_KEY, stations);
  } else {
    fastMemoryCache = { ts: now, data: stations };
    writeCache(FAST_CACHE_KEY, stations);
  }
  return stations;
};
