import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCuratedOverlay, repairCapriceUrls } from '../src/catalog/curatedOverlay.js';
import { CAPRICE_HOSTS, CAPRICE_PORT, CAPRICE_STREAMS } from '../src/catalog/capriceStreams.js';

const [firstUuid, firstHost, firstMount] = CAPRICE_STREAMS[0]!;

test('a Radio Caprice row gets its RETIRED 9xxx url rewritten to the live mount', () => {
  // The owner's report: «Radio Caprice… ни одна не работает». Measured on the
  // VPS: the 9xxx endpoints refuse the connection while Radio Browser still
  // flags lastcheckok=1, so nothing upstream demoted them.
  const rows = [
    {
      stationuuid: firstUuid,
      name: 'Radio Caprice - Something',
      url: 'http://79.120.39.202:9003/',
      url_resolved: 'http://79.120.39.202:9003/'
    }
  ];
  const [fixed] = repairCapriceUrls(rows);
  assert.equal(fixed?.url_resolved, `http://${CAPRICE_HOSTS[firstHost]}:${CAPRICE_PORT}/${firstMount}`);
  assert.equal(fixed?.url, fixed?.url_resolved, 'url and url_resolved must agree');
});

test('a station we do NOT map is left completely untouched', () => {
  // Conservative by design: pointing an unmapped station at a plausible-looking
  // neighbouring mount would silently swap its genre.
  const row = {
    stationuuid: 'not-a-caprice-uuid',
    name: 'Some Other Station',
    url: 'http://example.test/live',
    url_resolved: 'http://example.test/live'
  };
  const [same] = repairCapriceUrls([row]);
  assert.equal(same, row, 'an unmapped row keeps its identity (same object)');
});

test('every mapping is well formed and points at port 8004', () => {
  assert.ok(CAPRICE_STREAMS.length > 300, `expected a large map, got ${CAPRICE_STREAMS.length}`);
  const seen = new Set<string>();
  for (const [uuid, hostIndex, mount] of CAPRICE_STREAMS) {
    assert.match(uuid, /^[0-9a-f-]{16,}$/i, `bad uuid: ${uuid}`);
    assert.ok(CAPRICE_HOSTS[hostIndex], `host index out of range for ${uuid}`);
    assert.match(mount, /^[a-z0-9]+$/, `bad mount: ${mount}`);
    assert.ok(!seen.has(uuid), `duplicate uuid in the map: ${uuid}`);
    seen.add(uuid);
  }
  assert.equal(CAPRICE_PORT, 8004);
});

test('the repair runs as part of the normal catalog overlay', () => {
  // It must be applied on EVERY catalog ingress, not just in a unit test —
  // otherwise the live refetch would quietly restore the dead URLs.
  const out = applyCuratedOverlay([
    {
      stationuuid: firstUuid,
      name: 'Radio Caprice - Something',
      url: 'http://79.120.39.202:9003/',
      url_resolved: 'http://79.120.39.202:9003/'
    }
  ] as never);
  const row = (out as { stationuuid: string; url_resolved?: string }[]).find(
    (item) => item.stationuuid === firstUuid
  );
  assert.equal(row?.url_resolved, `http://${CAPRICE_HOSTS[firstHost]}:${CAPRICE_PORT}/${firstMount}`);
});
