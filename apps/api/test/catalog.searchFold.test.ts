import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachSearchIndex,
  buildSearchResponse,
  normalizeQuery,
  type CatalogStation
} from '../src/catalog/service.js';

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

test('normalizeQuery folds Cyrillic ё→е and lowercases, leaving Latin untouched', () => {
  assert.equal(normalizeQuery('Ёлка FM'), 'елка fm');
  assert.equal(normalizeQuery('ВЕСЁЛЫЙ Дэнс'), 'веселый дэнс');
  // Latin "yo" must NOT be folded — the fold is Cyrillic-only.
  assert.equal(normalizeQuery('Yo Radio'), 'yo radio');
});

const fixture: CatalogStation[] = [
  station({ stationuuid: 'a', name: 'Ёлка FM', tags: 'новогоднее,ёлка', country: 'Russia', language: 'russian' }),
  station({ stationuuid: 'b', name: 'Елка Hits', tags: 'pop', country: 'Russia', language: 'russian' }),
  station({ stationuuid: 'c', name: 'Jazz Paris', tags: 'jazz', country: 'France', language: 'french' })
];

test('a query typed with е matches a station spelled with ё (name + tag)', () => {
  const indexed = attachSearchIndex(fixture);
  // normalizeQuery('ёлка') → 'елка'; the indexed haystack folds 'Ёлка' → 'елка' too.
  const byE = buildSearchResponse(indexed, f({ q: normalizeQuery('елка') }));
  const ids = byE.items.map((s) => s.stationuuid).sort();
  assert.deepEqual(ids, ['a', 'b'], 'both «Ёлка FM» and «Елка Hits» match «елка»');

  const byYo = buildSearchResponse(indexed, f({ q: normalizeQuery('ёлка') }));
  assert.deepEqual(byYo.items.map((s) => s.stationuuid).sort(), ['a', 'b'], '«ёлка» matches the same set');

  // Tag side folds too (route normalizes the tag query via normalizeQuery).
  const byTag = buildSearchResponse(indexed, f({ tag: normalizeQuery('елка') }));
  assert.deepEqual(byTag.items.map((s) => s.stationuuid), ['a'], '«Ёлка FM» found by tag «елка»');
});

test('the ё→е fold preserves the precompute === live invariant', () => {
  const indexed = attachSearchIndex(fixture);
  for (const q of ['елка', 'ёлка', 'jazz']) {
    const live = buildSearchResponse(fixture, f({ q: normalizeQuery(q) }));
    const pre = buildSearchResponse(indexed, f({ q: normalizeQuery(q) }));
    assert.deepEqual(pre, live, `precompute must equal live for q=${q}`);
  }
});
