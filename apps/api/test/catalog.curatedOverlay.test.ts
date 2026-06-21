import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCuratedOverlay } from '../src/catalog/curatedOverlay.js';

type Row = Parameters<typeof applyCuratedOverlay>[0][number];

// Minimal Radio-Browser-shaped row. `extra` carries fields the curated overlay
// preserves (votes/clickcount/geo) so we can assert they survive a uuid claim.
const mk = (over: Partial<Row> & Record<string, unknown>): Row =>
  ({
    stationuuid: 'x',
    name: 'X',
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
  }) as Row;

const DEAD_HAPPY = 'e9e50308-e8c8-4605-8888-38638f941f34';
const DEAD_90 = '3e1e6384-ba86-4dd7-82f0-6ad163c6fc48';
const MAIN_UUID = '63688c44-e90b-11e8-a471-52543be04c81';
const SPB_UUID = '677c98c7-d5f5-4923-b498-651bed7f9ae7';

const baseCatalog = (): Row[] => [
  mk({
    stationuuid: DEAD_HAPPY,
    name: 'Весёлый Dance - Радио Ваня',
    url: 'https://stream.pcradio.ru/vanya_fundance-med',
    url_resolved: 'https://stream02.pcradio.biz/vanya_fundance-med'
  }),
  mk({
    stationuuid: DEAD_90,
    name: 'Радио Ваня - Не лихие 90-е',
    url: 'https://stream.pcradio.ru/vanya_90-med',
    url_resolved: 'https://stream02.pcradio.biz/vanya_90-med'
  }),
  mk({
    stationuuid: MAIN_UUID,
    name: 'РАДИО ВАНЯ',
    url: 'https://icecast-radiovanya.cdnvideo.ru/radiovanya',
    url_resolved: 'https://icecast-radiovanya.cdnvideo.ru/radiovanya',
    geo_lat: 55.75,
    geo_long: 37.61,
    // upstream ranking signal not declared on Station but carried via spread
    votes: 4242,
    clickcount: 9000
  }),
  mk({
    stationuuid: SPB_UUID,
    name: 'Радио Ваня Санкт-Петербург 90.6 FM',
    url: 'http://icecast-radiovanya.cdnvideo.ru:8000/rv_spb',
    url_resolved: 'http://icecast-radiovanya.cdnvideo.ru:8000/rv_spb'
  }),
  // Unrelated station — must be untouched.
  mk({
    stationuuid: 'unrelated-1',
    name: 'Jazz Cafe',
    url: 'https://example.com/jazz',
    url_resolved: 'https://example.com/jazz'
  }),
  // A genuinely different Radio Vanya FM signal on another host — must survive.
  mk({
    stationuuid: 'fm-borovichi',
    name: 'Радио Ваня Боровичи 102.9 FM',
    url: 'http://nov.rlnk.ru:8000/radio.vanyab',
    url_resolved: 'http://nov.rlnk.ru:8000/radio.vanyab'
  })
];

const CDN_HOST = 'icecast-radiovanya.cdnvideo.ru';
const mountOf = (row: Row): string | null => {
  try {
    const u = new URL(row.url_resolved || row.url);
    return u.hostname.toLowerCase() === CDN_HOST ? u.pathname.replace(/^\/+/, '').toLowerCase() : null;
  } catch {
    return null;
  }
};
const byUuid = (rows: Row[], uuid: string) => rows.find((r) => r.stationuuid === uuid);

test('superseded dead pcradio rows are fixed in-place on the cdnvideo CDN', () => {
  const out = applyCuratedOverlay(baseCatalog());

  // The dead UUID survives (favorites preserved) but now resolves to the live CDN.
  const happy = byUuid(out, DEAD_HAPPY);
  assert.ok(happy, 'Весёлый Дэнс keeps the favorited uuid');
  assert.equal(happy!.url_resolved, 'https://icecast-radiovanya.cdnvideo.ru/rv_Happy_Dance');
  assert.equal(happy!.url, 'https://icecast-radiovanya.cdnvideo.ru/rv_Happy_Dance');
  assert.ok(!happy!.url_resolved.includes('pcradio'), 'no dead pcradio url left');

  const ninety = byUuid(out, DEAD_90);
  assert.ok(ninety, 'Не лихие 90-е keeps the favorited uuid');
  assert.equal(ninety!.url_resolved, 'https://icecast-radiovanya.cdnvideo.ru/rv_90');
});

test('an existing healthy cdnvideo row keeps its uuid and ranking signal (merge, not duplicate)', () => {
  const out = applyCuratedOverlay(baseCatalog());

  const mainRows = out.filter((r) => mountOf(r) === 'radiovanya');
  assert.equal(mainRows.length, 1, 'exactly one main «Радио Ваня» row, no duplicate');
  const main = mainRows[0]!;
  assert.equal(main.stationuuid, MAIN_UUID, 'favorited main uuid preserved');
  assert.equal((main as Record<string, unknown>).votes, 4242, 'upstream votes preserved');
  assert.equal((main as Record<string, unknown>).clickcount, 9000, 'upstream clickcount preserved');
  assert.equal(main.url_resolved, 'https://icecast-radiovanya.cdnvideo.ru/radiovanya');

  // СПб matched by mount despite a different upstream name/transport (http:8000).
  const spbRows = out.filter((r) => mountOf(r) === 'rv_spb');
  assert.equal(spbRows.length, 1);
  assert.equal(spbRows[0]!.stationuuid, SPB_UUID, 'СПб favorites preserved');
  assert.equal(spbRows[0]!.url_resolved, 'https://icecast-radiovanya.cdnvideo.ru/rv_spb', 'canonical https mount');
});

test('all 20 curated mounts are present exactly once', () => {
  const out = applyCuratedOverlay(baseCatalog());
  const mounts = out.map(mountOf).filter((m): m is string => Boolean(m));
  assert.equal(mounts.length, 20, '20 cdnvideo rows total');
  assert.equal(new Set(mounts).size, 20, 'no duplicate cdnvideo mounts');
  // A fresh sub-stream (no prior catalog row) gets its stable curated id.
  const medlyaki = out.find((r) => mountOf(r) === 'rv_medlyaki');
  assert.equal(medlyaki!.stationuuid, 'curated-radiovanya-medlyaki');
});

test('unrelated stations and other-host Radio Vanya FM signals are untouched', () => {
  const out = applyCuratedOverlay(baseCatalog());
  const jazz = byUuid(out, 'unrelated-1');
  assert.ok(jazz && jazz.url_resolved === 'https://example.com/jazz', 'unrelated station survives intact');
  const fm = byUuid(out, 'fm-borovichi');
  assert.ok(fm && fm.url_resolved === 'http://nov.rlnk.ru:8000/radio.vanyab', 'regional FM on another host survives');
});

test('result has no duplicate station uuids', () => {
  const out = applyCuratedOverlay(baseCatalog());
  const uuids = out.map((r) => r.stationuuid);
  assert.equal(new Set(uuids).size, uuids.length, 'every stationuuid is unique');
});

test('overlay is pure (does not mutate input) and idempotent across a refresh', () => {
  const input = baseCatalog();
  const snapshot = JSON.stringify(input);
  const once = applyCuratedOverlay(input);
  assert.equal(JSON.stringify(input), snapshot, 'input array not mutated');

  // Re-applying to an already-overlaid array (as happens every 30-min refetch)
  // is a fixed point: same uuids and same resolved urls, same count.
  const twice = applyCuratedOverlay(once);
  assert.equal(twice.length, once.length);
  const key = (rows: Row[]) =>
    rows
      .map((r) => `${r.stationuuid}|${r.url_resolved}`)
      .sort()
      .join('\n');
  assert.equal(key(twice), key(once), 'overlay is a fixed point');
});

test('empty / malformed input still yields the full curated set', () => {
  const fromEmpty = applyCuratedOverlay([]);
  assert.equal(fromEmpty.length, 20, 'all 20 curated rows when catalog is empty');
  assert.ok(
    fromEmpty.every((r) => (r.url_resolved || '').startsWith('https://icecast-radiovanya.cdnvideo.ru/')),
    'every curated row resolves to the CDN'
  );
  // A row with a junk url must not throw the URL parser.
  const withJunk = applyCuratedOverlay([mk({ stationuuid: 'junk', url: 'not a url', url_resolved: '' })]);
  assert.ok(byUuid(withJunk, 'junk'), 'unparseable row kept, no throw');
});
