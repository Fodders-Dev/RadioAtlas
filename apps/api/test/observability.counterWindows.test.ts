import assert from 'node:assert/strict';
import test from 'node:test';

import {
  recordBucketIncrement,
  summariseCounterWindows,
  type CounterBucket
} from '../src/observabilityStore.js';

/**
 * Why this exists: production reported 248 `play_attempt` against 38
 * `play_success` and 1 `play_superseded` — a 15% success rate that is not a
 * success rate at all. The store survives deploys now, so those totals span a
 * pre-fix era when superseded plays were not counted and a post-fix era with
 * almost no traffic in it, and nothing in the payload let a reader separate
 * them. Hourly increments do.
 *
 * The clock is an argument on both functions precisely so this can be tested
 * without waiting an hour or stubbing Date.
 */

const HOUR = 3_600_000;
const AT = (hour: number, minute = 0) => hour * HOUR + minute * 60_000;

test('increments land in the bucket for their own hour', () => {
  const buckets: CounterBucket[] = [];
  recordBucketIncrement(buckets, 'play_attempt', 1, AT(100, 5));
  recordBucketIncrement(buckets, 'play_attempt', 1, AT(100, 59));
  recordBucketIncrement(buckets, 'play_success', 1, AT(100, 30));
  assert.equal(buckets.length, 1);
  assert.deepEqual(buckets[0], { hour: 100, counters: { play_attempt: 2, play_success: 1 } });

  recordBucketIncrement(buckets, 'play_attempt', 1, AT(101, 1));
  assert.equal(buckets.length, 2);
  assert.deepEqual(buckets[1], { hour: 101, counters: { play_attempt: 1 } });
});

test('a window sums only the hours it covers', () => {
  const buckets: CounterBucket[] = [];
  recordBucketIncrement(buckets, 'play_attempt', 10, AT(100));
  recordBucketIncrement(buckets, 'play_attempt', 3, AT(123));
  recordBucketIncrement(buckets, 'play_success', 2, AT(123));
  recordBucketIncrement(buckets, 'play_attempt', 4, AT(124));
  recordBucketIncrement(buckets, 'play_success', 3, AT(124));

  const windows = summariseCounterWindows(buckets, AT(124, 30));
  assert.deepEqual(windows.last1h.counters, { play_attempt: 4, play_success: 3 });
  // 24 hours back from hour 124 is hour 101, so the burst at hour 100 is out.
  assert.deepEqual(windows.last24h.counters, { play_attempt: 7, play_success: 5 });
  assert.equal(windows.last1h.since, AT(124));
  assert.equal(windows.last24h.since, AT(101));
});

test('an idle window is empty rather than a wall of zeroes', () => {
  const buckets: CounterBucket[] = [];
  recordBucketIncrement(buckets, 'play_attempt', 5, AT(200));
  const windows = summariseCounterWindows(buckets, AT(400, 20));
  assert.deepEqual(windows.last1h.counters, {});
  assert.deepEqual(windows.last24h.counters, {});
  // Nothing covered: the window starts at the top of the current hour rather
  // than claiming to cover an hour it has no data for.
  assert.equal(windows.last1h.since, AT(400));
});

test('history is capped at a day plus the hour in progress', () => {
  const buckets: CounterBucket[] = [];
  for (let hour = 0; hour < 40; hour += 1) {
    recordBucketIncrement(buckets, 'tick', 1, AT(hour));
  }
  assert.equal(buckets.length, 25);
  assert.equal(buckets[0]?.hour, 15);
  assert.equal(buckets[buckets.length - 1]?.hour, 39);
});

test('a clock that steps backwards does not open a bucket out of order', () => {
  // NTP corrections happen, and a bucket list that is not sorted by hour would
  // make the window sums count the same hour twice.
  const buckets: CounterBucket[] = [];
  recordBucketIncrement(buckets, 'tick', 1, AT(100));
  recordBucketIncrement(buckets, 'tick', 1, AT(101));
  recordBucketIncrement(buckets, 'tick', 1, AT(99));
  assert.equal(buckets.length, 2);
  assert.deepEqual(
    buckets.map((bucket) => bucket.hour),
    [100, 101]
  );
  // The late increment is not lost, it just lands in the open bucket.
  assert.equal(buckets[1]?.counters.tick, 2);
});

test('the window is what makes a success rate readable', () => {
  // The production shape: a long history under the old counting, then an hour
  // of traffic under the new one.
  const buckets: CounterBucket[] = [];
  recordBucketIncrement(buckets, 'play_attempt', 200, AT(1000));
  recordBucketIncrement(buckets, 'play_success', 30, AT(1000));

  recordBucketIncrement(buckets, 'play_attempt', 20, AT(1024));
  recordBucketIncrement(buckets, 'play_superseded', 12, AT(1024));
  recordBucketIncrement(buckets, 'play_success', 7, AT(1024));

  const { last1h } = summariseCounterWindows(buckets, AT(1024, 40));
  const honest =
    (last1h.counters.play_success ?? 0) /
    ((last1h.counters.play_attempt ?? 0) - (last1h.counters.play_superseded ?? 0));
  assert.ok(honest > 0.87 && honest < 0.88, `expected ~7/8, got ${honest}`);
});
