import assert from 'node:assert/strict';
import test from 'node:test';

import { createCatalogToolProvider, type CatalogServiceLike } from '../src/ai/catalogToolProvider.js';

type Row = {
  stationuuid: string;
  name: string;
  tags?: string | null;
  url_resolved?: string | null;
};

// A ranked search result mixing music with spoken-word/news formats — exactly
// what «что послушать сегодня?» surfaced in the prod audit (France Info / BBC /
// RTL among the jazz).
const ROWS: Row[] = [
  { stationuuid: 'jz1', name: 'Paris Jazz', tags: 'jazz', url_resolved: 'http://s/jz1' },
  { stationuuid: 'fi', name: 'France Info', tags: 'news, talk, actualité', url_resolved: 'http://s/fi' },
  { stationuuid: 'bbc', name: 'BBC World Service', tags: 'news, spoken word', url_resolved: 'http://s/bbc' },
  { stationuuid: 'rtl', name: 'RTL', tags: 'talk, info', url_resolved: 'http://s/rtl' },
  { stationuuid: 'jz2', name: 'Smooth Jazz', tags: 'jazz, lounge', url_resolved: 'http://s/jz2' }
];

const catalogOf = (rows: Row[]): CatalogServiceLike => ({
  // honour the limit the provider asks for (it over-fetches to leave room after
  // filtering), so we can prove the genre set is still full of MUSIC.
  search: async (filters) => ({ items: rows.slice(0, filters.limit) }),
  getStationById: async () => null,
  getSummary: async () => ({})
});

test('searchStations: talk/news formats are dropped from MUSIC recommendations', async () => {
  const tools = createCatalogToolProvider(catalogOf(ROWS));
  const out = await tools.searchStations({ query: 'jazz' });
  assert.deepEqual(
    out.map((s) => s.stationuuid),
    ['jz1', 'jz2'], // France Info / BBC / RTL filtered out
    JSON.stringify(out.map((s) => s.name))
  );
});

test('searchStations: talk/news is KEPT when the user explicitly asked for it', async () => {
  const tools = createCatalogToolProvider(catalogOf(ROWS));
  const news = await tools.searchStations({ query: 'news' });
  assert.ok(news.some((s) => s.stationuuid === 'fi'), 'France Info kept for a news query');

  const talkTag = await tools.searchStations({ query: 'что послушать', tag: 'talk' });
  assert.ok(talkTag.some((s) => s.stationuuid === 'rtl'), 'talk kept when the tag asks for it');
});

test('searchStations: a Russian «разговорное» request also keeps talk', async () => {
  const tools = createCatalogToolProvider(catalogOf(ROWS));
  const out = await tools.searchStations({ query: 'разговорное радио' });
  // wantsTalk → no filtering → the non-music rows survive alongside any music.
  assert.ok(out.length >= 3, 'talk request is not stripped');
});

test('discoverTrending: talk/news is dropped from the discovery rails («что послушать» path)', async () => {
  // The vague «что послушать сегодня?» routes through discover_trending, NOT
  // search_stations — so this path needs its own talk filter (it leaked RTL /
  // France Info in prod). discover_trending has no user query, so talk is always
  // excluded here.
  const catalog: CatalogServiceLike = {
    search: async () => ({ items: [] }),
    getStationById: async () => null,
    getSummary: async () => ({
      moodRails: [{ id: 'late-night', stations: ROWS }],
      trending: ROWS
    })
  };
  const tools = createCatalogToolProvider(catalog);
  const rails = await tools.discoverTrending('seed');
  const ids = rails.flatMap((rail) => rail.stations.map((s) => s.stationuuid));
  assert.ok(!ids.includes('fi') && !ids.includes('bbc') && !ids.includes('rtl'), 'talk/news filtered from trending + rails');
  assert.ok(ids.includes('jz1'), 'music stations survive');
});