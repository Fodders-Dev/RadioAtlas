import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_LIVE_ENTRIES,
  PRESENCE_TTL_MS,
  __resetPresence,
  getLiveStations,
  getStationListeners,
  presenceSize,
  recordPresenceBeat,
  releasePresence,
  sweepPresence
} from '../src/listeningPresence.ts';

const T0 = 1_700_000_000_000;

test.beforeEach(() => __resetPresence());

test('counts distinct listeners, not beats', () => {
  recordPresenceBeat('a', 'st-1', T0);
  recordPresenceBeat('a', 'st-1', T0 + 1_000);
  recordPresenceBeat('a', 'st-1', T0 + 2_000);
  assert.equal(getStationListeners('st-1'), 1, 'one person beating three times is one listener');

  recordPresenceBeat('b', 'st-1', T0 + 3_000);
  assert.equal(getStationListeners('st-1'), 2);
});

test('a listener who changes station is moved, never duplicated', () => {
  recordPresenceBeat('a', 'st-1', T0);
  recordPresenceBeat('a', 'st-2', T0 + 1_000);
  assert.equal(getStationListeners('st-1'), 0, 'the old station must not keep a ghost');
  assert.equal(getStationListeners('st-2'), 1);
  assert.equal(presenceSize(), 1);
});

test('a listener who stops beating expires — the count is never inflated by the departed', () => {
  recordPresenceBeat('a', 'st-1', T0);
  recordPresenceBeat('b', 'st-1', T0);
  assert.equal(getStationListeners('st-1'), 2);

  // `b` keeps listening, `a` walks away.
  recordPresenceBeat('b', 'st-1', T0 + PRESENCE_TTL_MS - 1);
  sweepPresence(T0 + PRESENCE_TTL_MS);
  assert.equal(getStationListeners('st-1'), 1, 'only the live listener survives');
});

test('the station key disappears entirely when the last listener leaves', () => {
  recordPresenceBeat('a', 'st-1', T0);
  releasePresence('a');
  assert.equal(getStationListeners('st-1'), 0);
  assert.equal(
    getLiveStations().some((entry) => entry.stationId === 'st-1'),
    false,
    'an empty station must not linger in the live list as a zero'
  );
  assert.equal(presenceSize(), 0);
});

test('sweeping is complete: no entry and no count row survives its TTL', () => {
  for (let i = 0; i < 50; i += 1) {
    recordPresenceBeat(`tok-${i}`, `st-${i % 5}`, T0);
  }
  assert.equal(presenceSize(), 50);
  const removed = sweepPresence(T0 + PRESENCE_TTL_MS + 1);
  assert.equal(removed, 50);
  assert.equal(presenceSize(), 0, 'entries map must not leak');
  assert.equal(getLiveStations().length, 0, 'counts map must not leak either');
});

test('rejects junk without recording anything', () => {
  assert.equal(recordPresenceBeat('', 'st-1', T0).ok, false);
  assert.equal(recordPresenceBeat('a', '', T0).ok, false);
  assert.equal(recordPresenceBeat('a', 42, T0).ok, false);
  assert.equal(recordPresenceBeat('x'.repeat(200), 'st-1', T0).ok, false);
  assert.equal(presenceSize(), 0);
});

test('the map cannot be grown without bound', () => {
  for (let i = 0; i < MAX_LIVE_ENTRIES; i += 1) {
    recordPresenceBeat(`tok-${i}`, 'st-1', T0);
  }
  const overflow = recordPresenceBeat('one-too-many', 'st-1', T0);
  assert.equal(overflow.ok, false);
  assert.equal(presenceSize(), MAX_LIVE_ENTRIES);

  // …but capacity reached by STALE entries is reclaimed rather than refused.
  const afterExpiry = recordPresenceBeat('fresh', 'st-2', T0 + PRESENCE_TTL_MS + 1);
  assert.equal(afterExpiry.ok, true);
});

test('the live list ranks by real counts and never invents a station', () => {
  recordPresenceBeat('a', 'quiet', T0);
  for (let i = 0; i < 4; i += 1) recordPresenceBeat(`b${i}`, 'busy', T0);
  for (let i = 0; i < 2; i += 1) recordPresenceBeat(`c${i}`, 'middle', T0);

  assert.deepEqual(getLiveStations(3), [
    { stationId: 'busy', listeners: 4 },
    { stationId: 'middle', listeners: 2 },
    { stationId: 'quiet', listeners: 1 }
  ]);
});

test('the beat returns the count that includes the caller', () => {
  const first = recordPresenceBeat('a', 'st-1', T0);
  assert.deepEqual(first, { ok: true, stationId: 'st-1', listeners: 1 });
  const second = recordPresenceBeat('b', 'st-1', T0);
  assert.equal(second.ok && second.listeners, 2);
});
