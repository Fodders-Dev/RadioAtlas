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

test('typed search ignores browse seed and stays quality-first', () => {
  const indexed = attachSearchIndex(fixture);
  const seedOne = buildSearchResponse(indexed, f({ q: 'jazz', seed: 1 })).items.map((s) => s.stationuuid);
  const seedTwo = buildSearchResponse(indexed, f({ q: 'jazz', seed: 999 })).items.map((s) => s.stationuuid);
  assert.deepEqual(seedOne, ['best', 'low', 'dead']);
  assert.deepEqual(seedTwo, seedOne);
});

test('browse search uses seed so the opening page is not the same global leaders forever', () => {
  const browseFixture = attachSearchIndex(
    Array.from({ length: 16 }, (_, index) =>
      station({
        stationuuid: `browse-${index}`,
        name: `Browse ${index}`,
        tags: 'music',
        lastcheckok: 1,
        bitrate: 128,
        codec: 'MP3',
        votes: 10,
        clickcount: 10
      })
    )
  );
  const seedOne = buildSearchResponse(browseFixture, f({ limit: 8, seed: 11 })).items.map((s) => s.stationuuid);
  const seedTwo = buildSearchResponse(browseFixture, f({ limit: 8, seed: 42 })).items.map((s) => s.stationuuid);
  assert.notDeepEqual(seedOne, seedTwo);
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

// AI/Лира relevance ordering (opt-in): a real genre station must beat a more-
// popular station that only substring-matches the query, so «соул» stops
// returning generic/chillout and «мимо» picks. The HTTP Search path (no
// relevance flag) is unchanged — popularity still wins there.
test('relevance ordering lifts an exact-genre station above a popular substring match', () => {
  const stations = attachSearchIndex([
    // Mega-popular but NOT a soul station — only its NAME contains "soul".
    station({
      stationuuid: 'namehit',
      name: 'Soulful Pop',
      tags: 'pop, dance',
      lastcheckok: 1,
      bitrate: 256,
      codec: 'AAC',
      votes: 99999,
      clickcount: 99999
    }),
    // A real soul station, barely voted.
    station({
      stationuuid: 'realsoul',
      name: 'Deep Soul',
      tags: 'soul',
      lastcheckok: 1,
      bitrate: 128,
      codec: 'MP3',
      votes: 10
    })
  ]);
  // Default (UI) ordering: popularity wins → the pop station leads.
  const popularityFirst = buildSearchResponse(stations, f({ q: 'soul' })).items.map((s) => s.stationuuid);
  assert.deepEqual(popularityFirst, ['namehit', 'realsoul']);
  // AI relevance ordering: the actual soul station leads.
  const relevanceFirst = buildSearchResponse(stations, f({ q: 'soul', relevance: true })).items.map(
    (s) => s.stationuuid
  );
  assert.deepEqual(relevanceFirst, ['realsoul', 'namehit']);
});

test('relevance tag matching is word-aware — "soul" does not reward "Seoul"', () => {
  const stations = attachSearchIndex([
    station({ stationuuid: 'seoul', name: 'Seoul FM', tags: 'kpop', country: 'Seoul', lastcheckok: 1, votes: 5000 }),
    station({ stationuuid: 'soul', name: 'Night Soul', tags: 'soul, jazz', lastcheckok: 1, votes: 5 })
  ]);
  const ids = buildSearchResponse(stations, f({ q: 'soul', relevance: true })).items.map((s) => s.stationuuid);
  assert.equal(ids[0], 'soul');
});
