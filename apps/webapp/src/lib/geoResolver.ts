import { geoBounds, geoCentroid, geoContains } from 'd3-geo';
import { feature } from 'topojson-client';
import type { ContinentId } from '../types';
import worldData from '../assets/countries-110m.json';

type GeoStation = {
  stationuuid: string;
  name?: string;
  country?: string | null;
  state?: string | null;
  geo_lat?: number | string | null;
  geo_long?: number | string | null;
};

export type StateAnchor = { lat: number; lon: number; n: number };
// `${normalized country}::${raw state}` → median lat/lon of stations
// in that state who DO have explicit geo coords. Built once per
// points payload by the caller; resolveStationCoords reads it to
// pin synthesized points to the right oblast / state instead of
// scattering them anywhere inside the country bbox.
export type StateAnchors = Map<string, StateAnchor>;
let activeStateAnchors: StateAnchors | null = null;
export const setStateAnchors = (anchors: StateAnchors | null) => {
  activeStateAnchors = anchors;
};

export type ResolvedCoords = {
  lat: number;
  lon: number;
  source: 'station' | 'country-pool' | 'country-centroid';
  countryKey?: string;
};

type CountryPoint = [number, number];

type CountryGeoRecord = {
  key: string;
  name: string;
  centroid: CountryPoint | null;
  // Lazily built on first access. Building is the expensive step (a
  // few thousand rejection-sampled geoContains checks per country),
  // and most rendered globes only ever touch ~50 of the 240
  // territories, so eager construction wastes seconds on startup.
  samplePool: CountryPoint[] | null;
  feature: unknown;
  // Bounding box around all of this country's polygons. Cached so
  // we can sanity-check that a station's claimed (geo_lat, geo_long)
  // actually falls inside the country it's tagged with — Radio
  // Browser sometimes ships obviously bogus coords (e.g. a Moscow
  // station with geo_lat=65 lon=170, in Chukotka).
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number } | null;
};

export type CountryGeoIndex = {
  countries: Map<string, CountryGeoRecord>;
  normalizeCountryName: (value: string) => string;
  resolveCountry: (country?: string | null) => CountryGeoRecord | null;
  resolveStationCoords: (station: GeoStation) => ResolvedCoords | null;
};

const COUNTRY_ALIASES: Record<string, string> = {
  'russian federation': 'russia',
  'united states': 'united states america',
  'united states of america': 'united states america',
  usa: 'united states america',
  uk: 'united kingdom',
  'united kingdom great britain northern ireland': 'united kingdom',
  'korea republic of': 'south korea',
  'korea democratic peoples republic of': 'north korea',
  'iran islamic republic of': 'iran',
  'syrian arab republic': 'syria',
  'viet nam': 'vietnam',
  'tanzania united republic of': 'tanzania',
  'venezuela bolivarian republic of': 'venezuela',
  'bolivia plurinational state of': 'bolivia',
  'czechia': 'czech republic'
};

// Big countries with hundreds of stations (Russia 3k, US 7k, Germany
// 5.7k, China 2k) collapsed onto only 196 unique positions, so dozens
// of stations stacked on a single pixel and the globe looked sparse.
// 2048 slots gives Russia ~1700 unique positions visible. Higher
// MAX_SAMPLE_TRIES makes sure rejection sampling can hit the target
// for territories with low land-area-to-bounding-box ratio (Russia,
// Indonesia, Norway).
const POINTS_PER_COUNTRY = 2048;
const MAX_SAMPLE_TRIES = 32000;

const clampLat = (value: number) => Math.max(-85, Math.min(85, value));
const clampLon = (value: number) => Math.max(-180, Math.min(180, value));
const wrapLon = (value: number) => {
  if (value > 180) return value - 360;
  if (value < -180) return value + 360;
  return value;
};

/**
 * True when `lon` falls inside [minLon, maxLon] taking the
 * antimeridian into account. d3-geoBounds returns bboxes where
 * minLon > maxLon for territories that wrap (Russia, Fiji, the US
 * with Aleutians). A naïve `>=` / `<=` comparison would reject
 * valid coords on the wrapping side.
 */
const isLonInWrappedRange = (lon: number, minLon: number, maxLon: number): boolean => {
  if (minLon <= maxLon) {
    return lon >= minLon && lon <= maxLon;
  }
  // Wrapped: e.g. minLon=170 maxLon=-170 covers everything from
  // 170°E eastward through the antimeridian to 170°W.
  return lon >= minLon || lon <= maxLon;
};

const toFiniteNumber = (value: unknown): number | null => {
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

const normalizeCountryName = (value: string) =>
  value
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\bthe\b|\bof\b|\band\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const fnv1a = (value: string) => {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const mulberry32 = (seed: number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const toContinent = (lat: number, lon: number): ContinentId => {
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

const buildSamplePool = (
  countryFeature: any,
  key: string,
  centroid: CountryPoint | null
) => {
  const bounds = geoBounds(countryFeature);
  if (!bounds || bounds.length !== 2) {
    return centroid ? [centroid] : [];
  }

  const [[minLon, minLat], [maxLon, maxLat]] = bounds as [
    [number, number],
    [number, number]
  ];
  const lonSpan = maxLon >= minLon ? maxLon - minLon : maxLon + 360 - minLon;

  if (
    !Number.isFinite(minLon) ||
    !Number.isFinite(maxLon) ||
    !Number.isFinite(minLat) ||
    !Number.isFinite(maxLat) ||
    !Number.isFinite(lonSpan)
  ) {
    return centroid ? [centroid] : [];
  }

  const points: CountryPoint[] = [];
  if (centroid && geoContains(countryFeature, [centroid[1], centroid[0]])) {
    points.push([clampLat(centroid[0]), clampLon(centroid[1])]);
  }

  const random = mulberry32(fnv1a(key));
  let tries = 0;
  while (points.length < POINTS_PER_COUNTRY && tries < MAX_SAMPLE_TRIES) {
    tries += 1;
    const lon = wrapLon(minLon + lonSpan * random());
    const lat = minLat + (maxLat - minLat) * random();
    if (!geoContains(countryFeature, [lon, lat])) continue;
    points.push([clampLat(lat), clampLon(lon)]);
  }

  return points.length ? points : centroid ? [centroid] : [];
};

const buildCountryGeoIndex = (): CountryGeoIndex => {
  const topology = worldData as any;
  const features = feature(topology, topology.objects.countries).features as any[];
  const countries = new Map<string, CountryGeoRecord>();

  features.forEach((item) => {
    const name = item?.properties?.name as string | undefined;
    if (!name) return;
    const key = normalizeCountryName(name);
    if (!key) return;
    const [lon, lat] = geoCentroid(item);
    const centroid =
      Number.isFinite(lat) && Number.isFinite(lon)
        ? ([clampLat(lat), clampLon(lon)] as CountryPoint)
        : null;
    // Cache the bbox once so the per-station sanity check (below)
    // is a pair of comparisons, not a re-trace of the polygons.
    let bbox: CountryGeoRecord['bbox'] = null;
    try {
      const bounds = geoBounds(item);
      if (bounds && bounds.length === 2) {
        const [[minLon, minLat], [maxLon, maxLat]] = bounds as [
          [number, number],
          [number, number]
        ];
        if (
          Number.isFinite(minLon) &&
          Number.isFinite(maxLon) &&
          Number.isFinite(minLat) &&
          Number.isFinite(maxLat)
        ) {
          bbox = { minLat, maxLat, minLon, maxLon };
        }
      }
    } catch {
      bbox = null;
    }
    countries.set(key, {
      key,
      name,
      centroid,
      samplePool: null,
      feature: item,
      bbox
    });
  });

  const ensureSamplePool = (record: CountryGeoRecord): CountryPoint[] => {
    if (record.samplePool) return record.samplePool;
    record.samplePool = buildSamplePool(record.feature, record.key, record.centroid);
    return record.samplePool;
  };

  const resolveCountry = (country?: string | null) => {
    if (!country) return null;
    const normalized = normalizeCountryName(country);
    if (!normalized) return null;
    const alias = COUNTRY_ALIASES[normalized] || normalized;
    return countries.get(alias) || null;
  };

  const resolveStationCoords = (station: GeoStation): ResolvedCoords | null => {
    const lat = toFiniteNumber(station.geo_lat);
    const lon = toFiniteNumber(station.geo_long);

    const hasStationCoords =
      lat !== null &&
      lon !== null &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180 &&
      !(Math.abs(lat) < 0.000001 && Math.abs(lon) < 0.000001);

    const country = resolveCountry(station.country);

    if (hasStationCoords) {
      // Sanity check: are these coords actually inside the country
      // the station claims? Radio Browser ships obviously bogus
      // geo_lat/geo_long fairly often (Moscow station with coords
      // in Chukotka, Tokyo station with coords in the Pacific). If
      // the country resolves AND has a bbox AND the coords are
      // clearly outside it (with a 2° slack to forgive imprecise
      // 110m polygons), reject the explicit coords and fall
      // through to the state-anchor / country-pool path. The dot
      // ends up where the user expects it instead of where Radio
      // Browser fat-fingered the lat/lon.
      const inCountry =
        !country ||
        !country.bbox ||
        (lat >= country.bbox.minLat - 2 &&
          lat <= country.bbox.maxLat + 2 &&
          isLonInWrappedRange(lon, country.bbox.minLon - 2, country.bbox.maxLon + 2));
      if (inCountry) {
        return { lat: clampLat(lat), lon: clampLon(lon), source: 'station' };
      }
      // else: fall through to fallbacks
    }

    if (!country) return null;

    // State-anchor enrichment: when Radio Browser doesn't ship
    // geo_lat/geo_long for a station but DOES tag it with a state
    // (city / oblast / region), pin it near other stations in the
    // same state who DO have coords. So "NRJ Тула 101.4 FM" with
    // state="Тула" lands inside Tula instead of getting flung
    // into the Arctic by the country-bbox sampler.
    if (station.state && activeStateAnchors) {
      const key = `${normalizeCountryName(station.country || '')}::${station.state}`;
      const anchor = activeStateAnchors.get(key);
      if (anchor) {
        const seed = fnv1a(station.stationuuid || station.name || key);
        const rng = mulberry32(seed);
        // ±0.18° ≈ ±20 km of jitter so multiple coord-less stations
        // in the same state spread out around the cluster instead
        // of stacking on its centroid.
        const jLat = (rng() - 0.5) * 0.36;
        const jLon = (rng() - 0.5) * 0.36;
        return {
          lat: clampLat(anchor.lat + jLat),
          lon: clampLon(anchor.lon + jLon),
          source: 'country-pool',
          countryKey: country.key
        };
      }
    }

    const pool = ensureSamplePool(country);
    if (pool.length) {
      const seed = fnv1a(station.stationuuid || station.name || country.key);
      const point = pool[seed % pool.length];
      if (point) {
        // Apply a small per-station jitter so colliding pool indices
        // don't stack on the same pixel. Range ~0.12° (~13 km at the
        // equator) — small enough to almost always stay inside the
        // country, big enough to be visible at zoom levels people use
        // for "Russia at a glance".
        const jitterRng = mulberry32(seed ^ 0x9e3779b9);
        const jitterLat = (jitterRng() - 0.5) * 0.24;
        const jitterLon = (jitterRng() - 0.5) * 0.24;
        return {
          lat: clampLat(point[0] + jitterLat),
          lon: clampLon(point[1] + jitterLon),
          source: 'country-pool',
          countryKey: country.key
        };
      }
    }

    if (country.centroid) {
      return {
        lat: country.centroid[0],
        lon: country.centroid[1],
        source: 'country-centroid',
        countryKey: country.key
      };
    }

    return null;
  };

  return {
    countries,
    normalizeCountryName,
    resolveCountry,
    resolveStationCoords
  };
};

let countryGeoIndexCache: CountryGeoIndex | null = null;

export const getCountryGeoIndex = () => {
  if (!countryGeoIndexCache) {
    countryGeoIndexCache = buildCountryGeoIndex();
  }
  return countryGeoIndexCache;
};

export const resolveStationCoords = (station: GeoStation) =>
  getCountryGeoIndex().resolveStationCoords(station);

export const resolveCountryCoords = (country?: string | null) => {
  const record = getCountryGeoIndex().resolveCountry(country);
  if (!record) return null;
  if (record.centroid) {
    return {
      lat: record.centroid[0],
      lon: record.centroid[1],
      continent: toContinent(record.centroid[0], record.centroid[1]) as ContinentId
    };
  }
  if (record.samplePool && record.samplePool[0]) {
    const [lat, lon] = record.samplePool[0];
    return { lat, lon, continent: toContinent(lat, lon) };
  }
  return null;
};

export const resolveContinent = (country?: string | null): ContinentId => {
  const coords = resolveCountryCoords(country);
  return coords?.continent ?? 'Other';
};

// Build a (normalizedCountry, rawState) → median {lat, lon} anchor
// map from a list of stations that DO have explicit coords. Used by
// resolveStationCoords to pin coord-less stations into the right
// state instead of scattering them inside the country bbox.
export const buildStateAnchors = (
  rows: Array<{
    country?: string | null;
    state?: string | null;
    lat?: number | null;
    lon?: number | null;
  }>
): StateAnchors => {
  const buckets = new Map<string, { lats: number[]; lons: number[] }>();
  for (const row of rows) {
    if (!row.country || !row.state) continue;
    const lat = typeof row.lat === 'number' && Number.isFinite(row.lat) ? row.lat : null;
    const lon = typeof row.lon === 'number' && Number.isFinite(row.lon) ? row.lon : null;
    if (lat === null || lon === null) continue;
    if (Math.abs(lat) < 0.000001 && Math.abs(lon) < 0.000001) continue;
    const key = `${normalizeCountryName(row.country)}::${row.state}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { lats: [], lons: [] };
      buckets.set(key, bucket);
    }
    bucket.lats.push(lat);
    bucket.lons.push(lon);
  }
  const result: StateAnchors = new Map();
  buckets.forEach((bucket, key) => {
    // Need at least 2 anchored stations before we trust the
    // cluster — single-point clusters can be a misplaced station
    // that would drag every other station's dot to its location.
    if (bucket.lats.length < 2) return;
    bucket.lats.sort((a, b) => a - b);
    bucket.lons.sort((a, b) => a - b);
    const lat = bucket.lats[Math.floor(bucket.lats.length / 2)];
    const lon = bucket.lons[Math.floor(bucket.lons.length / 2)];
    result.set(key, { lat, lon, n: bucket.lats.length });
  });
  return result;
};
