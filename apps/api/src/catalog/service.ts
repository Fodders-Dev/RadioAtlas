export type CatalogStation = {
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
  // Upstream Radio Browser stream-check signal. 1/0 if known,
  // undefined if the artifact predates this column.
  lastcheckok?: 0 | 1;
  // Epoch ms — when Radio Browser last performed the check.
  lastcheckok_at?: number | null;
  stationArtwork?: string | null;
  isClaimed?: boolean;
  isVerified?: boolean;
  promoted?: boolean;
  description?: string | null;
  websiteUrl?: string | null;
  scheduleNote?: string | null;
  // Radio Browser community/popularity signals, carried through unchanged from
  // the upstream artifact. votes = cumulative community votes; clicktrend =
  // recent click momentum ("rising"); clickcount = total clicks. Used to build
  // the Trending / Top-voted discovery rails (T2.21). Optional because older
  // artifacts may predate these columns.
  votes?: number;
  clicktrend?: number;
  clickcount?: number;
};

export type CatalogDependencies = {
  getCatalog: (mode: 'fast' | 'full') => Promise<CatalogStation[]>;
  withStationProfiles: (stations: CatalogStation[]) => Promise<CatalogStation[]>;
};

type CatalogSpotlight = {
  label: string;
  stations: ReturnType<typeof toStationLite>[];
};

type CatalogSearchFilters = {
  q: string;
  country: string;
  language: string;
  tag: string;
  continent: string;
  limit: number;
  cursor: number;
};

const PROFILE_CACHE_TTL_MS = 1000 * 60 * 5;
const GENERIC_STATE_KEYS = new Set([
  '',
  'unknown',
  'unknown location',
  'web',
  'the russian federation',
  'russia',
  'pangea'
]);

let profiledFastCache: { ts: number; data: CatalogStation[] } | null = null;
let profiledFullCache: { ts: number; data: CatalogStation[] } | null = null;

const toStationLite = (station: CatalogStation) => ({
  stationuuid: station.stationuuid,
  name: station.name,
  url: station.url,
  url_resolved: station.url_resolved,
  homepage: station.homepage || '',
  favicon: station.favicon || '',
  country: station.country || '',
  state: station.state || '',
  tags: station.tags || '',
  geo_lat: station.geo_lat ?? null,
  geo_long: station.geo_long ?? null,
  lastcheckok: station.lastcheckok,
  lastcheckok_at: station.lastcheckok_at ?? null,
  stationArtwork: station.stationArtwork || null,
  isClaimed: station.isClaimed,
  isVerified: station.isVerified,
  promoted: station.promoted,
  description: station.description || null,
  websiteUrl: station.websiteUrl || null,
  scheduleNote: station.scheduleNote || null
});

const normalizeText = (value?: string | null) =>
  value
    ?.trim()
    .replace(/\s+/g, ' ')
    .replace(/\(.*?\)/g, ' ')
    .trim() || '';

const normalizeKey = (value?: string | null) => normalizeText(value).toLowerCase();

const hasUsefulState = (state?: string | null, country?: string | null) => {
  const stateKey = normalizeKey(state);
  if (!stateKey || GENERIC_STATE_KEYS.has(stateKey)) return false;
  const countryKey = normalizeKey(country);
  return stateKey !== countryKey;
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

const toContinent = (lat: number, lon: number) => {
  if (lat <= -60) return 'Antarctica';
  if (lat >= 15 && lon >= -170 && lon <= -20) return 'North America';
  if (lat < 15 && lon >= -95 && lon <= -30) return 'South America';
  if (lat >= 35 && lon >= -25 && lon <= 45) return 'Europe';
  if (lat >= -35 && lon >= -20 && lon <= 55) return 'Africa';
  if (lon >= 110 && lat < 0) return 'Oceania';
  if (lon >= 40 && lon <= 180 && lat >= -10) return 'Asia';
  if (lon >= -10 && lon <= 55 && lat >= 0) return 'Europe';
  if (lon <= -20) return lat >= 0 ? 'North America' : 'South America';
  return 'Other';
};

const resolveContinent = (station: CatalogStation) => {
  const lat = asNumber(station.geo_lat);
  const lon = asNumber(station.geo_long);
  if (lat === null || lon === null) {
    return 'Other';
  }
  return toContinent(lat, lon);
};

const bucketSizeForZoom = (zoomLevel: number) => {
  if (zoomLevel >= 7) return 0.35;
  if (zoomLevel >= 5) return 0.55;
  if (zoomLevel >= 3.2) return 0.8;
  if (zoomLevel >= 2.4) return 1.2;
  if (zoomLevel >= 1.6) return 2.4;
  if (zoomLevel >= 1.1) return 5;
  return 10;
};

const bucketKeyForCoords = (lat: number, lon: number, bucketSize: number) => {
  const latBucket = Math.round((lat + 90) / bucketSize);
  const lonSpan = bucketSize / Math.max(0.42, Math.cos((Math.abs(lat) * Math.PI) / 180));
  const lonBucket = Math.round((lon + 180) / lonSpan);
  return `${bucketSize}:${latBucket}:${lonBucket}`;
};

export const parseCursor = (value: unknown) => {
  const raw = typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
};

export const parseLimit = (value: unknown, fallback: number, max = 100) => {
  const raw = typeof value === 'string' ? Number(value) : fallback;
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(Math.max(1, Math.floor(raw)), max);
};

export const normalizeQuery = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

export const normalizeCatalogText = (value: unknown) =>
  normalizeText(typeof value === 'string' ? value : '');

const mulberry32 = (seed: number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const seededSample = (stations: CatalogStation[], seed: number, limit: number) => {
  const random = mulberry32(seed);
  return [...stations]
    .map((station) => ({ station, score: random() }))
    .sort((left, right) => left.score - right.score)
    .slice(0, limit)
    .map(({ station }) => toStationLite(station));
};

const sortByTopSignal = (stations: CatalogStation[]) =>
  [...stations].sort((left, right) => {
    const leftScore = Number(Boolean(left.promoted)) * 4 + Number(Boolean(left.isVerified)) * 2;
    const rightScore = Number(Boolean(right.promoted)) * 4 + Number(Boolean(right.isVerified)) * 2;
    if (leftScore !== rightScore) return rightScore - leftScore;
    return left.name.localeCompare(right.name);
  });

// Top-N by a numeric Radio Browser signal (votes / clicktrend), descending.
// Stations missing the signal (or with a non-positive value) are excluded so a
// rail built from this list hides gracefully when the artifact lacks the column.
const topByNumericSignal = (
  stations: CatalogStation[],
  pick: (station: CatalogStation) => number | undefined,
  limit: number
) =>
  stations
    .map((station) => ({ station, score: pick(station) ?? 0 }))
    .filter((entry) => Number.isFinite(entry.score) && entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => toStationLite(entry.station));

const buildCountrySpotlight = (
  stations: CatalogStation[],
  seed: number,
  options: { exclude?: string } = {}
): CatalogSpotlight | null => {
  const excludeKey = options.exclude ? normalizeKey(options.exclude) : '';
  const buckets = new Map<string, CatalogStation[]>();
  stations.forEach((station) => {
    const country = normalizeText(station.country);
    if (!country) return;
    const current = buckets.get(country) || [];
    current.push(station);
    buckets.set(country, current);
  });
  const ranked = Array.from(buckets.entries())
    .filter(([label, items]) => items.length >= 4 && normalizeKey(label) !== excludeKey)
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]));
  if (!ranked.length) return null;
  const entry = ranked[seed % ranked.length];
  if (!entry) return null;
  const [label, items] = entry;
  return {
    label,
    stations: sortByTopSignal(items).slice(0, 8).map(toStationLite)
  };
};

const buildGenreSpotlight = (stations: CatalogStation[], seed: number): CatalogSpotlight | null => {
  const buckets = new Map<string, CatalogStation[]>();
  stations.forEach((station) => {
    (station.tags || '')
      .split(',')
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 4)
      .forEach((tag) => {
        const current = buckets.get(tag) || [];
        current.push(station);
        buckets.set(tag, current);
      });
  });
  const ranked = Array.from(buckets.entries())
    .filter(([, items]) => items.length >= 4)
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]));
  if (!ranked.length) return null;
  const entry = ranked[seed % ranked.length];
  if (!entry) return null;
  const [label, items] = entry;
  return {
    label,
    stations: sortByTopSignal(items).slice(0, 8).map(toStationLite)
  };
};

// T2.21: per-day rotation key for "Around the world" — the country changes at
// UTC midnight and stays fixed all day (deterministic, no server state).
const dayNumber = (now = Date.now()) => Math.floor(now / 86_400_000);

export const buildCatalogSummary = (stations: CatalogStation[], seed: number, now = Date.now()) => {
  const sorted = sortByTopSignal(stations);
  const promoted = sorted.filter((station) => station.promoted).slice(0, 6).map(toStationLite);
  const genreSpotlight = buildGenreSpotlight(sorted, seed + 17);
  const countrySpotlight = buildCountrySpotlight(sorted, seed + 29);
  // T2.21 discovery rails — non-personalised, server-side popularity signals.
  // Pools are larger than a rail renders (6) so they survive client-side
  // de-duplication against the personalised fresh-now shelf and still fill.
  const trending = topByNumericSignal(stations, (station) => station.clicktrend, 12);
  const topVoted = topByNumericSignal(stations, (station) => station.votes, 12);
  // Around the world rotates daily and avoids repeating the country-spotlight.
  const aroundTheWorld = buildCountrySpotlight(sorted, dayNumber(now), {
    exclude: countrySpotlight?.label
  });
  const tagCount = new Set(
    sorted
      .flatMap((station) => (station.tags || '').split(',').map((tag) => tag.trim().toLowerCase()))
      .filter(Boolean)
  ).size;
  return {
    generatedAt: Date.now(),
    counts: {
      stations: sorted.length,
      countries: new Set(sorted.map((station) => normalizeText(station.country)).filter(Boolean)).size,
      languages: new Set(sorted.map((station) => normalizeText(station.language)).filter(Boolean)).size,
      genres: tagCount
    },
    catalogPool: sorted.slice(0, 18).map(toStationLite),
    freshSignals: seededSample(sorted, seed + 1, 8),
    searchLaunch: seededSample(sorted, seed + 7, 8),
    sponsored: promoted,
    countrySpotlight,
    genreSpotlight,
    trending,
    topVoted,
    aroundTheWorld
  };
};

const buildSearchResponse = (stations: CatalogStation[], filters: CatalogSearchFilters) => {
  const filtered = stations.filter((station) => {
    const haystack = [station.name, station.tags, station.country, station.state, station.language]
      .join(' ')
      .toLowerCase();
    if (filters.q && !haystack.includes(filters.q)) return false;
    if (filters.country && normalizeText(station.country) !== filters.country) return false;
    if (filters.language && normalizeText(station.language) !== filters.language) return false;
    if (filters.tag && !(station.tags || '').toLowerCase().includes(filters.tag)) return false;
    if (filters.continent && resolveContinent(station) !== filters.continent) return false;
    return true;
  });

  const countryCounts = new Map<string, { count: number; continent: string }>();
  const tagCounts = new Map<string, number>();
  const languageCounts = new Map<string, number>();
  const continentCounts = new Map<string, number>();

  filtered.forEach((station) => {
    const country = normalizeText(station.country);
    const continent = resolveContinent(station);
    if (country) {
      const current = countryCounts.get(country) || { count: 0, continent };
      current.count += 1;
      countryCounts.set(country, current);
    }
    const language = normalizeText(station.language);
    if (language) {
      languageCounts.set(language, (languageCounts.get(language) || 0) + 1);
    }
    (station.tags || '')
      .split(',')
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean)
      .forEach((tag) => {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      });
    continentCounts.set(continent, (continentCounts.get(continent) || 0) + 1);
  });

  const nextCursor =
    filters.cursor + filters.limit < filtered.length ? String(filters.cursor + filters.limit) : null;

  return {
    items: filtered.slice(filters.cursor, filters.cursor + filters.limit).map(toStationLite),
    total: filtered.length,
    nextCursor,
    facets: {
      countries: Array.from(countryCounts.entries())
        .sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0]))
        .slice(0, 80)
        .map(([country]) => country),
      tags: Array.from(tagCounts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 80)
        .map(([tag]) => tag),
      languages: Array.from(languageCounts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 40)
        .map(([language]) => language),
      continentCounts: Array.from(continentCounts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([id, count]) => ({ id, count })),
      featuredCountries: Array.from(countryCounts.entries())
        .sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0]))
        .slice(0, 12)
        .map(([country, value]) => ({
          key: country.toLowerCase(),
          country,
          continent: value.continent,
          count: value.count
        }))
    }
  };
};

const buildAreaListResponse = (stations: CatalogStation[], zoomLevel: number) => {
  const bucketSize = bucketSizeForZoom(zoomLevel);
  const groups = new Map<
    string,
    {
      latTotal: number;
      lonTotal: number;
      count: number;
      stations: CatalogStation[];
      countryCounts: Map<string, number>;
      stateCounts: Map<string, number>;
    }
  >();

  let mappedStations = 0;
  stations.forEach((station) => {
    const lat = asNumber(station.geo_lat);
    const lon = asNumber(station.geo_long);
    if (lat === null || lon === null) return;
    const key = bucketKeyForCoords(lat, lon, bucketSize);
    const current = groups.get(key) || {
      latTotal: 0,
      lonTotal: 0,
      count: 0,
      stations: [],
      countryCounts: new Map<string, number>(),
      stateCounts: new Map<string, number>()
    };
    const country = normalizeText(station.country) || 'Unknown';
    const state = hasUsefulState(station.state, station.country) ? normalizeText(station.state) : '';
    mappedStations += 1;
    current.latTotal += lat;
    current.lonTotal += lon;
    current.count += 1;
    current.stations.push(station);
    current.countryCounts.set(country, (current.countryCounts.get(country) || 0) + 1);
    if (state) {
      current.stateCounts.set(state, (current.stateCounts.get(state) || 0) + 1);
    }
    groups.set(key, current);
  });

  const items = Array.from(groups.entries())
    .map(([id, group]) => {
      const countryEntries = Array.from(group.countryCounts.entries()).sort(
        (left, right) => right[1] - left[1]
      );
      const stateEntries = Array.from(group.stateCounts.entries()).sort(
        (left, right) => right[1] - left[1]
      );
      const country = countryEntries[0]?.[0] || 'Unknown';
      const state = stateEntries[0]?.[0] || '';
      const stateShare = stateEntries[0] ? stateEntries[0][1] / group.count : 0;
      const label =
        state && stateShare >= 0.24 && normalizeKey(state) !== normalizeKey(country) ? state : country;
      const subtitle =
        label === state && normalizeKey(state) !== normalizeKey(country)
          ? country
          : `${group.count} stations`;
      return {
        id,
        lat: group.latTotal / group.count,
        lon: group.lonTotal / group.count,
        label,
        subtitle,
        count: group.count
      };
    })
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

  return {
    items,
    mappedStations,
    totalStations: stations.length
  };
};

const buildAreaStationsResponse = (
  stations: CatalogStation[],
  areaId: string,
  limit: number,
  cursor: number
) => {
  const [bucketSizeRaw] = areaId.split(':');
  const bucketSize = Number(bucketSizeRaw);
  if (!Number.isFinite(bucketSize) || bucketSize <= 0) {
    return { area: null, items: [], nextCursor: null };
  }

  const areaStations = stations
    .filter((station) => {
      const lat = asNumber(station.geo_lat);
      const lon = asNumber(station.geo_long);
      if (lat === null || lon === null) return false;
      return bucketKeyForCoords(lat, lon, bucketSize) === areaId;
    })
    .sort((left, right) => {
      const leftScore = Number(Boolean(left.promoted)) * 4 + Number(Boolean(left.isVerified)) * 2;
      const rightScore = Number(Boolean(right.promoted)) * 4 + Number(Boolean(right.isVerified)) * 2;
      if (leftScore !== rightScore) return rightScore - leftScore;
      return left.name.localeCompare(right.name);
    });

  const areaList = buildAreaListResponse(areaStations, bucketSize);
  return {
    area: areaList.items[0] || null,
    items: areaStations.slice(cursor, cursor + limit).map(toStationLite),
    nextCursor: cursor + limit < areaStations.length ? String(cursor + limit) : null
  };
};

const getProfiledCatalog = async (mode: 'fast' | 'full', dependencies: CatalogDependencies) => {
  const cache = mode === 'fast' ? profiledFastCache : profiledFullCache;
  if (cache && Date.now() - cache.ts < PROFILE_CACHE_TTL_MS) {
    return cache.data;
  }
  const data = await dependencies.withStationProfiles(await dependencies.getCatalog(mode));
  const entry = { ts: Date.now(), data };
  if (mode === 'fast') {
    profiledFastCache = entry;
  } else {
    profiledFullCache = entry;
  }
  return data;
};

// Compact per-station points payload for the immersive globe surface.
// Sends only what's needed to draw a dot and identify it; the full
// station record is fetched on selection through /catalog/stations/:id.
//
// Roughly 11k of 55k Radio Browser stations have explicit geo_lat /
// geo_long. The rest still belong to a known country, so we include
// them with `country` only — the webapp's geoResolver drops them
// inside the country's borders deterministically (seeded by the
// station UUID) so the globe stops looking sparse where it shouldn't.
const buildPointsResponse = (stations: CatalogStation[]) => {
  const items: Array<{
    id: string;
    lat?: number;
    lon?: number;
    country: string;
    state?: string;
    name?: string;
  }> = [];
  let mappedStations = 0;
  stations.forEach((station) => {
    const lat = asNumber(station.geo_lat);
    const lon = asNumber(station.geo_long);
    const country = normalizeText(station.country) || '';
    const state = normalizeText(station.state) || '';
    const name = normalizeText(station.name) || '';
    const hasCoords =
      lat !== null &&
      lon !== null &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180 &&
      !(Math.abs(lat) < 0.000001 && Math.abs(lon) < 0.000001);
    if (!hasCoords && !country) return;
    const entry: {
      id: string;
      lat?: number;
      lon?: number;
      country: string;
      state?: string;
      name?: string;
    } = { id: station.stationuuid, country };
    if (hasCoords) {
      mappedStations += 1;
      entry.lat = lat as number;
      entry.lon = lon as number;
    }
    if (state) entry.state = state;
    if (name) entry.name = name;
    items.push(entry);
  });
  return {
    items,
    mappedStations,
    totalStations: stations.length,
    schemaVersion: 3
  };
};

export const createCatalogService = (dependencies: CatalogDependencies) => ({
  getCatalog: async (mode: 'fast' | 'full') => getProfiledCatalog(mode, dependencies),
  getSummary: async (seed: number) => buildCatalogSummary(await getProfiledCatalog('full', dependencies), seed),
  search: async (filters: CatalogSearchFilters) =>
    buildSearchResponse(await getProfiledCatalog('full', dependencies), filters),
  listAreas: async (zoomLevel: number) =>
    buildAreaListResponse(await getProfiledCatalog('full', dependencies), zoomLevel),
  listAreaStations: async (areaId: string, limit: number, cursor: number) =>
    buildAreaStationsResponse(await getProfiledCatalog('full', dependencies), areaId, limit, cursor),
  listPoints: async () => buildPointsResponse(await getProfiledCatalog('full', dependencies)),
  getStationById: async (stationId: string) => {
    const stations = await getProfiledCatalog('full', dependencies);
    const item = stations.find((station) => station.stationuuid === stationId) || null;
    return item ? toStationLite(item) : null;
  }
});
