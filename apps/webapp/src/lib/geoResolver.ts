import { geoBounds, geoCentroid, geoContains } from 'd3-geo';
import { feature } from 'topojson-client';
import type { ContinentId } from '../types';
import worldData from '../assets/countries-110m.json';

type GeoStation = {
  stationuuid: string;
  name?: string;
  country?: string | null;
  geo_lat?: number | string | null;
  geo_long?: number | string | null;
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
  samplePool: CountryPoint[];
  feature: unknown;
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

const POINTS_PER_COUNTRY = 196;
const MAX_SAMPLE_TRIES = 6000;

const clampLat = (value: number) => Math.max(-85, Math.min(85, value));
const clampLon = (value: number) => Math.max(-180, Math.min(180, value));
const wrapLon = (value: number) => {
  if (value > 180) return value - 360;
  if (value < -180) return value + 360;
  return value;
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
    countries.set(key, {
      key,
      name,
      centroid,
      samplePool: buildSamplePool(item, key, centroid),
      feature: item
    });
  });

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

    if (hasStationCoords) {
      return { lat: clampLat(lat), lon: clampLon(lon), source: 'station' };
    }

    const country = resolveCountry(station.country);
    if (!country) return null;

    if (country.samplePool.length) {
      const seed = fnv1a(station.stationuuid || station.name || country.key);
      const point = country.samplePool[seed % country.samplePool.length];
      if (point) {
        return {
          lat: point[0],
          lon: point[1],
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
  if (record.samplePool[0]) {
    const [lat, lon] = record.samplePool[0];
    return { lat, lon, continent: toContinent(lat, lon) };
  }
  return null;
};

export const resolveContinent = (country?: string | null): ContinentId => {
  const coords = resolveCountryCoords(country);
  return coords?.continent ?? 'Other';
};
