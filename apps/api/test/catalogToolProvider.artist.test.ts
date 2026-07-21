import assert from 'node:assert/strict';
import test from 'node:test';

import { createCatalogToolProvider, type CatalogServiceLike } from '../src/ai/catalogToolProvider.js';
import type { CuratedArtistHit } from '../src/ai/types.js';

type Row = {
  stationuuid: string;
  name: string;
  url_resolved?: string | null;
  tags?: string | null;
  country?: string | null;
  favicon?: string | null;
};

// A live catalog (curated overlay already applied): the dedicated avaria station
// keeps the cdn mount url even though its uuid was claimed from an upstream row.
const CATALOG: Row[] = [
  {
    stationuuid: 'live-avaria',
    name: 'Радио Ваня — Дискотека Авария',
    url_resolved: 'https://icecast-radiovanya.cdnvideo.ru/rv_diskoteka_avaria',
    tags: 'радио ваня, russian'
  },
  { stationuuid: 'lp-1', name: 'Linkin Park Radio', url_resolved: 'http://s/lp', tags: 'rock' },
  {
    stationuuid: 'weeknd-1',
    name: 'Exclusively The Weeknd',
    url_resolved: 'https://streaming.exclusive.radio/er/theweeknd/icecast.audio',
    tags: 'alternative r&b, pop'
  },
  { stationuuid: 'jz', name: 'Paris Jazz', url_resolved: 'http://s/jz', tags: 'jazz' },
  { stationuuid: 'dead-cold', name: 'Coldplay Hits', url_resolved: '', tags: 'pop' } // no stream → skipped
];

const stubCatalog: CatalogServiceLike = {
  search: async () => ({ items: [] }),
  getStationById: async () => null,
  getSummary: async () => ({}),
  getCatalog: async () => CATALOG
};

const provider = createCatalogToolProvider(stubCatalog);

const avariaHit = (over: Partial<CuratedArtistHit> = {}): CuratedArtistHit => ({
  stationuuid: 'curated-radiovanya-avaria', // the FALLBACK id (not the live one)
  artist: 'Дискотека Авария',
  displayName: 'Дискотека Авария',
  name: 'Радио Ваня — Дискотека Авария',
  mount: 'rv_diskoteka_avaria',
  matchTerms: ['Радио Ваня — Дискотека Авария', 'Дискотека Авария', 'дискотека авария', 'avaria'],
  ...over
});

test('resolveArtistStation: matches the LIVE card by CDN mount (not the curated fallback uuid)', async () => {
  const card = await provider.resolveArtistStation!(avariaHit());
  assert.equal(card?.stationuuid, 'live-avaria'); // resolved to the real catalog uuid
  assert.equal(card?.url_resolved, 'https://icecast-radiovanya.cdnvideo.ru/rv_diskoteka_avaria');
});

test('resolveArtistStation: falls back to an exact NAME match when the mount is absent', async () => {
  const card = await provider.resolveArtistStation!(avariaHit({ mount: '' }));
  assert.equal(card?.stationuuid, 'live-avaria');
});

test('resolveArtistStation: nothing in the catalog matches → null', async () => {
  const card = await provider.resolveArtistStation!(
    avariaHit({ mount: 'rv_unknown', name: 'Радио Ваня — Кого-то Нет' })
  );
  assert.equal(card, null);
});

test('matchStationsByArtistName: a station whose NAME contains the artist (token-prefix) matches', async () => {
  const cards = await provider.matchStationsByArtistName!('Linkin Park');
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.stationuuid, 'lp-1'); // «Linkin Park» ⊆ «Linkin Park Radio»
});

test('matchStationsByArtistName: The Weeknd resolves the real dedicated catalog station', async () => {
  const cards = await provider.matchStationsByArtistName!('The Weeknd');
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.stationuuid, 'weeknd-1');
  assert.equal(cards[0]?.name, 'Exclusively The Weeknd');
});

test('matchStationsByArtistName: a name match with NO resolvable stream is skipped', async () => {
  const cards = await provider.matchStationsByArtistName!('Coldplay');
  assert.deepEqual(cards, []); // «Coldplay Hits» has no url_resolved
});

test('matchStationsByArtistName: an unrelated artist matches nothing; empty query → []', async () => {
  assert.deepEqual(await provider.matchStationsByArtistName!('Daft Punk'), []);
  assert.deepEqual(await provider.matchStationsByArtistName!(''), []);
});
