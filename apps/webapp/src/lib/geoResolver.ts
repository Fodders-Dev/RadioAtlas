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
  // slot number → the point sampled for it, filled on first request and kept.
  // Sampling is the expensive step here — a rejection-sampled geoContains per
  // try — so only the slots stations actually land in are ever paid for: a
  // country with twelve stations costs twelve samples, not two thousand.
  slotPoints?: Map<number, CountryPoint> | null;
  // undefined = not computed yet, null = this feature has no usable bounds.
  sampleBox?: SampleBox | null;
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
// 2048 slots gives Russia ~1700 unique positions visible.
//
// This is now the number of SLOTS a country has, not the number of points it
// builds: a slot is sampled the first time a station lands in it, so a country
// with twelve stations costs twelve samples. See sampleSlotPoint.
const POINTS_PER_COUNTRY = 2048;

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

// A country's sample points used to be built as one eager batch of 2048 the
// first time anything asked for a position in that country. Measured in Chrome
// on the real 59k-point payload, filling every country that way costs 6.3
// SECONDS on the Globe's first mount, and resolving the stations afterwards
// costs 60ms — so essentially the whole wait is sampling, and most of it is
// thrown away. 2048 points is the right size for the United States and absurd
// for the hundred-odd countries that ship fewer than fifty stations each.
//
// Points are now sampled one SLOT at a time. A slot's point is a pure function
// of (country, slot number): its own seeded RNG, rejection-sampled against the
// polygon, cached on the record. A country therefore pays for exactly the slots
// its stations land in — and, unlike a pool that grows, the point for a slot
// never changes, so no dot moves when the payload is resolved a second time.
type SampleBox = {
  minLat: number;
  maxLat: number;
  minLon: number;
  lonSpan: number;
};

const sampleBoxFor = (countryFeature: any): SampleBox | null => {
  const bounds = geoBounds(countryFeature);
  if (!bounds || bounds.length !== 2) return null;
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
    return null;
  }
  return { minLat, maxLat, minLon, lonSpan };
};

// Enough tries that even a country whose land is a few percent of its bounding
// box practically always finds a point. France is the case that set this
// number: its 110m feature includes French Guiana, so the bounding box runs
// from 54°W to 8°E and land is about 2% of it. At 256 tries a handful of slots
// still missed, and the three stations that shared one of them were drawn in
// Asturias — France's centroid with Guiana in the average sits in the Atlantic
// off northern Spain, and that was the fallback.
const MAX_TRIES_PER_SLOT = 512;
// If a slot still misses, borrow a neighbour's point rather than the centroid:
// a neighbour's point was sampled against the polygon, the centroid was not.
const SLOT_FALLBACK_HOPS = 3;

const sampleSlotPoint = (
  countryFeature: any,
  key: string,
  box: SampleBox,
  slot: number
): CountryPoint | null => {
  const random = mulberry32(fnv1a(`${key}:${slot}`));
  for (let tries = 0; tries < MAX_TRIES_PER_SLOT; tries += 1) {
    const lon = wrapLon(box.minLon + box.lonSpan * random());
    const lat = box.minLat + (box.maxLat - box.minLat) * random();
    if (geoContains(countryFeature, [lon, lat])) {
      return [clampLat(lat), clampLon(lon)];
    }
  }
  return null;
};

// Jitter exists so that stations sharing a pool point do not stack on one
// pixel, and until now it was applied blind. Measured over the whole 62k
// catalogue, that put 583 synthesized dots — 1.27% of them — inside a
// NEIGHBOURING country: 57 Mexican stations in the United States, 31 German
// ones in Czechia, 29 Dutch ones in Germany. The offset is ~13km and most
// borders here are drawn from a 110m world, so the effect is invisible in a
// screenshot and obvious to anyone who tapped a dot.
//
// Distance is the wrong instrument (a legal point can sit 1km from a border,
// an illegal one 13km inside a bay), so this asks the polygon. The offset
// SHRINKS rather than disappearing: each station keeps its own direction, so a
// row of stations near a border spreads along it instead of collapsing onto one
// pixel. Dropping straight to the origin cost 2,527 stations their own position
// and built one stack of 198; shrinking costs 0.1° at worst, about a kilometre.
//
// Only the stations whose full offset misses pay for the extra tries — 4% of
// them — and the first check is the one everybody pays.
//
// Returns null when even the un-offset origin is outside the country, which is
// how a bad state anchor is detected.
// Mirror before shrinking. Coastal anchors are the reason: Dubai's cluster sits
// two kilometres from the water, so half of every offset box is sea, and simply
// shrinking put forty UAE stations on one pixel. Flipping the offset keeps the
// full radius and looks for land on the other side of the anchor first.
const JITTER_SCALES = [1, -1, 0.5, -0.5, 0.25, -0.25, 0.1];
const keepInsideCountry = (
  record: CountryGeoRecord,
  lat: number,
  lon: number,
  offsetLat: number,
  offsetLon: number
): CountryPoint | null => {
  const feature = record.feature;
  if (!feature) return [clampLat(lat + offsetLat), clampLon(lon + offsetLon)];
  for (const scale of JITTER_SCALES) {
    const candidate: CountryPoint = [
      clampLat(lat + offsetLat * scale),
      clampLon(lon + offsetLon * scale)
    ];
    if (geoContains(feature as any, [candidate[1], candidate[0]])) return candidate;
  }
  const origin: CountryPoint = [clampLat(lat), clampLon(lon)];
  return geoContains(feature as any, [origin[1], origin[0]]) ? origin : null;
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
      slotPoints: null,
      feature: item,
      bbox
    });
  });

  // The point for one slot of one country, sampled on first request and kept.
  // Falls back to the centroid for the handful of territories whose land is too
  // thin a share of their bounding box to hit in 256 tries.
  const pointForSlot = (record: CountryGeoRecord, slot: number): CountryPoint | null => {
    let cache = record.slotPoints;
    if (!cache) {
      cache = new Map();
      record.slotPoints = cache;
    }
    const cached = cache.get(slot);
    if (cached) return cached;
    if (record.sampleBox === undefined) {
      record.sampleBox = sampleBoxFor(record.feature);
    }
    let point: CountryPoint | null = null;
    if (record.sampleBox) {
      for (let hop = 0; hop <= SLOT_FALLBACK_HOPS && !point; hop += 1) {
        point = sampleSlotPoint(
          record.feature,
          record.key,
          record.sampleBox,
          (slot + hop * 397) % POINTS_PER_COUNTRY
        );
      }
    }
    // Last resort, and only when it is honest: a centroid can sit outside its
    // own country (France's, with French Guiana in the average, is at sea).
    const resolved =
      point ??
      (record.centroid &&
      geoContains(record.feature as any, [record.centroid[1], record.centroid[0]])
        ? record.centroid
        : null);
    if (!resolved) return null;
    cache.set(slot, resolved);
    return resolved;
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
        const placed = keepInsideCountry(country, anchor.lat, anchor.lon, jLat, jLon);
        if (placed) {
          return {
            lat: placed[0],
            lon: placed[1],
            source: 'country-pool',
            countryKey: country.key
          };
        }
        // The anchor itself is outside the country it belongs to — a state
        // cluster built from coordinates that were wrong. Fall through to the
        // pool rather than trust it.
      }
    }

    {
      const seed = fnv1a(station.stationuuid || station.name || country.key);
      const point = pointForSlot(country, seed % POINTS_PER_COUNTRY);
      if (point) {
        // Apply a small per-station jitter so colliding pool indices
        // don't stack on the same pixel. Range ~0.12° (~13 km at the
        // equator) — small enough to almost always stay inside the
        // country, big enough to be visible at zoom levels people use
        // for "Russia at a glance".
        const jitterRng = mulberry32(seed ^ 0x9e3779b9);
        const jitterLat = (jitterRng() - 0.5) * 0.24;
        const jitterLon = (jitterRng() - 0.5) * 0.24;
        // The pool point itself passed geoContains when the pool was built, so
        // the fallback inside keepInsideCountry is always a legal position.
        const placed =
          keepInsideCountry(country, point[0], point[1], jitterLat, jitterLon) ??
          ([clampLat(point[0]), clampLon(point[1])] as CountryPoint);
        return {
          lat: placed[0],
          lon: placed[1],
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
  // No centroid: fall back to any point already sampled inside this country.
  const anySlot = record.slotPoints?.values().next().value;
  if (anySlot) {
    const [lat, lon] = anySlot;
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
