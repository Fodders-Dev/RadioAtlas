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
    // Hyphens are legal in a mount and the network uses exactly one: `lo-fi`.
    // ⚠ Anything that PARSES this file (the regenerator in scratchpad) must use
    // the same class, or it silently drops those rows on the next rebuild.
    assert.match(mount, /^[a-z0-9-]+$/, `bad mount: ${mount}`);
    assert.ok(!seen.has(uuid), `duplicate uuid in the map: ${uuid}`);
    seen.add(uuid);
  }
  assert.equal(CAPRICE_PORT, 8004);
});

// #239: the first pass mapped «Depressive Black Metal», «Black Death Metal» and
// «Black/Blackened Doom Metal» onto the generic `blackmetal` mount. That is the
// same silent genre swap the head-word rule exists to prevent, one subgenre
// level down, and it SHIPPED — the map was verified live, and a wrong-but-live
// mount answers 200 just as happily as the right one. Verification proves a
// stream exists; it cannot prove it is the right stream. Pin the corrections.
test('subgenre stations do not point at the generic blackmetal mount', () => {
  const mountOf = (uuid: string) =>
    CAPRICE_STREAMS.find(([id]) => id === uuid)?.[2];

  const corrected: ReadonlyArray<readonly [string, string, string]> = [
    ['cee76738-4ff5-478f-8810-5e0a8edfcbd9', 'dsbm', 'RadCap - Depressive Black Metal'],
    ['5fea1af2-8488-4213-a744-11ce452c8e25', 'dsbm', 'Radio Caprice - Depressive Black Metal'],
    ['9644cbb5-0601-11e8-ae97-52543be04c81', 'dsbm', 'Radio Caprice - Depressive Black Metal'],
    ['0782a18b-ac41-4454-bd91-6798653cc845', 'blackdoom', 'Black / Blackened Doom Metal'],
    ['f4fe720e-e72e-40c6-baf5-2a3f781c7ef5', 'blackdoom', 'RadCap - Black Doom Metal'],
    ['71e6e2bc-7143-4e06-9e6c-61aebe046966', 'blackdeath', 'RadCap - Black Death Metal']
  ];

  for (const [uuid, expected, label] of corrected) {
    assert.equal(mountOf(uuid), expected, `${label} must play ${expected}, not the generic mount`);
  }
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
