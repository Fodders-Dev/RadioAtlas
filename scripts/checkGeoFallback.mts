// Audits where the globe actually puts its dots.
//
// This used to be a re-implementation: the script carried its own copy of the
// sampling constants and its own containment loop, and answered questions about
// that copy. The copy drifted — it was still sampling 196 points per country
// after the resolver moved to 2048, it never applied the resolver's per-station
// jitter, and it had no idea state anchors existed. It reported
// `stationsOutsideCountry: 0` while the product was placing 583 synthesized
// dots inside a NEIGHBOURING country.
//
// So it imports the real `geoResolver.ts` now, feeds it the catalogue in the
// shape `/catalog/points` uses, and builds the state anchors the way
// GlobeScreen does. What it measures is what a listener sees.
//
//   npm run geo:check                 # artifacts/catalog-full.json
//   CATALOG_PATH=<file> npm run geo:check

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { geoContains } from 'd3-geo';
import {
  buildStateAnchors,
  getCountryGeoIndex,
  resolveStationCoords,
  setStateAnchors
} from '../apps/webapp/src/lib/geoResolver';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const CATALOG_PATH = process.env.CATALOG_PATH || join(ROOT, 'artifacts', 'catalog-full.json');

// Outside its own polygon splits into two very different defects, and counting
// them together is how a number stops meaning anything. A dot inside ANOTHER
// country is a visible lie — a Dutch station shown in Germany. A dot outside
// every polygon is nearly always the 110m world being coarse: a coastal city
// sits a few kilometres off a simplified shoreline, and nobody can see it.
const MAX_OFF_POLYGON_RATE = 0.01;

type Row = {
  stationuuid: string;
  name?: string;
  country?: string | null;
  state?: string | null;
  geo_lat?: number | null;
  geo_long?: number | null;
};

const rows: Row[] = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));

let zeroedCoords = 0;
let invalidGeo = 0;
for (const row of rows) {
  const lat = typeof row.geo_lat === 'number' ? row.geo_lat : null;
  const lon = typeof row.geo_long === 'number' ? row.geo_long : null;
  if (lat === null || lon === null) continue;
  if (Math.abs(lat) < 0.000001 && Math.abs(lon) < 0.000001) {
    zeroedCoords += 1;
  } else if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    invalidGeo += 1;
  }
}

const points = rows.map((row) => ({
  id: row.stationuuid,
  country: row.country ?? null,
  state: row.state ?? null,
  lat: typeof row.geo_lat === 'number' ? row.geo_lat : null,
  lon: typeof row.geo_long === 'number' ? row.geo_long : null
}));

setStateAnchors(buildStateAnchors(points));
const index = getCountryGeoIndex();
const countryList = [...index.countries.values()].filter((record) => record.feature);

const stats = {
  catalogSize: rows.length,
  placedFromStationCoords: 0,
  synthesized: 0,
  unresolvedCountry: 0,
  synthesizedInAnotherCountry: 0,
  synthesizedOffPolygon: 0,
  stationCoordsInAnotherCountry: 0,
  zeroedCoords,
  invalidGeo
};
const offenders: string[] = [];

for (const point of points) {
  const resolved = resolveStationCoords({
    stationuuid: point.id,
    country: point.country,
    state: point.state,
    geo_lat: point.lat,
    geo_long: point.lon
  });
  if (!resolved) {
    stats.unresolvedCountry += 1;
    continue;
  }
  const synthesized = resolved.source !== 'station';
  if (synthesized) stats.synthesized += 1;
  else stats.placedFromStationCoords += 1;

  const record = index.resolveCountry(point.country);
  if (!record || !record.feature) continue;
  if (geoContains(record.feature as never, [resolved.lon, resolved.lat])) continue;

  // Which country did it land in? Only asked for the dots that missed, so the
  // scan over every polygon costs nothing on a healthy catalogue.
  let landedIn: string | null = null;
  for (const other of countryList) {
    if (other.key === record.key) continue;
    if (geoContains(other.feature as never, [resolved.lon, resolved.lat])) {
      landedIn = other.name;
      break;
    }
  }
  if (!synthesized) {
    if (landedIn) stats.stationCoordsInAnotherCountry += 1;
    continue;
  }
  if (landedIn) {
    stats.synthesizedInAnotherCountry += 1;
    if (offenders.length < 12) {
      offenders.push(
        `${record.name} → ${landedIn}  ${resolved.lat.toFixed(3)},${resolved.lon.toFixed(3)}  ${point.id}`
      );
    }
  } else {
    stats.synthesizedOffPolygon += 1;
  }
}

console.log(JSON.stringify(stats, null, 2));
if (offenders.length) {
  console.log('\nsynthesized dots drawn in the wrong country:');
  for (const line of offenders) console.log(`  ${line}`);
}

const failures: string[] = [];

// A synthesized dot is a position WE chose. There is no excuse for choosing one
// in the wrong country, and the resolver now verifies containment before it
// returns, so anything here means that guarantee broke.
if (stats.synthesizedInAnotherCountry > 0) {
  failures.push(
    `${stats.synthesizedInAnotherCountry} synthesized dots drawn inside a different country`
  );
}

const offRate = stats.synthesized ? stats.synthesizedOffPolygon / stats.synthesized : 0;
if (offRate > MAX_OFF_POLYGON_RATE) {
  failures.push(
    `${(offRate * 100).toFixed(2)}% of synthesized dots sit outside every polygon (ceiling ${(MAX_OFF_POLYGON_RATE * 100).toFixed(0)}%)`
  );
}

// Null island is not a location. The generator drops these when it writes the
// artifact (scripts/updateCatalog.mjs), so a non-zero count means either a stale
// artifact or a regression there.
if (stats.zeroedCoords > 0) {
  failures.push(`${stats.zeroedCoords} stations carry coordinates of exactly 0,0`);
}

if (stats.invalidGeo > 0) {
  failures.push(`${stats.invalidGeo} stations carry coordinates outside the valid range`);
}

if (failures.length) {
  console.error(`\ngeo:check failed\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}

console.log('\ngeo:check passed');
