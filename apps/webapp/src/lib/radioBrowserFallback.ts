import type {
  CatalogArea,
  CatalogAreaListResponse,
  CatalogAreaStationsResponse,
  CatalogSearchResponse,
  CatalogSummary
} from '../domain/contracts';
import type { StationLite } from '../types';
import { readCatalogCache, writeCatalogCache } from './catalogCache';

type FallbackStation = {
  stationuuid?: string;
  name?: string;
  url?: string;
  url_resolved?: string;
  homepage?: string;
  favicon?: string;
  tags?: string;
  country?: string;
  countrycode?: string;
  state?: string;
  language?: string;
  codec?: string;
  bitrate?: number;
  geo_lat?: number | string | null;
  geo_long?: number | string | null;
  votes?: number;
};

type SearchStationsInput = {
  q?: string;
  country?: string;
  language?: string;
  tag?: string;
  continent?: string;
  limit?: number;
  cursor?: string | null;
};

type FallbackDataset = {
  stations: StationLite[];
  areas: CatalogArea[];
  areaStations: Map<string, StationLite[]>;
};

const RADIO_BROWSER_HOSTS = [
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info'
];

const FALLBACK_TIMEOUT_MS = 6000;
const FALLBACK_LIMIT = 240;
const FALLBACK_GEO_LIMIT = 3600;
const FALLBACK_GEO_PAGE_SIZE = 900;
const FALLBACK_DATASET_CACHE_KEY = 'fallback:dataset:v4';
const FALLBACK_DATASET_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const COUNTRY_CONTINENTS: Record<string, string> = {
  Argentina: 'South America',
  Australia: 'Oceania',
  Austria: 'Europe',
  Belgium: 'Europe',
  Brazil: 'South America',
  Canada: 'North America',
  Chile: 'South America',
  China: 'Asia',
  Colombia: 'South America',
  Denmark: 'Europe',
  Finland: 'Europe',
  France: 'Europe',
  Germany: 'Europe',
  Greece: 'Europe',
  India: 'Asia',
  Indonesia: 'Asia',
  Ireland: 'Europe',
  Italy: 'Europe',
  Japan: 'Asia',
  Mexico: 'North America',
  Netherlands: 'Europe',
  Norway: 'Europe',
  Poland: 'Europe',
  Portugal: 'Europe',
  Russia: 'Europe',
  Spain: 'Europe',
  Sweden: 'Europe',
  Switzerland: 'Europe',
  Turkey: 'Asia',
  Ukraine: 'Europe',
  'United Kingdom': 'Europe',
  'United States': 'North America'
};

let datasetPromise: Promise<FallbackDataset> | null = null;

const asNumber = (value: number | string | null | undefined) => {
  const number = typeof value === 'string' ? Number.parseFloat(value) : value;
  return Number.isFinite(number) ? Number(number) : null;
};

const clean = (value: unknown) => String(value || '').trim();

const tagList = (station: StationLite) =>
  station.tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

const stableHash = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const sampleStations = (stations: StationLite[], count: number, seed: number) =>
  [...stations]
    .sort(
      (left, right) =>
        stableHash(`${left.stationuuid}:${seed}`) - stableHash(`${right.stationuuid}:${seed}`)
    )
    .slice(0, count);

const toStationLite = (station: FallbackStation): StationLite | null => {
  const stationuuid = clean(station.stationuuid);
  const name = clean(station.name);
  const resolved = clean(station.url_resolved || station.url);
  if (!stationuuid || !name || !/^https?:\/\//i.test(resolved)) {
    return null;
  }

  const lite: StationLite & { language?: string; codec?: string; bitrate?: number } = {
    stationuuid,
    name,
    url: clean(station.url) || resolved,
    url_resolved: resolved,
    homepage: clean(station.homepage),
    favicon: clean(station.favicon),
    country: clean(station.country),
    state: clean(station.state),
    tags: clean(station.tags),
    geo_lat: asNumber(station.geo_lat),
    geo_long: asNumber(station.geo_long),
    stationArtwork: clean(station.favicon) || null,
    isClaimed: false,
    isVerified: Number(station.votes || 0) >= 100,
    promoted: false,
    description: null,
    websiteUrl: clean(station.homepage) || null,
    scheduleNote: null,
    language: clean(station.language),
    codec: clean(station.codec),
    bitrate: Number.isFinite(station.bitrate) ? Number(station.bitrate) : undefined
  };
  return lite;
};

const fetchJson = async <T,>(path: string): Promise<T> => {
  let lastError: Error | null = null;

  for (const host of RADIO_BROWSER_HOSTS) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), FALLBACK_TIMEOUT_MS);
    try {
      const response = await fetch(`${host}${path}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`fallback catalog failed (${response.status})`);
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('fallback catalog failed');
    } finally {
      window.clearTimeout(timeout);
    }
  }

  throw lastError || new Error('fallback catalog failed');
};

const fetchGeoFallbackStations = async () => {
  const pages = Math.ceil(FALLBACK_GEO_LIMIT / FALLBACK_GEO_PAGE_SIZE);
  const results = await Promise.allSettled(
    Array.from({ length: pages }, (_, pageIndex) => {
      const limit = Math.min(
        FALLBACK_GEO_PAGE_SIZE,
        FALLBACK_GEO_LIMIT - pageIndex * FALLBACK_GEO_PAGE_SIZE
      );
      const offset = pageIndex * FALLBACK_GEO_PAGE_SIZE;
      return fetchJson<FallbackStation[]>(
        `/json/stations/search?limit=${limit}&offset=${offset}&order=clickcount&reverse=true&hidebroken=true&has_geo_info=true`
      );
    })
  );
  return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
};

const uniqueStations = (stations: StationLite[]) => {
  const seen = new Set<string>();
  return stations.filter((station) => {
    if (seen.has(station.stationuuid)) return false;
    seen.add(station.stationuuid);
    return true;
  });
};

const normalizeCountrySlug = (country: string) =>
  country
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

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
  return `fallback-bucket:${bucketSize}:${latBucket}:${lonBucket}`;
};

const buildAreas = (stations: StationLite[], zoomLevel = 1, bucketSizeOverride?: number) => {
  const bucketSize = bucketSizeOverride ?? bucketSizeForZoom(zoomLevel);
  const grouped = stations.reduce((map, station) => {
    const lat = asNumber(station.geo_lat);
    const lon = asNumber(station.geo_long);
    if (lat === null || lon === null) return map;
    const key = bucketKeyForCoords(lat, lon, bucketSize);
    const bucket = map.get(key) || [];
    bucket.push(station);
    map.set(key, bucket);
    return map;
  }, new Map<string, StationLite[]>());

  const areas: CatalogArea[] = [];
  const areaStations = new Map<string, StationLite[]>();

  grouped.forEach((items, id) => {
    const lat = items.reduce((sum, station) => sum + Number(station.geo_lat), 0) / items.length;
    const lon = items.reduce((sum, station) => sum + Number(station.geo_long), 0) / items.length;
    const countryCounts = new Map<string, number>();
    const stateCounts = new Map<string, number>();
    items.forEach((station) => {
      const country = station.country || 'World';
      const state = station.state && station.state !== station.country ? station.state : '';
      countryCounts.set(country, (countryCounts.get(country) || 0) + 1);
      if (state) {
        stateCounts.set(state, (stateCounts.get(state) || 0) + 1);
      }
    });
    const [country = 'World'] =
      [...countryCounts.entries()].sort((left, right) => right[1] - left[1])[0] || [];
    const stateEntry = [...stateCounts.entries()].sort((left, right) => right[1] - left[1])[0];
    const label =
      stateEntry && stateEntry[1] / items.length >= 0.24
        ? stateEntry[0]
        : country || 'World';
    areas.push({
      id,
      lat,
      lon,
      label,
      subtitle: label === country ? `${items.length} stations` : country,
      count: items.length
    });
    areaStations.set(id, items);
  });

  if (!areas.length) {
    const groupedByCountry = stations.reduce((map, station) => {
      const country = station.country || 'World';
      const bucket = map.get(country) || [];
      bucket.push(station);
      map.set(country, bucket);
      return map;
    }, new Map<string, StationLite[]>());
    groupedByCountry.forEach((items, country) => {
      const id = `fallback-country-${normalizeCountrySlug(country || 'world')}`;
      areas.push({
        id,
        lat: 0,
        lon: 0,
        label: country,
        subtitle: COUNTRY_CONTINENTS[country] || 'World',
        count: items.length
      });
      areaStations.set(id, items);
    });
  }

  areas.sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  return { areas, areaStations };
};

const loadDataset = async (): Promise<FallbackDataset> => {
  if (!datasetPromise) {
    datasetPromise = (async () => {
      const cached = await readCatalogCache<StationLite[]>(FALLBACK_DATASET_CACHE_KEY);
      if (cached?.payload?.length) {
        const { areas, areaStations } = buildAreas(cached.payload);
        return { stations: cached.payload, areas, areaStations };
      }

      try {
        const [topvoteResult, geoResult] = await Promise.allSettled([
          fetchJson<FallbackStation[]>(`/json/stations/topvote/${FALLBACK_LIMIT}?hidebroken=true`),
          fetchGeoFallbackStations()
        ]);
        const items = [
          ...(topvoteResult.status === 'fulfilled' ? topvoteResult.value : []),
          ...(geoResult.status === 'fulfilled' ? geoResult.value : [])
        ];
        if (!items.length) {
          throw new Error('fallback catalog returned no stations');
        }
        const stations = uniqueStations(items.map(toStationLite).filter(Boolean) as StationLite[]);
        await writeCatalogCache(FALLBACK_DATASET_CACHE_KEY, stations, FALLBACK_DATASET_CACHE_TTL_MS);
        const { areas, areaStations } = buildAreas(stations);
        return { stations, areas, areaStations };
      } catch (error) {
        const stale = await readCatalogCache<StationLite[]>(FALLBACK_DATASET_CACHE_KEY, {
          allowExpired: true
        });
        if (stale?.payload?.length) {
          const { areas, areaStations } = buildAreas(stale.payload);
          return { stations: stale.payload, areas, areaStations };
        }
        throw error;
      }
    })();
  }
  return datasetPromise;
};

const buildSpotlight = (
  label: string,
  stations: StationLite[],
  predicate: (station: StationLite) => boolean
) => {
  const matches = stations.filter(predicate).slice(0, 8);
  return matches.length >= 3 ? { label, stations: matches } : null;
};

export const loadRadioBrowserFallbackSummary = async (
  seed = Date.now()
): Promise<CatalogSummary> => {
  const dataset = await loadDataset();
  const stations = dataset.stations;
  const countries = new Set(stations.map((station) => station.country).filter(Boolean));
  const languages = new Set(
    stations
      .map((station) => (station as StationLite & { language?: string }).language)
      .filter(Boolean)
  );
  const tags = new Set(stations.flatMap(tagList));
  const firstCountry = [...countries][0] || '';
  const firstTag = [...tags][0] || '';

  return {
    generatedAt: Date.now(),
    counts: {
      stations: stations.length,
      countries: countries.size,
      languages: languages.size,
      genres: tags.size
    },
    catalogPool: stations.slice(0, 24),
    freshSignals: sampleStations(stations, 12, seed),
    searchLaunch: sampleStations(stations, 10, seed + 17),
    sponsored: [],
    countrySpotlight: firstCountry
      ? buildSpotlight(firstCountry, stations, (station) => station.country === firstCountry)
      : null,
    genreSpotlight: firstTag
      ? buildSpotlight(firstTag, stations, (station) => tagList(station).includes(firstTag))
      : null
  };
};

const matchesQuery = (station: StationLite, query: string) => {
  if (!query) return true;
  const haystack = [
    station.name,
    station.country,
    station.state,
    station.tags,
    (station as StationLite & { language?: string }).language || ''
  ]
    .join(' ')
    .toLowerCase();
  return query
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => haystack.includes(part));
};

const continentFor = (station: StationLite) => COUNTRY_CONTINENTS[station.country] || 'Other';

export const searchRadioBrowserFallback = async (
  input: SearchStationsInput
): Promise<CatalogSearchResponse> => {
  const dataset = await loadDataset();
  const query = clean(input.q).toLowerCase();
  const country = clean(input.country).toLowerCase();
  const language = clean(input.language).toLowerCase();
  const tag = clean(input.tag).toLowerCase();
  const continent = clean(input.continent);
  const limit = Math.max(1, Math.min(input.limit || 50, 100));
  const cursor = Math.max(0, Number.parseInt(input.cursor || '0', 10) || 0);

  const filtered = dataset.stations.filter((station) => {
    if (!matchesQuery(station, query)) return false;
    if (country && country !== 'all' && station.country.toLowerCase() !== country) return false;
    if (
      language &&
      language !== 'all' &&
      !clean((station as StationLite & { language?: string }).language)
        .toLowerCase()
        .includes(language)
    ) {
      return false;
    }
    if (tag && tag !== 'all' && !tagList(station).some((item) => item.toLowerCase() === tag)) {
      return false;
    }
    if (continent && continent !== 'All' && continentFor(station) !== continent) return false;
    return true;
  });

  const items = filtered.slice(cursor, cursor + limit);
  const countries = [...new Set(dataset.stations.map((station) => station.country).filter(Boolean))];
  const tags = [...new Set(dataset.stations.flatMap(tagList))];
  const languages = [
    ...new Set(
      dataset.stations
        .map((station) => clean((station as StationLite & { language?: string }).language))
        .filter(Boolean)
    )
  ];
  const continentCounts = [...new Set(dataset.stations.map(continentFor))].map((id) => ({
    id,
    count: dataset.stations.filter((station) => continentFor(station) === id).length
  }));
  const featuredCountries = dataset.areas.slice(0, 8).map((area) => ({
    key: normalizeCountrySlug(area.label),
    country: area.label,
    continent: area.subtitle,
    count: area.count
  }));

  return {
    items,
    total: filtered.length,
    nextCursor: cursor + limit < filtered.length ? String(cursor + limit) : null,
    facets: {
      countries: ['All', ...countries],
      tags: ['All', ...tags],
      languages: ['All', ...languages],
      continentCounts,
      featuredCountries
    }
  };
};

export const listRadioBrowserFallbackAreas = async (
  zoomLevel: number
): Promise<CatalogAreaListResponse> => {
  const dataset = await loadDataset();
  const { areas } = buildAreas(dataset.stations, zoomLevel);
  const limit = zoomLevel >= 4 ? 900 : zoomLevel >= 2 ? 520 : 180;
  return {
    items: areas.slice(0, limit),
    mappedStations: dataset.stations.filter(
      (station) => station.geo_lat !== null && station.geo_long !== null
    ).length,
    totalStations: dataset.stations.length
  };
};

export const listRadioBrowserFallbackPoints = async () => {
  const dataset = await loadDataset();
  const items: Array<{ id: string; lat?: number; lon?: number; country: string }> = [];
  let mappedStations = 0;
  dataset.stations.forEach((station) => {
    const country = station.country || '';
    const hasCoords = station.geo_lat !== null && station.geo_long !== null;
    if (!hasCoords && !country) return;
    if (hasCoords) {
      mappedStations += 1;
      items.push({
        id: station.stationuuid,
        lat: station.geo_lat as number,
        lon: station.geo_long as number,
        country
      });
    } else {
      items.push({ id: station.stationuuid, country });
    }
  });
  return {
    items,
    mappedStations,
    totalStations: dataset.stations.length
  };
};

export const listRadioBrowserFallbackAreaStations = async (
  areaId: string,
  options?: { limit?: number; cursor?: string | null }
): Promise<CatalogAreaStationsResponse> => {
  const dataset = await loadDataset();
  const bucketSize = areaId.startsWith('fallback-bucket:')
    ? Number(areaId.split(':')[1])
    : Number.NaN;
  const dynamicAreas = Number.isFinite(bucketSize)
    ? buildAreas(dataset.stations, 1, bucketSize).areas
    : dataset.areas;
  const dynamicStations = Number.isFinite(bucketSize)
    ? dataset.stations.filter((station) => {
        const lat = asNumber(station.geo_lat);
        const lon = asNumber(station.geo_long);
        if (lat === null || lon === null) return false;
        return bucketKeyForCoords(lat, lon, bucketSize) === areaId;
      })
    : [];
  const area = dynamicAreas.find((item) => item.id === areaId) || dynamicAreas[0] || null;
  const stations = Number.isFinite(bucketSize)
    ? dynamicStations
    : area
      ? dataset.areaStations.get(area.id) || []
      : [];
  const limit = Math.max(1, Math.min(options?.limit || 50, 100));
  const cursor = Math.max(0, Number.parseInt(options?.cursor || '0', 10) || 0);
  return {
    area,
    items: stations.slice(cursor, cursor + limit),
    nextCursor: cursor + limit < stations.length ? String(cursor + limit) : null
  };
};

export const fetchRadioBrowserFallbackStationById = async (
  stationId: string
): Promise<StationLite | null> => {
  const dataset = await loadDataset();
  const cached = dataset.stations.find((station) => station.stationuuid === stationId);
  if (cached) return cached;
  const items = await fetchJson<FallbackStation[]>(
    `/json/stations/byuuid/${encodeURIComponent(stationId)}`
  );
  return items.map(toStationLite).find(Boolean) || null;
};
