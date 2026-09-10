import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSearchResponse, type CatalogStation } from '../src/catalog/service.js';

const station = (id: number, tags = 'ambient'): CatalogStation => ({
  stationuuid: `mood-${id}`, name: `Station ${id}`, tags,
  url: 'https://example.test/stream', url_resolved: 'https://example.test/stream',
  homepage: '', favicon: '', country: `Country ${id}`, countrycode: '', state: '',
  language: '', codec: 'MP3', bitrate: 128, geo_lat: null, geo_long: null
});
const filters = { q: '', country: '', language: '', tag: '', continent: '', limit: 30, cursor: 0, seed: 1234 };

test('a mood explores its full exact-tag union beyond the ten-station preview', () => {
  const stations = [...Array.from({ length: 65 }, (_, i) => station(i, i % 2 ? ' AMBIENT , jazz' : 'lounge')),
    station(66, 'ambient talk show'), station(67, 'rock')];
  const first = buildSearchResponse(stations, { ...filters, mood: 'mood-late-night' });
  const second = buildSearchResponse(stations, { ...filters, mood: 'mood-late-night', cursor: 30 });
  const last = buildSearchResponse(stations, { ...filters, mood: 'mood-late-night', cursor: 60 });
  assert.equal(first.total, 65);
  assert.equal(first.nextCursor, '30');
  assert.equal(second.nextCursor, '60');
  assert.equal(last.nextCursor, null);
  const ids = [...first.items, ...second.items, ...last.items].map(s => s.stationuuid);
  assert.equal(new Set(ids).size, 65);
  assert.ok(!ids.includes('mood-66'));
  assert.ok(!ids.includes('mood-67'));
  assert.equal(buildSearchResponse(stations, { ...filters, mood: 'unknown' }).total, 0);
  assert.equal(buildSearchResponse(stations, { ...filters, mood: 'mood-late-night', country: 'Country 5' }).total, 1);
});

test('country chooser facets do not silently stop at eighty countries', () => {
  const result = buildSearchResponse(Array.from({ length: 120 }, (_, i) => station(i)), { ...filters, limit: 1 });
  assert.equal(result.items.length, 1);
  assert.equal(result.facets.countries.length, 120);
});
