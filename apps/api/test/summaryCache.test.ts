import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as yieldTick } from 'node:timers/promises';
import { createSummaryCache } from '../src/catalog/summaryCache.js';

const BUCKET_MS = 1000;

// A catalog stand-in (only its reference identity matters to the cache).
type Catalog = { tag: string };

// Build a cache over a spy compute that is ASYNC (yields a tick before
// resolving) so the inflight/single-flight window is genuinely exercised.
const makeCache = (over: { maxBuckets?: number; mode?: { throw: boolean } } = {}) => {
  const state = { calls: 0, lastBucketSeed: -1 };
  const mode = over.mode ?? { throw: false };
  const cache = createSummaryCache<Catalog, { bucketSeed: number; n: number }>(
    async (catalog, bucketSeed) => {
      state.calls += 1;
      state.lastBucketSeed = bucketSeed;
      await yieldTick();
      if (mode.throw) throw new Error('compute failed');
      return { bucketSeed, n: state.calls };
    },
    { bucketMs: BUCKET_MS, maxBuckets: over.maxBuckets ?? 6 }
  );
  return { cache, state, mode };
};

test('single-flight: N concurrent same-bucket misses collapse to ONE compute', async () => {
  const { cache, state } = makeCache();
  const catalog: Catalog = { tag: 'a' };

  const [r1, r2, r3] = await Promise.all([
    cache.resolve(catalog, 100),
    cache.resolve(catalog, 200),
    cache.resolve(catalog, 300)
  ]);

  assert.equal(state.calls, 1, 'one compute for three concurrent same-bucket requests');
  assert.deepEqual(r1, r2);
  assert.deepEqual(r2, r3);
});

test('two seeds in the same hourly bucket → one compute + shared result; different buckets → separate', async () => {
  const { cache, state } = makeCache();
  const catalog: Catalog = { tag: 'a' };

  // Same bucket (both < BUCKET_MS) — second is a cache hit.
  const first = await cache.resolve(catalog, 100);
  const second = await cache.resolve(catalog, 999);
  assert.equal(state.calls, 1, 'same bucket reuses the compute');
  assert.deepEqual(first, second);
  // The frozen seed is the bucket start (0), not the per-load seed.
  assert.equal(first.bucketSeed, 0);

  // A different bucket recomputes.
  const otherBucket = await cache.resolve(catalog, BUCKET_MS + 5);
  assert.equal(state.calls, 2, 'a different bucket computes separately');
  assert.equal(otherBucket.bucketSeed, BUCKET_MS);
});

test('a catalog refresh (new array ref) in the same bucket busts the cache', async () => {
  const { cache, state } = makeCache();
  const catalogV1: Catalog = { tag: 'v1' };
  const catalogV2: Catalog = { tag: 'v2' };

  await cache.resolve(catalogV1, 100);
  await cache.resolve(catalogV1, 100);
  assert.equal(state.calls, 1, 'same catalog ref → cache hit');

  // getProfiledCatalog refreshed → new array reference → recompute.
  await cache.resolve(catalogV2, 100);
  assert.equal(state.calls, 2, 'new catalog ref in the same bucket recomputes');
});

test('the cache is bounded — oldest bucket is evicted past the cap', async () => {
  const { cache, state } = makeCache({ maxBuckets: 2 });
  const catalog: Catalog = { tag: 'a' };

  await cache.resolve(catalog, 0 * BUCKET_MS); // bucket 0, compute #1
  await cache.resolve(catalog, 1 * BUCKET_MS); // bucket 1, compute #2
  await cache.resolve(catalog, 2 * BUCKET_MS); // bucket 2, compute #3 → evicts bucket 0
  assert.equal(state.calls, 3);

  // Bucket 0 was evicted → recompute.
  await cache.resolve(catalog, 0 * BUCKET_MS);
  assert.equal(state.calls, 4, 'evicted bucket recomputes');

  // Bucket 2 is still cached → no recompute.
  await cache.resolve(catalog, 2 * BUCKET_MS);
  assert.equal(state.calls, 4, 'a still-cached bucket does not recompute');
});

test('a throwing compute rejects, clears inflight, and the next call recomputes cleanly', async () => {
  const { cache, state, mode } = makeCache();
  const catalog: Catalog = { tag: 'a' };

  // Concurrent failures share the one (rejected) compute…
  mode.throw = true;
  const results = await Promise.allSettled([
    cache.resolve(catalog, 100),
    cache.resolve(catalog, 200)
  ]);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[1].status, 'rejected');
  assert.equal(state.calls, 1, 'single-flight collapsed the two failing requests to one compute');

  // …and the bucket is NOT wedged: the next call recomputes (and now succeeds).
  mode.throw = false;
  const recovered = await cache.resolve(catalog, 100);
  assert.equal(state.calls, 2, 'inflight was cleared on rejection → recompute');
  assert.equal(recovered.n, 2);

  // And it's cached again.
  await cache.resolve(catalog, 100);
  assert.equal(state.calls, 2, 'success is cached');
});
