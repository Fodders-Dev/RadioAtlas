import assert from 'node:assert/strict';
import test from 'node:test';

import { createCatalogToolProvider, type CatalogServiceLike } from '../src/ai/catalogToolProvider.js';
import { placeMatchesQuery } from '../src/catalog/service.js';

type Row = {
  stationuuid: string;
  name: string;
  country?: string | null;
  state?: string | null;
  tags?: string | null;
  url_resolved?: string | null;
};

// Production, 11.09.2026: asked about Tokyo, Лира offered «Radio Art — Tokyo»
// from Greece next to Japanese stations without a word about the difference.
// The word in a name is not a location.
const ROWS: Row[] = [
  { stationuuid: 'art', name: 'Radio Art — Tokyo', country: 'Greece', state: '', tags: 'ambient', url_resolved: 'http://s/art' },
  { stationuuid: 'jwave', name: 'J-WAVE', country: 'Japan', state: 'Tokyo', tags: 'pop', url_resolved: 'http://s/jwave' },
  { stationuuid: 'tfm', name: 'Tokyo FM', country: 'Japan', state: '', tags: 'pop', url_resolved: 'http://s/tfm' },
  { stationuuid: 'inter', name: 'InterFM', country: 'Japan', state: 'Tokyo', tags: 'jazz', url_resolved: 'http://s/inter' }
];

const catalogOf = (rows: Row[]): CatalogServiceLike => ({
  search: async (filters) => ({ items: rows.slice(0, filters.limit) }),
  getStationById: async () => null,
  getSummary: async () => ({}),
  getCatalog: async () => rows
});

test('placeMatchesQuery: whole-word match on state or country, never on the name', () => {
  assert.equal(placeMatchesQuery({ state: 'Tokyo', country: 'Japan' }, 'tokyo'), true);
  assert.equal(placeMatchesQuery({ state: '', country: 'Japan' }, 'Japan'), true);
  assert.equal(placeMatchesQuery({ state: '', country: 'Greece' }, 'tokyo'), false);
  assert.equal(placeMatchesQuery({ state: 'Tokyo-to', country: 'Japan' }, 'tokyo'), true);
  assert.equal(placeMatchesQuery({ state: 'Stockton', country: 'USA' }, 'tock'), false);
});

test('searchStations: a name-only match from another country is not offered for a place query', async () => {
  const tools = createCatalogToolProvider(catalogOf(ROWS));
  const out = await tools.searchStations({ query: 'Tokyo' });
  assert.deepEqual(out.map((s) => s.stationuuid), ['jwave', 'tfm', 'inter'], JSON.stringify(out.map((s) => s.name)));
});

test('searchStations: without any located station the name matches are kept', async () => {
  const tools = createCatalogToolProvider(catalogOf(ROWS.slice(0, 1)));
  const out = await tools.searchStations({ query: 'Tokyo' });
  assert.deepEqual(out.map((s) => s.stationuuid), ['art']);
});
