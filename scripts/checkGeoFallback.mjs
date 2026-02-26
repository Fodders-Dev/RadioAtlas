import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoBounds, geoCentroid, geoContains } from 'd3-geo';
import { feature } from 'topojson-client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CATALOG_PATH = join(ROOT, 'apps', 'webapp', 'public', 'catalog-full.json');
const WORLD_PATH = join(ROOT, 'apps', 'webapp', 'src', 'assets', 'countries-110m.json');

const POINTS_PER_COUNTRY = 196;
const MAX_SAMPLE_TRIES = 6000;
const MAX_OUTSIDE_RATE = 0.01;

const COUNTRY_ALIASES = {
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

const normalizeCountryName = (value) =>
  value
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\bthe\b|\bof\b|\band\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const clampLat = (value) => Math.max(-85, Math.min(85, value));
const clampLon = (value) => Math.max(-180, Math.min(180, value));

const asNumber = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized === 'null' || normalized === 'undefined') return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const fnv1a = (value) => {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const mulberry32 = (seed) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const buildCountryPools = (world) => {
  const features = feature(world, world.objects.countries).features;
  const countries = new Map();

  features.forEach((item) => {
    const name = item?.properties?.name;
    if (!name) return;
    const key = normalizeCountryName(name);
    if (!key) return;

    const [lon, lat] = geoCentroid(item);
    const centroid =
      Number.isFinite(lat) && Number.isFinite(lon)
        ? [clampLat(lat), clampLon(lon)]
        : null;

    const bounds = geoBounds(item);
    const pool = [];
    if (centroid && geoContains(item, [centroid[1], centroid[0]])) {
      pool.push(centroid);
    }

    if (bounds?.length === 2) {
      const [[minLon, minLat], [maxLon, maxLat]] = bounds;
      const random = mulberry32(fnv1a(key));
      let tries = 0;
      while (pool.length < POINTS_PER_COUNTRY && tries < MAX_SAMPLE_TRIES) {
        tries += 1;
        const pointLon = minLon + (maxLon - minLon) * random();
        const pointLat = minLat + (maxLat - minLat) * random();
        if (!geoContains(item, [pointLon, pointLat])) continue;
        pool.push([clampLat(pointLat), clampLon(pointLon)]);
      }
    }

    countries.set(key, {
      feature: item,
      pool,
      centroid
    });
  });

  return countries;
};

const main = async () => {
  const [catalogRaw, worldRaw] = await Promise.all([
    readFile(CATALOG_PATH, 'utf8'),
    readFile(WORLD_PATH, 'utf8')
  ]);

  const catalog = JSON.parse(catalogRaw);
  const world = JSON.parse(worldRaw);
  const countries = buildCountryPools(world);

  let stationsWithoutGeo = 0;
  let stationsWithFallback = 0;
  let stationsOutsideCountry = 0;
  let unresolvedCountry = 0;
  let invalidGeo = 0;
  let zeroedCoords = 0;

  for (const station of catalog) {
    const lat = asNumber(station.geo_lat);
    const lon = asNumber(station.geo_long);

    if (lat === 0 && lon === 0) {
      zeroedCoords += 1;
    }

    if (lat !== null || lon !== null) {
      if (
        lat === null ||
        lon === null ||
        Math.abs(lat) > 90 ||
        Math.abs(lon) > 180
      ) {
        invalidGeo += 1;
      }
      continue;
    }

    stationsWithoutGeo += 1;
    const countryName = station.country?.trim();
    if (!countryName) continue;

    const normalized = normalizeCountryName(countryName);
    const key = COUNTRY_ALIASES[normalized] || normalized;
    const country = countries.get(key);
    if (!country) {
      unresolvedCountry += 1;
      continue;
    }

    let point = country.pool.length
      ? country.pool[fnv1a(station.stationuuid || station.name || key) % country.pool.length]
      : null;

    if (!point && country.centroid) {
      point = country.centroid;
    }

    if (!point) continue;
    stationsWithFallback += 1;

    if (!geoContains(country.feature, [point[1], point[0]])) {
      stationsOutsideCountry += 1;
    }
  }

  const outsideRate =
    stationsWithFallback > 0 ? stationsOutsideCountry / stationsWithFallback : 0;

  console.log(
    JSON.stringify(
      {
        catalogSize: catalog.length,
        stationsWithoutGeo,
        stationsWithFallback,
        stationsOutsideCountry,
        outsideRate,
        unresolvedCountry,
        invalidGeo,
        zeroedCoords
      },
      null,
      2
    )
  );

  if (zeroedCoords > 0) {
    throw new Error(`Found ${zeroedCoords} stations with zeroed coordinates`);
  }

  if (outsideRate > MAX_OUTSIDE_RATE) {
    throw new Error(
      `Fallback point outside-rate ${outsideRate.toFixed(4)} is above ${MAX_OUTSIDE_RATE}`
    );
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

