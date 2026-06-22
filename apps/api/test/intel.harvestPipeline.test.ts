import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CircuitBreaker,
  harvestQualityScore,
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

test('runHarvestBatch: the circuit breaker STOPS the run after consecutive 429s', async () => {
  const store = stubStore();
  let calls = 0;
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
    sleep: async () => {}
  });
  assert.equal(summary.tripped, true);
  assert.equal(summary.processed, 0);
  // Stopped at the breaker, NOT after all 100.
  assert.equal(calls, 5);
  assert.equal(summary.failures, 5);
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
