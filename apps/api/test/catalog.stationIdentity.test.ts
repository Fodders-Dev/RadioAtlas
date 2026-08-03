import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCatalogSummary, type CatalogStation } from '../src/catalog/service.js';
import { dedupeByBroadcaster, normalizeStationName } from '../src/catalog/stationIdentity.js';

// Radio Browser lists one station under several uuids — another mount, another
// bitrate, a duplicate submission, or one stream re-listed under every country.
// Prod 2026-08-03: of 83 promoted stations, five names appeared twice.

const mk = (id: string, over: Partial<CatalogStation> = {}): CatalogStation => ({
  stationuuid: id,
  name: id,
  url: '',
  url_resolved: `http://stream.example/${id}`,
  homepage: '',
  favicon: '',
  tags: 'ambient',
  country: 'Atlantis',
  countrycode: 'AT',
  state: '',
  language: 'en',
  codec: 'MP3',
  bitrate: 128,
  geo_lat: null,
  geo_long: null,
  lastcheckok: 1,
  votes: 0,
  ...over
});

const votes = (station: CatalogStation) => station.votes ?? 0;
const dedupe = (stations: CatalogStation[]) => dedupeByBroadcaster(stations, votes);
const ids = (stations: CatalogStation[]) => stations.map((station) => station.stationuuid).sort();

test('the same stream under two uuids is one station, whatever the rows are called', () => {
  // Live on prod: «Iran International» and «iraninternational» are one feed, and
  // «Радио Свобода»/«Свобода» another. Neither pair matches by name.
  const rows = [
    mk('a', { name: 'Iran International', url_resolved: 'https://radio.iraninternational.app/iintl_c', votes: 139787 }),
    mk('b', { name: 'iraninternational', url_resolved: 'https://radio.iraninternational.app/iintl_c', votes: 12 })
  ];
  assert.deepEqual(ids(dedupe(rows)), ['a']);
});

test('scheme, www, host case and a trailing slash are not identity', () => {
  const rows = [
    mk('a', { url_resolved: 'http://www.Stream.Example.com/live/' }),
    mk('b', { name: 'Another Name', url_resolved: 'https://stream.example.com/live' })
  ];
  assert.equal(dedupe(rows).length, 1);
});

test('the QUERY STRING is part of the stream identity', () => {
  // The busiest shared endpoints are proxies where the query names the station:
  // worldradio.online/proxy/?q=…, securestreams7.autopo.st/?uri=…,
  // samcloud.spacial.com/api/listen?sid=…. Ignoring it welded 68 unrelated
  // Australian stations into one when this was replayed over the catalogue.
  const rows = [
    mk('a', { name: 'LiSTNR - 70s Hits', url_resolved: 'http://worldradio.online/proxy/?q=https://wz7liw.scahw.com.au/live/770shits_128.stream/playlist.m3u8' }),
    mk('b', { name: 'LiSTNR - Drum & Bass', url_resolved: 'http://worldradio.online/proxy/?q=https://wz7liw.scahw.com.au/live/7dnb_128.stream/playlist.m3u8' }),
    mk('c', { name: '2AY - Albury - 1494 AM', url_resolved: 'http://worldradio.online/proxy/?q=https://wz2liw.scahw.com.au/live/2ay_128.stream/playlist.m3u8' })
  ];
  assert.deepEqual(ids(dedupe(rows)), ['a', 'b', 'c']);
});

test('one broadcaster on two mounts is one station', () => {
  // «101 FM - Logan - 101.1 FM (AAC+)» and «(MP3)» stood side by side in the
  // genre spotlight; the bracket is encoder metadata, not a second station.
  const rows = [
    mk('a', { name: '101 FM - Logan - 101.1 FM (AAC+)', url_resolved: 'http://one.example/aac' }),
    mk('b', { name: '101 FM - Logan - 101.1 FM (MP3)', url_resolved: 'http://one.example/mp3' })
  ];
  assert.equal(dedupe(rows).length, 1);
});

test('case and the Cyrillic ё are not identity; a different country is', () => {
  assert.equal(dedupe([mk('a', { name: "00's RFM" }), mk('b', { name: "00'S RFM", url_resolved: 'http://x/2' })]).length, 1);
  assert.equal(dedupe([mk('a', { name: 'Ёлка' }), mk('b', { name: 'Елка', url_resolved: 'http://x/2' })]).length, 1);
  // Real, distinct stations that merely share a name.
  const rockFm = [
    mk('es', { name: 'Rock FM', countrycode: 'ES', url_resolved: 'http://es/rock' }),
    mk('ru', { name: 'Rock FM', countrycode: 'RU', url_resolved: 'http://ru/rock' })
  ];
  assert.deepEqual(ids(dedupe(rockFm)), ['es', 'ru']);
});

test('a mislabelled row cannot weld two real stations together', () => {
  // Radio Browser carries a row NAMED «RAI Radio 1» whose URL is actually Tutta
  // Italiana's. Treating identity as one transitive relation over both rules
  // merged RAI's nine channels into a single station — and TalkSPORT 1/2, and
  // all of Jazz Radio's sub-channels with it. Collapsing streams FIRST keeps the
  // bad row inside its own stream group.
  const rows = [
    mk('uno', { name: 'RAI Radio 1', url_resolved: 'http://icestreaming.rai.it/1.mp3', votes: 500 }),
    mk('bridge', { name: 'RAI Radio 1', url_resolved: 'http://icestreaming.rai.it/4.mp3', votes: 1 }),
    mk('tutta', { name: 'RAI Radio Tutta Italiana', url_resolved: 'http://icestreaming.rai.it/4.mp3', votes: 300 })
  ];
  const survivors = dedupe(rows);
  assert.equal(survivors.length, 2, 'RAI Radio 1 and Tutta Italiana are two stations');
  assert.deepEqual(ids(survivors), ['tutta', 'uno']);
});

test('the better-scoring row of a group is the one that survives', () => {
  const byScore = dedupe([
    mk('quiet', { url_resolved: 'http://same/mount', votes: 5 }),
    mk('loved', { url_resolved: 'http://same/mount', votes: 5000 })
  ]);
  assert.deepEqual(ids(byScore), ['loved']);
});

test('of two rows for one broadcaster the shop window promotes the one that PLAYS', () => {
  // The score buildCatalogSummary passes is the search ranker's, where upstream
  // reachability outranks popularity — so a dead mount loses to a live one even
  // when the dead row carries every vote. Recommending a stream we have reason
  // to believe is dead is the failure this pipeline exists to avoid (#251).
  const stations = [
    mk('dead', { name: 'Twin Radio', url_resolved: 'http://twin/mount', lastcheckok: 0, votes: 9000, clicktrend: 9000 }),
    mk('alive', { name: 'Twin Radio', url_resolved: 'http://twin/mount', lastcheckok: 1, votes: 3, clicktrend: 3 }),
    ...Array.from({ length: 12 }, (_, i) =>
      mk(`filler-${i}`, { name: `Filler ${i}`, countrycode: `F${i}`, country: `Fillerland ${i}`, votes: 10 + i, clicktrend: 10 + i })
    )
  ];
  const promoted = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const row = node as { stationuuid?: unknown };
    if (typeof row.stationuuid === 'string') return void promoted.add(row.stationuuid);
    Object.values(node as Record<string, unknown>).forEach(walk);
  };
  const summary = buildCatalogSummary(stations, 5, Date.UTC(2026, 7, 3));
  for (const [key, value] of Object.entries(summary)) {
    if (key === 'counts' || key === 'generatedAt') continue;
    walk(value);
  }
  assert.ok(promoted.has('alive'), 'the live mount should be on the shelves');
  assert.ok(!promoted.has('dead'), 'the dead mount should not be');
});

test('the survivor is deterministic when nothing separates the rows', () => {
  const rows = [mk('zzz', { url_resolved: 'http://same/mount' }), mk('aaa', { url_resolved: 'http://same/mount' })];
  assert.deepEqual(ids(dedupe(rows)), ['aaa']);
  assert.deepEqual(ids(dedupe([...rows].reverse())), ['aaa']);
});

test('a row with no usable identity is never merged away', () => {
  const rows = [
    mk('a', { name: '', url_resolved: '' }),
    mk('b', { name: '', url_resolved: '' }),
    mk('c', { name: '', url_resolved: 'not a url', url: '' })
  ];
  assert.equal(dedupe(rows).length, 3);
});

test('caller ordering survives the pass', () => {
  const rows = [mk('first'), mk('second'), mk('dupe-of-first', { url_resolved: 'http://stream.example/first', votes: 99 })];
  assert.deepEqual(
    dedupe(rows).map((station) => station.stationuuid),
    ['dupe-of-first', 'second'],
    'the survivor takes the slot of the first row of its group'
  );
});

test('no shelf offers one broadcaster twice, and the counts still describe the catalogue', () => {
  const stations: CatalogStation[] = [];
  for (let i = 0; i < 40; i += 1) {
    stations.push(mk(`solo-${i}`, { name: `Station ${i}`, country: `Country ${i % 7}`, countrycode: `C${i % 7}`, votes: 100 + i, clicktrend: 50 + i, tags: 'ambient,chillout' }));
  }
  // Four uuids, one broadcaster: two share a stream, two share name + country.
  for (let i = 0; i < 4; i += 1) {
    stations.push(
      mk(`twin-${i}`, {
        name: 'Twin Radio',
        country: 'Twinland',
        countrycode: 'TW',
        url_resolved: i < 2 ? 'http://twin/stream' : `http://twin/mount-${i}`,
        votes: 900 + i,
        clicktrend: 900 + i,
        tags: 'ambient,chillout'
      })
    );
  }

  const summary = buildCatalogSummary(stations, 7, Date.UTC(2026, 7, 3));
  const shelves: Array<[string, Array<{ stationuuid: string }>]> = [
    ['catalogPool', summary.catalogPool],
    ['trending', summary.trending],
    ['topVoted', summary.topVoted],
    ['freshSignals', summary.freshSignals],
    ['searchLaunch', summary.searchLaunch],
    ['countrySpotlight', summary.countrySpotlight?.stations ?? []],
    ['genreSpotlight', summary.genreSpotlight?.stations ?? []],
    ['aroundTheWorld', summary.aroundTheWorld?.stations ?? []],
    ...summary.moodRails.map((rail) => [rail.id, rail.stations] as [string, Array<{ stationuuid: string }>])
  ];
  for (const [label, rows] of shelves) {
    const twins = rows.filter((row) => row.stationuuid.startsWith('twin-'));
    assert.ok(twins.length <= 1, `${label} offered the same broadcaster ${twins.length} times`);
  }

  assert.equal(summary.counts.stations, stations.length, 'counts describe the catalogue, not the shelves');
  assert.equal(summary.counts.genres, 2);
});

test('normalizeStationName matches the webapp copy it was ported from', () => {
  // Mirrors apps/webapp/src/lib/stationUtils.test.ts. If that file changes and
  // this one is not updated in step, the two copies have drifted.
  assert.equal(normalizeStationName('VIP Radio (MP3)'), 'VIP Radio');
  assert.equal(normalizeStationName('RadioBOB Rock Hits (64 kbps AAC)'), 'RadioBOB Rock Hits');
  assert.equal(normalizeStationName('SWR 2  [AAC 96k]'), 'SWR 2');
  assert.equal(normalizeStationName('Antenne Saar (56 kbit/s)'), 'Antenne Saar');
  assert.equal(normalizeStationName('Deutschlandfunk | DLF | MP3 128k'), 'Deutschlandfunk | DLF');
  assert.equal(normalizeStationName('Radio Beat 128 MP3'), 'Radio Beat');
  assert.equal(normalizeStationName('radio 3 | rbb | LQ'), 'radio 3 | rbb');
  assert.equal(normalizeStationName('la cordobesa 96.0 link alterno'), 'la cordobesa 96.0');
  // …and the identities it must NOT eat.
  assert.equal(normalizeStationName('Radio Paradise Main Mix (EU)'), 'Radio Paradise Main Mix (EU)');
  assert.equal(normalizeStationName('Vibe FM (Guadalajara)'), 'Vibe FM (Guadalajara)');
  assert.equal(normalizeStationName('Radio 538 MP3'), 'Radio 538');
  assert.equal(normalizeStationName('Studio 320'), 'Studio 320');
  assert.equal(normalizeStationName('Radio 24'), 'Radio 24');
  assert.equal(normalizeStationName('LRT Opus'), 'LRT Opus');
  assert.equal(normalizeStationName('Radio Mirror'), 'Radio Mirror');
  assert.equal(normalizeStationName('-=PoWeR=-'), '-=PoWeR=-');
  assert.equal(normalizeStationName('| COBrOx.RADiO.fm |'), '| COBrOx.RADiO.fm |');
  assert.equal(normalizeStationName('Авторадио 90.3 FM'), 'Авторадио 90.3 FM');
  assert.equal(normalizeStationName('___80 EXITOS'), '80 EXITOS');
  assert.equal(normalizeStationName('LO_FI'), 'LO_FI');
  assert.equal(normalizeStationName('MP3'), 'MP3');
});
