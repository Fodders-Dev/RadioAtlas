import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CircuitBreaker,
  STATION_PROBE_FAILED_STATUS,
  harvestQualityScore,
  isNonArtistName,
  nextSupportsMetadata,
  parseTrackTitle,
  runHarvestBatch,
  selectHarvestBatch,
  type HarvestCandidate,
  type MetadataFetchResult
} from '../src/intel/harvestPipeline.js';

// ── parseTrackTitle ─────────────────────────────────────────────────────────
test('parseTrackTitle splits "Artist - Title" on the FIRST dash', () => {
  assert.deepEqual(parseTrackTitle('Daft Punk - Get Lucky'), {
    artist: 'Daft Punk',
    title: 'Get Lucky',
    raw: 'Daft Punk - Get Lucky'
  });
  // A dash inside the title stays with the title.
  assert.deepEqual(parseTrackTitle('AC/DC - T.N.T - Live'), {
    artist: 'AC/DC',
    title: 'T.N.T - Live',
    raw: 'AC/DC - T.N.T - Live'
  });
});

test('parseTrackTitle keeps a title with no artist as title-only', () => {
  assert.deepEqual(parseTrackTitle('Untitled Jam'), {
    artist: null,
    title: 'Untitled Jam',
    raw: 'Untitled Jam'
  });
});

test('parseTrackTitle rejects junk (empty, control chars, mojibake, no alnum)', () => {
  assert.equal(parseTrackTitle(''), null);
  assert.equal(parseTrackTitle(null), null);
  assert.equal(parseTrackTitle('A'), null); // too short
  assert.equal(parseTrackTitle('bad' + String.fromCharCode(7) + 'title'), null); // control char
  assert.equal(parseTrackTitle(String.fromCharCode(0xFFFD, 0xFFFD)), null); // replacement chars
  assert.equal(parseTrackTitle('---'), null); // no alphanumeric
});

test('parseTrackTitle rejects HLS / manifest-attribute leaks', () => {
  assert.equal(parseTrackTitle('AUDIO="program_audio"'), null);
  assert.equal(parseTrackTitle('CODECS="mp4a.40.2"'), null);
  assert.equal(parseTrackTitle('BANDWIDTH=128000'), null);
  // A real title with an equals sign but no attribute shape survives.
  assert.deepEqual(parseTrackTitle('2 + 2 = 5'), { artist: null, title: '2 + 2 = 5', raw: '2 + 2 = 5' });
});

test('parseTrackTitle rejects letterless / repeated counter idents', () => {
  assert.equal(parseTrackTitle('6464'), null); // bare counter, no letters
  assert.equal(parseTrackTitle('6464 - 6464'), null); // repeated token on both sides
  assert.equal(parseTrackTitle('1234567'), null);
});

test('parseTrackTitle strips a track-number "artist" but keeps the song', () => {
  // "04 - Night Comes On": the 04 is a track index, not an artist.
  assert.deepEqual(parseTrackTitle('04 - Night Comes On'), {
    artist: null,
    title: 'Night Comes On',
    raw: '04 - Night Comes On'
  });
  // A real numeric-looking artist (>3 digits, e.g. a year) is left intact.
  assert.deepEqual(parseTrackTitle('1979 - The Smashing Pumpkins'), {
    artist: '1979',
    title: 'The Smashing Pumpkins',
    raw: '1979 - The Smashing Pumpkins'
  });
  // A genuine artist that merely starts with digits is NOT a bare number.
  assert.deepEqual(parseTrackTitle('50 Cent - In Da Club'), {
    artist: '50 Cent',
    title: 'In Da Club',
    raw: '50 Cent - In Da Club'
  });
});

// ── supports_metadata state machine ─────────────────────────────────────────
test('nextSupportsMetadata: a title sets 1; no title is 0 unless already proven 1', () => {
  assert.equal(nextSupportsMetadata(null, true), 1);
  assert.equal(nextSupportsMetadata(null, false), 0);
  assert.equal(nextSupportsMetadata(0, true), 1);
  assert.equal(nextSupportsMetadata(0, false), 0);
  assert.equal(nextSupportsMetadata(1, true), 1);
  assert.equal(nextSupportsMetadata(1, false), 1); // proven station stays 1
});

// ── batch selection ─────────────────────────────────────────────────────────
test('selectHarvestBatch skips dead (lastcheckok 0) + non-http, ranks by quality, caps', () => {
  const candidates: HarvestCandidate[] = [
    { stationUuid: 'live-hi', urlResolved: 'http://a/1', lastcheckok: 1, quality: 90 },
    { stationUuid: 'dead', urlResolved: 'http://a/2', lastcheckok: 0, quality: 100 }, // skipped
    { stationUuid: 'live-lo', urlResolved: 'https://a/3', lastcheckok: 1, quality: 10 },
    { stationUuid: 'mid', urlResolved: 'http://a/4', lastcheckok: 1, quality: 50 },
    { stationUuid: 'file', urlResolved: 'file:///nope', lastcheckok: 1, quality: 999 }, // non-http skipped
    { stationUuid: 'unknown', urlResolved: 'http://a/5', quality: 30 } // unknown reach is allowed
  ];
  const batch = selectHarvestBatch(candidates, { limit: 3 });
  assert.deepEqual(batch.map((c) => c.stationUuid), ['live-hi', 'mid', 'unknown']);
});

test("selectHarvestBatch 'stale' order: never-harvested first, then oldest; idempotent; skip-dead survives", () => {
  const candidates: HarvestCandidate[] = [
    { stationUuid: 'recent', urlResolved: 'http://a/1', lastcheckok: 1, lastHarvestedAt: 5000 },
    { stationUuid: 'never-b', urlResolved: 'http://a/2', lastcheckok: 1, lastHarvestedAt: null },
    { stationUuid: 'old', urlResolved: 'http://a/3', lastcheckok: 1, lastHarvestedAt: 1000 },
    { stationUuid: 'dead', urlResolved: 'http://a/4', lastcheckok: 0, lastHarvestedAt: null }, // skipped despite never-harvested
    { stationUuid: 'never-a', urlResolved: 'http://a/5', lastcheckok: 1 } // undefined === never
  ];
  const order = () => selectHarvestBatch(candidates, { limit: 10, order: 'stale' }).map((c) => c.stationUuid);
  // never-harvested (input order preserved for ties) → oldest → most recent. Dead skipped.
  assert.deepEqual(order(), ['never-b', 'never-a', 'old', 'recent']);
  // Idempotent: re-running the same input yields the same order.
  assert.deepEqual(order(), ['never-b', 'never-a', 'old', 'recent']);
  // The limit still applies on the stale order (take the N stalest).
  assert.deepEqual(
    selectHarvestBatch(candidates, { limit: 2, order: 'stale' }).map((c) => c.stationUuid),
    ['never-b', 'never-a']
  );
});

test('harvestQualityScore: reach dominates, codec + bitrate add', () => {
  const reachable = harvestQualityScore({ lastcheckok: 1, bitrate: 320, codec: 'aac' });
  const dead = harvestQualityScore({ lastcheckok: 0, bitrate: 320, codec: 'flac' });
  assert.ok(reachable > 0 && dead < 0);
  assert.ok(
    harvestQualityScore({ lastcheckok: 1, bitrate: 320, codec: 'flac' }) >
      harvestQualityScore({ lastcheckok: 1, bitrate: 64, codec: 'mp3' })
  );
});

// ── circuit breaker ─────────────────────────────────────────────────────────
test('CircuitBreaker trips after N consecutive failures; a success resets it', () => {
  const breaker = new CircuitBreaker(3);
  assert.equal(breaker.recordFailure(), false);
  assert.equal(breaker.recordFailure(), false);
  breaker.recordSuccess(); // reset
  assert.equal(breaker.recordFailure(), false);
  assert.equal(breaker.recordFailure(), false);
  assert.equal(breaker.recordFailure(), true); // 3 in a row
  assert.equal(breaker.tripped, true);
});

// ── runner ──────────────────────────────────────────────────────────────────
const stubStore = () => {
  const meta = new Map<string, 0 | 1>();
  const observations: Array<{ stationUuid: string; artist: string | null; title: string | null }> = [];
  const probeFailures: Array<{ uuid: string; checkedAt: number }> = [];
  return {
    meta,
    observations,
    recordObservation: (o: { stationUuid: string; artist: string | null; title: string | null }) => {
      observations.push({ stationUuid: o.stationUuid, artist: o.artist, title: o.title });
      return true;
    },
    getSupportsMetadata: (uuid: string) => (meta.has(uuid) ? meta.get(uuid)! : null),
    setSupportsMetadata: (uuid: string, value: 0 | 1) => {
      meta.set(uuid, value);
    },
    probeFailures,
    markProbeFailure: (uuid: string, checkedAt: number) => {
      probeFailures.push({ uuid, checkedAt });
    }
  };
};

const batchOf = (n: number): HarvestCandidate[] =>
  Array.from({ length: n }, (_, i) => ({ stationUuid: `s${i}`, urlResolved: `http://h/${i}`, lastcheckok: 1 as const }));

test('runHarvestBatch records titles + sets supports_metadata, skips no-title stations', async () => {
  const store = stubStore();
  const fetchMetadata = async (url: string): Promise<MetadataFetchResult> =>
    url.endsWith('/1')
      ? { status: 200, title: null } // no title → supports_metadata 0
      : { status: 200, title: 'Artist - Song' };
  const summary = await runHarvestBatch(batchOf(3), {
    fetchMetadata,
    store,
    now: () => 1000,
    concurrency: 1
  });
  assert.equal(summary.processed, 3);
  assert.equal(summary.withTitle, 2);
  assert.equal(summary.withoutTitle, 1);
  assert.equal(store.meta.get('s0'), 1);
  assert.equal(store.meta.get('s1'), 0);
  assert.equal(store.observations.length, 2);
  assert.equal(store.observations[0]?.artist, 'Artist');
});

test('runHarvestBatch: the circuit breaker STOPS the run after consecutive 429s + fires a loud onAlert', async () => {
  const store = stubStore();
  let calls = 0;
  const alerts: string[] = [];
  const fetchMetadata = async (): Promise<MetadataFetchResult> => {
    calls += 1;
    return { status: 429, title: null, retryAfterMs: 0 };
  };
  const summary = await runHarvestBatch(batchOf(100), {
    fetchMetadata,
    store,
    now: () => 1,
    concurrency: 1,
    consecutiveFailLimit: 5,
    sleep: async () => {},
    onAlert: (msg) => alerts.push(msg)
  });
  assert.equal(summary.tripped, true);
  assert.equal(summary.processed, 0);
  // Stopped at the breaker, NOT after all 100.
  assert.equal(calls, 5);
  assert.equal(summary.failures, 5);
  // The breaker trip routed to onAlert (loud channel) with the marker.
  assert.equal(alerts.length, 1);
  assert.match(alerts[0]!, /HARVEST-ALERT/);
});

test('runHarvestBatch: a global rate floor spaces requests by minRequestIntervalMs', async () => {
  const store = stubStore();
  let clock = 0;
  const waits: number[] = [];
  const summary = await runHarvestBatch(batchOf(3), {
    fetchMetadata: async () => ({ status: 200, title: 'A - B' }),
    store,
    now: () => clock,
    concurrency: 1,
    minRequestIntervalMs: 500,
    // Advancing clock so the slot maths is realistic; record the floor waits.
    sleep: async (ms) => {
      if (ms > 0) waits.push(ms);
      clock += ms;
    }
  });
  assert.equal(summary.processed, 3);
  // First request fires immediately; the next two each wait the 500ms floor.
  assert.deepEqual(waits, [500, 500]);
});

test('runHarvestBatch: a 5xx burst that recovers does NOT trip (consecutive resets on success)', async () => {
  const store = stubStore();
  let calls = 0;
  const fetchMetadata = async (): Promise<MetadataFetchResult> => {
    calls += 1;
    // fail, fail, succeed, repeat — never 5 in a row.
    return calls % 3 === 0 ? { status: 200, title: 'A - B' } : { status: 503, title: null };
  };
  const summary = await runHarvestBatch(batchOf(9), {
    fetchMetadata,
    store,
    now: () => 1,
    concurrency: 1,
    consecutiveFailLimit: 5,
    sleep: async () => {}
  });
  assert.equal(summary.tripped, false);
  assert.equal(summary.processed, 3); // the 3 successes
});

// ── isNonArtistName ─────────────────────────────────────────────────────────
test('isNonArtistName: keeps real performers', () => {
  for (const a of ['Daft Punk', 'AC/DC', 'Depeche Mode', 'Pink Floyd', 'Егор Летов', 'Кино', 'Radiohead']) {
    assert.equal(isNonArtistName(a), false, a);
  }
  // a real performer is kept even when probed with an unrelated station name
  assert.equal(isNonArtistName('Depeche Mode', 'Radio Bob'), false);
});

test('isNonArtistName: drops generic ident/placeholder markers', () => {
  for (const a of ['Unknown', 'unknown artist', 'N/A', 'On Air', 'ONAIR', 'LIVE', 'Advert', 'Jingle', 'Various Artists', 'Station ID', 'now playing']) {
    assert.equal(isNonArtistName(a), true, a);
  }
});

test('isNonArtistName: drops a URL/domain in the artist slot', () => {
  assert.equal(isNonArtistName('www.radiobob.de'), true);
  assert.equal(isNonArtistName('listen at example.com'), true);
  assert.equal(isNonArtistName('https://stream.fm'), true);
});

test('isNonArtistName: drops the station\'s OWN name (ident leak), exact match only', () => {
  assert.equal(isNonArtistName('RADIO BOB', 'Radio Bob!'), true); // punctuation-folded exact
  assert.equal(isNonArtistName('SUNSHINE LIVE', 'Sunshine Live'), true);
  assert.equal(isNonArtistName('90s90s', '90s90s'), true);
  assert.equal(isNonArtistName('NPO Radio 1', 'NPO Radio 1'), true);
  // NOT a loose substring: a real artist whose name merely contains the station
  // token survives (only an exact, fully-normalized match is dropped).
  assert.equal(isNonArtistName('Bob Marley', 'Radio Bob'), false);
});

/**
 * The 2026-08-15 production deadlock. `harvestMetadata.mjs` reports "the fetch
 * threw" as status 599, which fell inside the pipeline's 5xx "upstream is
 * failing" range. Eight unreachable streams in a row therefore looked like our
 * own API dying and tripped the breaker — and because a failed station was
 * never stamped, it kept last_harvested_at NULL and sorted first in the next
 * run's 'stale' order. Every hourly run then selected the same broken head:
 * `processed=0 withTitle=0 recorded=0 failures=8 tripped=true`, for hours, with
 * the only alarm a log line nobody reads.
 */
test('unreachable streams do not trip the upstream breaker', async () => {
  const store = stubStore();
  let calls = 0;
  const alerts: string[] = [];
  const summary = await runHarvestBatch(batchOf(20), {
    fetchMetadata: async (): Promise<MetadataFetchResult> => {
      calls += 1;
      // The first eight streams are dead; the rest answer normally.
      return calls <= 8
        ? { status: STATION_PROBE_FAILED_STATUS, title: null }
        : { status: 200, title: 'Artist - Song' };
    },
    store,
    now: () => 1000,
    concurrency: 1,
    consecutiveFailLimit: 8,
    sleep: async () => {},
    onAlert: (msg) => alerts.push(msg)
  });

  assert.equal(summary.tripped, false, 'dead streams are ordinary harvesting, not an outage');
  assert.equal(calls, 20, 'the run must reach every station in the batch');
  assert.equal(summary.processed, 12);
  assert.equal(summary.withTitle, 12);
  assert.equal(summary.stationFailures, 8);
  assert.equal(summary.failures, 8);
  assert.deepEqual(alerts, []);
});

test('an unreachable station is stamped, so it rotates out of the stale head', async () => {
  const store = stubStore();
  const summary = await runHarvestBatch(batchOf(3), {
    fetchMetadata: async (): Promise<MetadataFetchResult> => ({
      status: STATION_PROBE_FAILED_STATUS,
      title: null
    }),
    store,
    now: () => 4242,
    concurrency: 1,
    sleep: async () => {}
  });

  assert.equal(summary.stationFailures, 3);
  // Stamped as attempted — this is what breaks the deadlock.
  assert.deepEqual(store.probeFailures, [
    { uuid: 's0', checkedAt: 4242 },
    { uuid: 's1', checkedAt: 4242 },
    { uuid: 's2', checkedAt: 4242 }
  ]);
  // ...but nothing is asserted about metadata support: a timeout is not
  // evidence that a station has no titles.
  assert.equal(store.meta.size, 0);
});

test('upstream pressure still stops the run, and a global outage still has a ceiling', async () => {
  const store = stubStore();
  const alerts: string[] = [];
  // Our own API pushing back (503) must trip on the SMALL budget.
  const upstream = await runHarvestBatch(batchOf(50), {
    fetchMetadata: async (): Promise<MetadataFetchResult> => ({ status: 503, title: null }),
    store,
    now: () => 1,
    concurrency: 1,
    consecutiveFailLimit: 4,
    sleep: async () => {},
    onAlert: (msg) => alerts.push(msg)
  });
  assert.equal(upstream.tripped, true);
  assert.equal(upstream.failures, 4);
  assert.equal(upstream.stationFailures, 0);
  // Even a 503-cut run stamps what it touched, so the next run moves on.
  assert.equal(store.probeFailures.length, 4);

  // Every stream unreachable = the network is gone; stop rather than grind
  // through the whole batch.
  const outageStore = stubStore();
  const outageAlerts: string[] = [];
  const outage = await runHarvestBatch(batchOf(200), {
    fetchMetadata: async (): Promise<MetadataFetchResult> => ({
      status: STATION_PROBE_FAILED_STATUS,
      title: null
    }),
    store: outageStore,
    now: () => 1,
    concurrency: 1,
    consecutiveFailLimit: 4,
    stationFailLimit: 20,
    sleep: async () => {},
    onAlert: (msg) => outageAlerts.push(msg)
  });
  assert.equal(outage.tripped, true);
  assert.equal(outage.stationFailures, 20);
  assert.equal(outageAlerts.length, 1);
  assert.match(outageAlerts[0]!, /HARVEST-ALERT/);
});
