import assert from 'node:assert/strict';
import test from 'node:test';

import { collectVerifiedStations } from '../src/ai/antiHallucination.js';
import { createCatalogToolProvider, type CatalogServiceLike } from '../src/ai/catalogToolProvider.js';
import type { VerifiedStationRef } from '../src/ai/types.js';

type Row = {
  stationuuid: string;
  name: string;
  country?: string | null;
  tags?: string | null;
  url_resolved?: string | null;
};

const catalogOf = (rows: Row[], excluded: Row[] = []): CatalogServiceLike => ({
  search: async filters => ({
    items: rows.filter(row => !filters.country || row.country === filters.country)
      .slice(filters.cursor, filters.cursor + filters.limit),
    nextCursor: null
  }),
  getStationById: async id => excluded.find(row => row.stationuuid === id) || null,
  getSummary: async () => ({}),
  getCatalog: async () => rows
});

const collect = (stations: VerifiedStationRef[]) =>
  collectVerifiedStations([{tool: 'search_stations', args: {}, found: stations.length > 0, stations}]);

test('regular search fills requested unique cards before the collector cap', async () => {
  const rows: Row[] = [
    {stationuuid: 'pulse-aac', name: 'Pulse FM AAC', country: 'Canada', tags: 'jazz', url_resolved: 'https://one.test/pulse'},
    {stationuuid: 'pulse-mp3', name: 'pulse fm MP3', country: 'Canada', tags: 'jazz', url_resolved: 'https://two.test/pulse'},
    {stationuuid: 'stream-alt', name: 'Pulse Audio', country: 'Canada', tags: 'jazz', url_resolved: 'https://one.test/pulse#player'},
    {stationuuid: 'distinct-one', name: 'Night Jazz', country: 'Canada', tags: 'jazz', url_resolved: 'https://one.test/night'},
    {stationuuid: 'distinct-two', name: 'Blue Hour', country: 'Canada', tags: 'jazz', url_resolved: 'https://one.test/blue'}
  ];
  const stations = await createCatalogToolProvider(catalogOf(rows)).searchStations({query: 'jazz', limit: 3});

  assert.deepEqual(stations.map(row => row.stationuuid), ['pulse-aac', 'distinct-one', 'distinct-two']);
  assert.equal(collect(stations).length, 3, 'no returned card is discarded by the real collector');
});

test('bounded refill crosses a first page of normalized mirrors to reach later distinct stations', async () => {
  const rows: Row[] = [
    {stationuuid: 'pulse-0', name: 'Pulse FM', country: 'Canada', tags: 'jazz', url_resolved: 'https://pulse.test/0'},
    {stationuuid: 'pulse-1', name: 'Pulse FM AAC', country: 'Canada', tags: 'jazz', url_resolved: 'https://pulse.test/1'},
    {stationuuid: 'pulse-2', name: 'Pulse-FM MP3', country: 'Canada', tags: 'jazz', url_resolved: 'https://pulse.test/2'},
    {stationuuid: 'pulse-3', name: 'pulse fm 128k', country: 'Canada', tags: 'jazz', url_resolved: 'https://pulse.test/3'},
    {stationuuid: 'pulse-4', name: 'PULSE FM HQ', country: 'Canada', tags: 'jazz', url_resolved: 'https://pulse.test/4'},
    {stationuuid: 'pulse-5', name: 'Pulse FM OGG', country: 'Canada', tags: 'jazz', url_resolved: 'https://pulse.test/5'},
    {stationuuid: 'distinct-one', name: 'Night Jazz', country: 'Canada', tags: 'jazz', url_resolved: 'https://night.test/live'},
    {stationuuid: 'distinct-two', name: 'Blue Hour', country: 'Canada', tags: 'jazz', url_resolved: 'https://blue.test/live'}
  ];
  const calls: number[] = [];
  const catalog = catalogOf(rows);
  catalog.search = async filters => {
    calls.push(filters.cursor);
    return {
      items: rows.slice(filters.cursor, filters.cursor + filters.limit),
      nextCursor: filters.cursor + filters.limit < rows.length ? String(filters.cursor + filters.limit) : null
    };
  };
  const stations = await createCatalogToolProvider(catalog).searchStations({
    query: 'jazz', limit: 2, excludeStationIds: ['missing-anchor']
  });
  assert.deepEqual(calls, [0, 6], 'refill is bounded to the next catalog page');
  assert.deepEqual(stations.map(row => row.stationuuid), ['pulse-0', 'distinct-one']);
  assert.equal(collect(stations).length, 2);
});

test('country filtering is applied before name compaction, so another country cannot replace a local card', async () => {
  const rows: Row[] = [
    {stationuuid: 'us-a', name: 'Shared Radio', country: 'United States', tags: 'jazz', url_resolved: 'https://us.test/a'},
    {stationuuid: 'fr-same-name', name: 'Shared Radio', country: 'France', tags: 'jazz', url_resolved: 'https://fr.test/shared'},
    {stationuuid: 'us-b', name: 'Second US Radio', country: 'United States', tags: 'jazz', url_resolved: 'https://us.test/b'}
  ];
  const stations = await createCatalogToolProvider(catalogOf(rows)).searchStations({query: 'jazz', country: 'United States', limit: 2});
  assert.deepEqual(stations.map(row => row.stationuuid), ['us-a', 'us-b']);
  assert.ok(stations.every(row => row.country === 'United States'));
});

test('explicit excluded UUIDs remain excluded while later unique results fill the request', async () => {
  const excluded: Row = {stationuuid: 'shown', name: 'Shown Jazz', country: 'Canada', tags: 'jazz', url_resolved: 'https://shown.test/live'};
  const rows: Row[] = [
    excluded,
    {stationuuid: 'first-new', name: 'First New Jazz', country: 'Canada', tags: 'jazz', url_resolved: 'https://new.test/one'},
    {stationuuid: 'second-new', name: 'Second New Jazz', country: 'Canada', tags: 'jazz', url_resolved: 'https://new.test/two'}
  ];
  const stations = await createCatalogToolProvider(catalogOf(rows, [excluded])).searchStations({
    query: 'jazz', limit: 2, excludeStationIds: ['shown']
  });
  assert.deepEqual(stations.map(row => row.stationuuid), ['first-new', 'second-new']);
});
