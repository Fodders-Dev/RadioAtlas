import type {
  CatalogArea,
  CatalogAreaListResponse,
  CatalogAreaStationsResponse,
  CatalogSearchResponse,
  CatalogSummary
} from '../domain/contracts';
import type { StationLite } from '../types';

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

const FALLBACK_TIMEOUT_MS = 4500;
const FALLBACK_LIMIT = 80;

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
  if (!stationuuid || !name || !resolved.startsWith('https://')) {
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

const buildAreas = (stations: StationLite[]) => {
  const grouped = stations.reduce((map, station) => {
    const country = station.country || 'World';
    const bucket = map.get(country) || [];
    bucket.push(station);
    map.set(country, bucket);
    return map;
  }, new Map<string, StationLite[]>());

  const areas: CatalogArea[] = [];
  const areaStations = new Map<string, StationLite[]>();

  grouped.forEach((items, country) => {
    const geoStations = items.filter(
      (station) => station.geo_lat !== null && station.geo_long !== null
    );
    const lat = geoStations.length
      ? geoStations.reduce((sum, station) => sum + Number(station.geo_lat), 0) / geoStations.length
      : 0;
    const lon = geoStations.length
      ? geoStations.reduce((sum, station) => sum + Number(station.geo_long), 0) / geoStations.length
      : 0;
    const id = `fallback-country-${normalizeCountrySlug(country || 'world')}`;
    areas.push({
      id,
      lat,
      lon,
      label: country,
      subtitle: COUNTRY_CONTINENTS[country] || 'World',
      count: items.length
    });
    areaStations.set(id, items);
  });

  areas.sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  return { areas, areaStations };
};

const loadDataset = async (): Promise<FallbackDataset> => {
  if (!datasetPromise) {
    datasetPromise = fetchJson<FallbackStation[]>(
      `/json/stations/topvote/${FALLBACK_LIMIT}?hidebroken=true`
    ).then((items) => {
      const stations = uniqueStations(items.map(toStationLite).filter(Boolean) as StationLite[]);
      const { areas, areaStations } = buildAreas(stations);
      return { stations, areas, areaStations };
    });
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
  const limit = zoomLevel >= 4 ? 40 : zoomLevel >= 2 ? 24 : 14;
  return {
    items: dataset.areas.slice(0, limit),
    mappedStations: dataset.stations.filter(
      (station) => station.geo_lat !== null && station.geo_long !== null
    ).length,
    totalStations: dataset.stations.length
  };
};

export const listRadioBrowserFallbackAreaStations = async (
  areaId: string,
  options?: { limit?: number; cursor?: string | null }
): Promise<CatalogAreaStationsResponse> => {
  const dataset = await loadDataset();
  const area = dataset.areas.find((item) => item.id === areaId) || dataset.areas[0] || null;
  const stations = area ? dataset.areaStations.get(area.id) || [] : [];
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
