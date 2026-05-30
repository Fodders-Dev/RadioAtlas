import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCatalogService,
  type CatalogDependencies,
  type CatalogStation
} from '../src/catalog/service.js';

// T_api_bootwarm: warming the SERVICE-level 'full' catalog at boot must prime the
// profiled cache that the deep-link by-id (and summary) ride — so the cold-boot
// burst hits a warm cache instead of re-triggering the synchronous ~57k parse +
// withStationProfiles map (the event-loop block Caddy 503s on). This proves the
// warm covers the by-id path: after warming, getStationById does NOT re-invoke
// the underlying getCatalog dependency (i.e. no second block).

const mk = (id: string, over: Partial<CatalogStation> = {}): CatalogStation => ({
  stationuuid: id,
  name: id,
  url: '',
  url_resolved: `http://stream/${id}`,
  homepage: '',
  favicon: '',
  tags: 'pop',
  country: 'Atlantis',
  countrycode: 'AT',
  state: '',
  language: 'en',
  codec: 'MP3',
  bitrate: 128,
  geo_lat: null,
  geo_long: null,
  ...over
});

test('boot warm of the full catalog primes the profiled cache so by-id rides it (no second parse)', async () => {
  let getCatalogCalls = 0;
  let withProfilesCalls = 0;
  const deps: CatalogDependencies = {
    getCatalog: async (mode) => {
      assert.equal(mode, 'full', 'the warm and the routes use the full catalog');
      getCatalogCalls += 1;
      return [mk('a'), mk('b'), mk('c')];
    },
    withStationProfiles: async (stations) => {
      withProfilesCalls += 1;
      return stations;
    }
  };

  const service = createCatalogService(deps);

  // The boot warm.
  await service.getCatalog('full');
  assert.equal(getCatalogCalls, 1, 'warm fetches the catalogue once');
  assert.equal(withProfilesCalls, 1, 'warm runs the profile map once');

  // The deep-link path immediately after: it must hit the warm profiled cache,
  // not re-fetch/re-parse/re-map (which is what blocked the loop and 503'd).
  const station = await service.getStationById('b');
  assert.equal(station?.stationuuid, 'b', 'by-id resolves from the warm cache');
  assert.equal(getCatalogCalls, 1, 'by-id did NOT re-invoke getCatalog (rode the warm)');
  assert.equal(withProfilesCalls, 1, 'by-id did NOT re-run the profile map');

  // A summary build right after likewise rides the warm cache.
  const summary = await service.getSummary(7);
  assert.equal(typeof summary.counts.stations, 'number');
  assert.equal(getCatalogCalls, 1, 'summary rode the warm cache too');
});
