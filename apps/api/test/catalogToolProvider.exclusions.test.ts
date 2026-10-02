import assert from 'node:assert/strict';
import test from 'node:test';

import { createCatalogToolProvider, type CatalogServiceLike } from '../src/ai/catalogToolProvider.js';
import { createStationExclusionMatcher } from '../src/ai/stationExclusions.js';

type Row = {stationuuid: string; name: string; country?: string | null; tags?: string | null; url_resolved?: string | null};
const row = (stationuuid: string, name: string, country = 'United States', tags = 'jazz', url = `https://radio.test/${stationuuid}`): Row =>
  ({stationuuid, name, country, tags, url_resolved: url});
const catalogOf = (rows: Row[], lookups: Record<string, Row | null> = {}): CatalogServiceLike => ({
  search: async () => ({items: rows}),
  getStationById: async id => lookups[id] || null,
  getSummary: async () => ({}),
  getCatalog: async () => rows
});

test('regular ranked search refills past mirror-heavy pages and caps after exclusions', async () => {
  const excluded = row('last', 'First station', 'United States', 'jazz', 'http://stream.test/live?channel=a#player');
  const aliases = [
    ...Array.from({length: 24}, (_, i) => row(`mirror-${i}`, `Mirror ${i}`, 'USA', 'jazz', `http://stream.test/live?channel=a#frag${i}`)),
    ...Array.from({length: 24}, (_, i) => row(`distinct-${i}`, `Distinct ${i}`))
  ];
  const calls: number[] = [];
  const catalog = catalogOf(aliases, {last: excluded});
  catalog.search = async filters => {
    calls.push(filters.cursor);
    return {items: aliases.slice(filters.cursor, filters.cursor + filters.limit), nextCursor: filters.cursor + filters.limit < aliases.length ? String(filters.cursor + filters.limit) : null};
  };
  const out = await createCatalogToolProvider(catalog).searchStations({query: 'jazz', limit: 4, excludeStationIds: ['last']});
  assert.deepEqual(out.map(item => item.stationuuid), ['distinct-0', 'distinct-1', 'distinct-2', 'distinct-3']);
  assert.deepEqual(calls, [0, 12, 24]);
});

test('ranked search keeps country aliases and stops at the configured three-page bound', async () => {
  const anchor = row('anchor', 'Hidden', 'United States', 'jazz', 'http://s/anchor');
  const rows = [row('us1', 'US One', 'United States'), row('us2', 'US Two', 'United States')];
  const catalog = catalogOf([...rows, row('legacy', 'Legacy', 'USA')], {anchor});
  const calls: Array<{country: string; cursor: number}> = [];
  catalog.search = async filters => {
    calls.push({country: filters.country, cursor: filters.cursor});
    if (filters.country === 'USA') return {items: [row('legacy', 'Legacy', 'USA')]};
    if (filters.cursor === 0) return {items: [anchor, ...Array.from({length: filters.limit - 1}, (_, i) => row(`m${i}`, `M${i}`, 'United States', 'jazz', 'http://s/anchor'))], nextCursor: '12'};
    return {items: [], nextCursor: null};
  };
  await createCatalogToolProvider(catalog).searchStations({query: 'jazz', country: 'United States', excludeStationIds: ['anchor']});
  assert.ok(calls.some(call => call.country === 'USA'), 'legacy country label is searched');
  assert.ok(calls.filter(call => call.country === 'United States').length <= 3, 'each alias is limited to three pages');
});

test('same stream with different names is excluded while query and protocol remain identity', async () => {
  const anchor = row('a', 'Anchor', 'Japan', '', 'http://host.test/live?mount=one#old');
  const candidates = [
    row('same-stream', 'Unrelated name', 'France', '', 'http://host.test/live?mount=one#new'),
    row('different-query', 'Different channel', 'France', '', 'http://host.test/live?mount=two'),
    row('different-protocol', 'Secure channel', 'France', '', 'https://host.test/live?mount=one')
  ];
  const out = await createCatalogToolProvider(catalogOf(candidates, {a: anchor})).searchStations({query: 'radio', excludeStationIds: ['a']});
  assert.deepEqual(out.map(item => item.stationuuid), ['different-query', 'different-protocol']);
});

test('confirmed names ignore codec suffixes, preserving Classic/2 and country distinctions', async () => {
  const anchor = row('a', 'Soma FM Groove Salad 320K AAC HLS', 'United States');
  const candidates = [
    row('codec', 'Soma FM Groove Salad MP3 128K', 'USA'),
    row('classic', 'Soma FM Groove Salad Classic', 'United States'),
    row('two', 'Soma FM Groove Salad 2', 'United States'),
    row('other-country', 'Soma FM Groove Salad', 'Canada'),
    row('same-brand', 'Soma FM Drone Zone', 'United States')
  ];
  const out = await createCatalogToolProvider(catalogOf(candidates, {a: anchor})).searchStations({query: 'radio', excludeStationIds: ['a']});
  assert.deepEqual(out.map(item => item.stationuuid), ['classic', 'two', 'other-country', 'same-brand']);
});

test('unknown countries and failed or wrong-UUID lookups do not merge names', async () => {
  const rows = [row('unknown', 'Same Name Radio', '', '', 'http://s/unknown'), row('known', 'Same Name Radio', 'Atlantis', '', 'http://s/known')];
  let lookupCount = 0;
  const matcher = await createStationExclusionMatcher(['missing', 'wrong', 'throws', 'missing'], async id => {
    lookupCount += 1;
    if (id === 'wrong') return row('not-wrong', 'Same Name Radio', 'Atlantis');
    if (id === 'throws') throw new Error('lookup unavailable');
    return null;
  });
  assert.equal(lookupCount, 3, 'unique lookup IDs only');
  assert.ok(!matcher(rows[0]!));
  assert.ok(!matcher(rows[1]!));
  assert.ok(matcher(row('missing', 'Unrelated')) , 'explicit UUID remains excluded after null lookup');
  assert.ok(matcher(row('wrong', 'Unrelated')), 'wrong UUID is still explicitly excluded');
  const unknownCountry = await createStationExclusionMatcher(['unknown-anchor'], async id =>
    id === 'unknown-anchor' ? row(id, 'Same Name Radio', '') : null);
  assert.ok(!unknownCountry(rows[0]!), 'names without a known country do not confirm a mirror');
  assert.ok(!unknownCountry(rows[1]!), 'an unknown-country name does not merge into a known country');
});

test('requiredGenre, nearSource and relatedTo lanes exclude confirmed mirrors before their cap', async () => {
  const anchor = row('anchor', 'Soma FM Groove Salad 320K', 'United States', 'jazz');
  const mirrors = [
    row('same-name', 'Soma FM Groove Salad AAC', 'USA', 'jazz'),
    row('same-stream', 'Other label', 'Canada', 'jazz', 'http://s/anchor-stream')
  ];
  const distinct = Array.from({length: 12}, (_, i) => row(`ok-${i}`, `Independent ${i}`, 'Canada', 'jazz'));
  const catalog = catalogOf([...mirrors, ...distinct], {
    anchor: {...anchor, url_resolved: 'http://s/anchor-stream'},
    'known-mirror': mirrors[0]!
  });
  const provider = createCatalogToolProvider(catalog);
  const genre = await provider.searchStations({query: '', requiredGenre: 'jazz', excludeStationIds: ['anchor', 'known-mirror'], limit: 4});
  assert.deepEqual(genre.map(item => item.stationuuid), ['ok-0', 'ok-1', 'ok-2', 'ok-3']);
  const near = await provider.searchStations({query: '', nearSource: {
    stationuuid: 'anchor', name: anchor.name, country: anchor.country!, url_resolved: 'http://s/anchor-stream', tags: ['jazz']
  }, excludeStationIds: ['anchor', 'known-mirror'], limit: 4});
  assert.deepEqual(near.map(item => item.stationuuid), ['ok-0', 'ok-1', 'ok-2', 'ok-3']);
  const related = await provider.searchStations({query: '', relatedTo: {
    stationuuid: 'anchor', country: 'United States', genres: ['jazz']
  }, excludeStationIds: ['anchor', 'known-mirror'], limit: 4});
  assert.deepEqual(related.map(item => item.stationuuid), ['ok-0', 'ok-1', 'ok-2', 'ok-3']);
});

test('excluded ID lookup work is bounded to 128 unique IDs', async () => {
  let count = 0;
  const ids = Array.from({length: 160}, (_, i) => `id-${i}`).concat('id-0');
  const matcher = await createStationExclusionMatcher(ids, async id => { count += 1; return row(id, id); });
  assert.equal(count, 128);
  assert.ok(matcher(row('id-127', 'unrelated')));
  assert.ok(matcher(row('id-128', 'unrelated')), 'UUIDs after the lookup bound remain explicitly excluded');
  assert.ok(!matcher(row('other-128', 'id-128', 'United States')), 'an ID without a resolved anchor contributes no mirror identity');
});

test('bounded station lookups run sequentially', async () => {
  let active = 0;
  let maxActive = 0;
  let count = 0;
  const ids = Array.from({length: 128}, (_, i) => `sequential-${i}`);
  await createStationExclusionMatcher(ids, async id => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise<void>(resolve => setTimeout(resolve, 1));
    count += 1;
    active -= 1;
    return row(id, id);
  });
  assert.equal(count, 128);
  assert.equal(maxActive, 1, 'catalogue profile rebuild work never overlaps');
});
