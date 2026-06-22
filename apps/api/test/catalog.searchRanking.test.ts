import assert from 'node:assert/strict';
import test from 'node:test';
import { attachSearchIndex, buildSearchResponse, type CatalogStation } from '../src/catalog/service.js';

type Filters = Parameters<typeof buildSearchResponse>[1];

const station = (over: Partial<CatalogStation>): CatalogStation => ({
  stationuuid: 'id',
  name: '',
  url: '',
  url_resolved: '',
  homepage: '',
  favicon: '',
  tags: '',
  country: '',
  countrycode: '',
  state: '',
  language: '',
  codec: '',
  bitrate: 0,
  geo_lat: null,
  geo_long: null,
  ...over
});

const f = (over: Partial<Filters> = {}): Filters => ({
  q: '',
  country: '',
  language: '',
  tag: '',
  continent: '',
  limit: 100,
  cursor: 0,
  ...over
});

// best: reachable, high bitrate, AAC, very popular. low: reachable but weak.
// dead: Radio Browser confirmed broken (lastcheckok 0) → must sink last even
// though it has decent bitrate/votes.
const fixture: CatalogStation[] = [
  station({ stationuuid: 'dead', name: 'Jazz Dead', tags: 'jazz', lastcheckok: 0, bitrate: 128, codec: 'MP3', votes: 200 }),
  station({ stationuuid: 'low', name: 'Jazz Low', tags: 'jazz', lastcheckok: 1, bitrate: 64, codec: 'MP3', votes: 2 }),
  station({ stationuuid: 'best', name: 'Jazz Best', tags: 'jazz', lastcheckok: 1, bitrate: 256, codec: 'AAC', votes: 5000, clickcount: 9000 })
];

test('search items are ordered by quality — reachable + high-bitrate + popular first, dead last', () => {
  const indexed = attachSearchIndex(fixture);
  const ids = buildSearchResponse(indexed, f({ q: 'jazz' })).items.map((s) => s.stationuuid);
  assert.deepEqual(ids, ['best', 'low', 'dead']);
});

test('the quality sort preserves the precompute === live invariant', () => {
  const indexed = attachSearchIndex(fixture);
  const live = buildSearchResponse(fixture, f({ q: 'jazz' }));
  const pre = buildSearchResponse(indexed, f({ q: 'jazz' }));
  assert.deepEqual(pre, live);
});

test('equal-quality stations keep their original (stable) order', () => {
  const flat = [
    station({ stationuuid: 'a', name: 'Pop A', tags: 'pop' }),
    station({ stationuuid: 'b', name: 'Pop B', tags: 'pop' }),
    station({ stationuuid: 'c', name: 'Pop C', tags: 'pop' })
  ];
  const ids = buildSearchResponse(attachSearchIndex(flat), f({ q: 'pop' })).items.map((s) => s.stationuuid);
  assert.deepEqual(ids, ['a', 'b', 'c']);
});

test('facet counts and total are unaffected by the quality sort (computed over all matches)', () => {
  const response = buildSearchResponse(attachSearchIndex(fixture), f({ q: 'jazz' }));
  assert.equal(response.total, 3);
  assert.ok(response.facets.tags.includes('jazz'));
});
