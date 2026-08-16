import assert from 'node:assert/strict';
import test from 'node:test';

import { pickStation } from './updateCatalog.mjs';

/**
 * `npm run geo:check` audits the globe's country fallback across the whole
 * catalogue dump, and its zeroed-coordinate gate had been unreachable for
 * months because the script read a path that no longer exists. Repointed at
 * `artifacts/`, it immediately found what it was written to find: one station
 * sitting at exactly 0,0 — null island, in the Atlantic off Ghana.
 *
 * The globe's resolver already refuses those coordinates, so the station was
 * drawn in the right country anyway; what was wrong was the artifact, which
 * carried a value every consumer then had to know to ignore. This pins the
 * normalisation at the point the artifact is written.
 */

const raw = (overrides) => ({
  stationuuid: 'uuid-1',
  name: 'Test Station',
  url: 'http://stream.test/1',
  url_resolved: 'http://stream.test/1',
  country: 'Canada',
  ...overrides
});

test('exactly 0,0 is written as no coordinates at all', () => {
  const station = pickStation(raw({ geo_lat: 0, geo_long: 0 }));
  assert.equal(station.geo_lat, null);
  assert.equal(station.geo_long, null);
});

test('the string forms upstream also sends are caught', () => {
  const station = pickStation(raw({ geo_lat: '0', geo_long: '0.0' }));
  assert.equal(station.geo_lat, null);
  assert.equal(station.geo_long, null);
});

test('a real coordinate on one axis and zero on the other is kept', () => {
  // The equator and the prime meridian are real places to be. Only the pair
  // means "no data".
  const equator = pickStation(raw({ geo_lat: 0, geo_long: 12.34 }));
  assert.equal(equator.geo_lat, 0);
  assert.equal(equator.geo_long, 12.34);

  const meridian = pickStation(raw({ geo_lat: 51.5, geo_long: 0 }));
  assert.equal(meridian.geo_lat, 51.5);
  assert.equal(meridian.geo_long, 0);
});

test('coordinates outside the valid range are written as absent', () => {
  // One row in the current dump carries a latitude the Earth does not have.
  const station = pickStation(raw({ geo_lat: 340.5, geo_long: 12 }));
  assert.equal(station.geo_lat, null);
  assert.equal(station.geo_long, null);

  const longitude = pickStation(raw({ geo_lat: 51.5, geo_long: -400 }));
  assert.equal(longitude.geo_lat, null);
  assert.equal(longitude.geo_long, null);
});

test('the poles and the antimeridian are still valid places', () => {
  const pole = pickStation(raw({ geo_lat: -90, geo_long: 180 }));
  assert.equal(pole.geo_lat, -90);
  assert.equal(pole.geo_long, 180);
});

test('ordinary coordinates pass through untouched', () => {
  const station = pickStation(raw({ geo_lat: 55.75, geo_long: 37.61 }));
  assert.equal(station.geo_lat, 55.75);
  assert.equal(station.geo_long, 37.61);
});

test('missing coordinates stay missing', () => {
  const station = pickStation(raw({}));
  assert.equal(station.geo_lat, null);
  assert.equal(station.geo_long, null);
});

test('importing the module does not start a catalogue download', () => {
  // The import at the top of this file is the assertion: before `main()` was
  // guarded, loading it fetched 60k stations from Radio Browser.
  assert.equal(typeof pickStation, 'function');
});
