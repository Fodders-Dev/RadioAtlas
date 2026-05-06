import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_URLS = [
  'https://de1.api.radio-browser.info/json/stations/search',
  'https://nl1.api.radio-browser.info/json/stations/search',
  'https://fr1.api.radio-browser.info/json/stations/search',
  'https://all.api.radio-browser.info/json/stations/search'
];

const USER_AGENT = 'RadioAtlas/1.0';
const FAST_LIMIT = Number(process.env.FAST_LIMIT || 10000);
const FULL_LIMIT = Number(process.env.FULL_LIMIT || 10000);
// Radio Browser publishes ~55k stations as of 2026; capping at 5 pages
// (=50k) was visibly clipping the long tail. 12 pages × 10k = 120k upper
// bound covers the whole catalog with margin while the loop still bails
// on the first short page so we don't burn quota.
const FULL_PAGES = Number(process.env.FULL_PAGES || 12);
const MODE = (process.env.MODE || 'both').toLowerCase();
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');

const FAST_OUTPUT =
  process.env.FAST_OUTPUT ||
  join(ROOT_DIR, 'artifacts', 'catalog-fast.json');
const FULL_OUTPUT =
  process.env.FULL_OUTPUT ||
  join(ROOT_DIR, 'artifacts', 'catalog-full.json');

const asNumber = (value) => {
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

const pickStation = (raw) => {
  // Carry Radio Browser's own stream-health signal through into our
  // artifact so the recommender can demote known-broken stations
  // without our user having to click them first. Stripped to a
  // numeric flag + ISO string to keep the artifact compact.
  const lastcheckokRaw = raw.lastcheckok;
  const lastcheckok =
    lastcheckokRaw === 1 || lastcheckokRaw === '1'
      ? 1
      : lastcheckokRaw === 0 || lastcheckokRaw === '0'
        ? 0
        : undefined;
  const lastIso =
    raw.lastchecktime_iso8601 || raw.lastlocalchecktime_iso8601 || null;
  return {
    stationuuid: raw.stationuuid,
    name: raw.name || 'Unknown Station',
    url: raw.url || raw.url_resolved || '',
    url_resolved: raw.url_resolved || raw.url || '',
    homepage: raw.homepage || '',
    favicon: raw.favicon || '',
    tags: raw.tags || '',
    country: raw.country || '',
    countrycode: raw.countrycode || '',
    state: raw.state || '',
    language: raw.language || '',
    codec: raw.codec || '',
    bitrate: Number(raw.bitrate || 0),
    geo_lat: asNumber(raw.geo_lat),
    geo_long: asNumber(raw.geo_long),
    ...(lastcheckok !== undefined ? { lastcheckok } : {}),
    ...(lastIso ? { lastchecktime_iso8601: lastIso } : {})
  };
};

const fetchFromEndpoint = async (endpoint, limit, pages) => {
  const collected = [];
  for (let page = 0; page < pages; page += 1) {
    const url = new URL(endpoint);
    url.searchParams.set('order', 'clickcount');
    url.searchParams.set('reverse', 'true');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(page * limit));

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        'X-User-Agent': USER_AGENT
      }
    });

    if (!response.ok) {
      throw new Error(`Radio Browser error: ${response.status}`);
    }

    const pageData = await response.json();
    collected.push(...pageData);
    if (!pageData.length || pageData.length < limit) {
      break;
    }
  }
  return collected;
};

const fetchCatalog = async (limit, pages) => {
  const tasks = API_URLS.map((endpoint) =>
    fetchFromEndpoint(endpoint, limit, pages).then((data) => {
      if (!Array.isArray(data) || !data.length) {
        throw new Error('Empty response');
      }
      return data;
    })
  );

  const raw = await Promise.any(tasks);
  const byId = new Map();
  raw.forEach((item) => {
    if (!item?.stationuuid) return;
    if (!byId.has(item.stationuuid)) {
      byId.set(item.stationuuid, pickStation(item));
    }
  });

  return Array.from(byId.values()).filter((station) => station.url_resolved);
};

const writeCatalog = async (output, stations) => {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(stations), 'utf8');
  console.log(`Saved ${stations.length} stations to ${output}`);
};

const main = async () => {
  if (MODE === 'fast' || MODE === 'both') {
    const stations = await fetchCatalog(FAST_LIMIT, 1);
    await writeCatalog(FAST_OUTPUT, stations);
  }

  if (MODE === 'full' || MODE === 'both') {
    const stations = await fetchCatalog(FULL_LIMIT, FULL_PAGES);
    await writeCatalog(FULL_OUTPUT, stations);
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
