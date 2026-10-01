import assert from 'node:assert/strict';
import test from 'node:test';

import { createCatalogToolProvider, type CatalogServiceLike } from '../src/ai/catalogToolProvider.js';
import { catalogueTagEvidence } from '../src/ai/catalogueTagEvidence.js';
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

test('explicit country aliases constrain ranked search before cap',async()=>{
  const rows:Row[]=[...Array.from({length:30},(_,i)=>({stationuuid:`fr-${i}`,name:'Jazz French',country:'France',tags:'jazz',url_resolved:'http://s/fr'})),
    {stationuuid:'us',name:'Jazz US',country:'United States of America',tags:'jazz',url_resolved:'http://s/us'},
    {stationuuid:'cz',name:'Jazz CZ',country:'Czech Republic',tags:'jazz',url_resolved:'http://s/cz'}];
  const seen:string[]=[];
  const tools=createCatalogToolProvider({...catalogOf(rows),search:async filters=>{
    seen.push(filters.country);
    return {items:rows.filter(row=>!filters.country || row.country===filters.country).slice(0,filters.limit)};
  }});
  assert.deepEqual((await tools.searchStations({query:'jazz',country:'United States',limit:1})).map(s=>s.stationuuid),['us']);
  assert.deepEqual((await tools.searchStations({query:'jazz',country:'Czechia',limit:1})).map(s=>s.stationuuid),['cz']);
  assert.deepEqual(seen,['United States of America','Czech Republic']);
});

test('searchStations promotes recognized catalogue genres ahead of alphabetic metadata and caps six', async () => {
  const row: Row = {
    stationuuid: 'funky-disco', name: 'FUNKY RADIO', country: 'United States',
    tags: '60s,70s,70s disco,80s,black,black music,funk,soul,disco,Funk', url_resolved: 'http://s/funky'
  };
  const tools = createCatalogToolProvider(catalogOf([row]));
  const [station] = await tools.searchStations({ query: 'funk' });
  assert.ok(station);
  assert.deepEqual(station.tags, ['funk', 'soul', 'disco', '60s', '70s', '70s disco']);
  assert.ok(station.tags.length <= 6);
});

test('getStation promotes recognized catalogue genres while retaining source labels', async () => {
  const row: Row = {
    stationuuid: 'funky-disco', name: 'FUNKY RADIO', country: 'United States',
    tags: '60s,70s,70s disco,80s,black,black music,funk,soul,disco,FUNK', url_resolved: 'http://s/funky'
  };
  const tools = createCatalogToolProvider({ ...catalogOf([]), getStationById: async () => row });
  const station = await tools.getStation('funky-disco');
  assert.ok(station);
  assert.deepEqual(station.tags, ['funk', 'soul', 'disco', '60s', '70s', '70s disco']);
  assert.ok(station.tags.length <= 6);
});

test('tag parsing handles empty tags without inferring genres from station names', async () => {
  const rows: Row[] = [
    { stationuuid: 'empty', name: 'FUNK SOUL DISCO RADIO', tags: null, url_resolved: 'http://s/empty' },
    { stationuuid: 'none', name: 'FUNK RADIO', tags: 'No tags', url_resolved: 'http://s/none' },
    { stationuuid: 'unknown', name: 'FUNK SOUL DISCO', tags: '60s,80s,space disco', url_resolved: 'http://s/unknown' }
  ];
  const tools = createCatalogToolProvider({ ...catalogOf(rows), getStationById: async (id) => rows.find((row) => row.stationuuid === id) || null });
  assert.deepEqual((await tools.searchStations({ query: 'radio' })).map((station) => station.tags), [[], [], ['60s', '80s', 'space disco']]);
  assert.deepEqual((await tools.getStation('empty'))?.tags, []);
  assert.deepEqual((await tools.getStation('none'))?.tags, []);
  assert.deepEqual((await tools.getStation('unknown'))?.tags, ['60s', '80s', 'space disco']);
});

test('late exclusion tags stay private evidence while JSON exposes only six display tags', async () => {
  const rawTags = ['60s', '70s', '70s disco', '80s', 'black', 'black music', 'funk', 'soul', 'disco', 'hardcore',
    ...Array.from({ length: 90 }, (_, index) => `metadata-${index}`)].join(',');
  const row: Row = {
    stationuuid: 'evidence', name: 'FUNKY RADIO', tags: rawTags, url_resolved: 'http://s/evidence'
  };
  const tools = createCatalogToolProvider({ ...catalogOf([]), getStationById: async () => row });
  const station = await tools.getStation('evidence');
  assert.ok(station);
  assert.deepEqual(station.tags, ['funk', 'soul', 'disco', '60s', '70s', '70s disco']);
  assert.deepEqual(JSON.parse(JSON.stringify(station)), {
    stationuuid: 'evidence', name: 'FUNKY RADIO', country: '',
    tags: ['funk', 'soul', 'disco', '60s', '70s', '70s disco'], favicon: '', url_resolved: 'http://s/evidence'
  });
  const evidence = catalogueTagEvidence(station);
  assert.ok(evidence.includes('hardcore'));
  assert.equal(evidence.length, 80);
  assert.ok(evidence.every((tag) => tag.length <= 80));
  assert.ok(!Object.keys(station).some((key) => key.toLowerCase().includes('evidence')));
});
