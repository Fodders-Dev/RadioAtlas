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
const PAGE_LIMIT = 20000;
const MAX_PAGES = 8;
const FAST_LIMIT = 10000;

// ... (lines 17-152)

const fetchFromEndpoint = async (endpoint: string) => {
  const collected: Station[] = [];
  const maxPages = mode === 'full' ? MAX_PAGES : 1;
  const limit = mode === 'full' ? PAGE_LIMIT : FAST_LIMIT;
  const timeoutVal = mode === 'full' ? 25000 : 8000;

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(endpoint);
    url.searchParams.set('order', 'clickcount');
    url.searchParams.set('reverse', 'true');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(page * limit));

    try {
      const response = await fetchWithTimeout(url.toString(), headers, timeoutVal);
      if (!response.ok) {
        if (collected.length > 0) break; // Return what we have
        throw new Error(`Radio Browser error: ${response.status}`);
      }
      const raw = (await response.json()) as Station[];
      collected.push(...raw);
      if (raw.length < limit) {
        break; // End of list
      }
    } catch (err) {
      if (collected.length > 0) break; // Return partial data on error
      throw err;
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
