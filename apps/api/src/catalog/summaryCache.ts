// T_api_summary_cache: cache + single-flight around buildCatalogSummary.
//
// getSummary ran buildCatalogSummary fresh on every call — ~0.85s of synchronous
// CPU (multiple full ~57k seeded sorts) that serialized concurrent requests into
// a staircase and blocked the event loop. buildCatalogSummary is pure over
// (catalog, seed, dayNumber(now)), so it's cacheable. The webapp sends
// seed = Date.now() (unique per load), so we QUANTIZE the seed to an hourly
// bucket: every load within the hour shares one computed summary (the client
// caches summary:v2 for 6h, so per-load rotation freshness is illusory anyway).
//
// Invalidation is by the catalog ARRAY-REFERENCE identity: getProfiledCatalog
// returns a stable array while its 5-min cache is fresh and a NEW array on
// refresh, so a `===` check ties summary freshness to the catalog's own refresh
// (no parallel TTL to drift). A catalog refresh → ref changes → recompute.
//
// Single-flight: an inflight Map set synchronously BEFORE awaiting compute
// collapses N concurrent same-bucket misses to ONE compute. (Because
// buildCatalogSummary is synchronous, A's compute-and-set is atomic on the single
// thread so the plain cache mostly self-collapses already — but the cache `set`
// lands after compute's await microtask, so a request resuming at that yield
// would still recompute. The inflight entry is the robust guarantee, and also
// covers an async compute / any future refactor.)
//
// This caches AROUND buildCatalogSummary — its selection/determinism (the
// T_quality per-country caps, mood assignment, rotation) is untouched.

type SummaryCacheOptions = {
  bucketMs: number;
  maxBuckets: number;
};

export const createSummaryCache = <Catalog, Summary>(
  compute: (catalog: Catalog, bucketSeed: number) => Summary | Promise<Summary>,
  { bucketMs, maxBuckets }: SummaryCacheOptions
) => {
  const cache = new Map<number, { catalog: Catalog; value: Summary }>();
  const inflight = new Map<number, Promise<Summary>>();

  // Hourly buckets → only ~1-2 live at once; the cap is a backstop so a
  // quantization bug can't grow the map unbounded. Evict the smallest (oldest)
  // bucket key first.
  const evictOverflow = () => {
    while (cache.size > maxBuckets) {
      let oldest: number | undefined;
      for (const key of cache.keys()) {
        if (oldest === undefined || key < oldest) oldest = key;
      }
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };

  const resolve = (catalog: Catalog, seed: number): Promise<Summary> => {
    const bucket = Math.floor(seed / bucketMs);

    const hit = cache.get(bucket);
    // Reference identity: a getProfiledCatalog refresh hands back a new array, so
    // `!==` busts the bucket and we recompute against the fresh catalog.
    if (hit && hit.catalog === catalog) {
      return Promise.resolve(hit.value);
    }

    const pending = inflight.get(bucket);
    if (pending) return pending;

    const run = (async () => {
      // Seed is frozen to the bucket start so every load in the hour shares the
      // same rotation. `now` is left to default to real compute-time inside
      // buildCatalogSummary (day-granular aroundTheWorld rotation + generatedAt)
      // — NOT derived from the bucket.
      const value = await compute(catalog, bucket * bucketMs);
      // Reached ONLY on success → a failed compute is never cached.
      cache.set(bucket, { catalog, value });
      evictOverflow();
      return value;
    })();

    inflight.set(bucket, run);
    // Clear inflight on BOTH settle paths so a rejected compute never wedges the
    // bucket (the next call recomputes cleanly). Registering cleanup as the
    // onRejected handler here also means a fire-and-forget caller can't leave an
    // unhandled rejection; the returned `run` still rejects for real awaiters.
    const cleanup = () => {
      inflight.delete(bucket);
    };
    run.then(cleanup, cleanup);
    return run;
  };

  return { resolve };
};
