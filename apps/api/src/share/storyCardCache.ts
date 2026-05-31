// T_share_3 (PR-A): cache + single-flight + LRU bound around the (synchronous,
// ~100-300ms) story-card render — same discipline as summaryCache (#44), so
// concurrent shares of the same station collapse to ONE render and repeat shares
// hit the cache. Bounded (LRU, hundreds) — never 57k PNGs in memory. Keyed by
// stationId; content is stable so a multi-day TTL is fine (a failed render is
// NOT cached and clears inflight → the key never wedges; the route falls back).
//
// resolve(key, produce): the caller passes the per-call producer, so the route
// can gate id-validity BEFORE the cache — invalid/unknown ids serve the single
// static fallback and never enter the LRU (no cheap-DoS via /share/story/<rand>).

type RenderCacheOptions = {
  maxEntries: number;
  ttlMs: number;
};

export const createRenderCache = ({ maxEntries, ttlMs }: RenderCacheOptions) => {
  // Map insertion order doubles as the LRU order (re-insert on hit/store).
  const cache = new Map<string, { value: Buffer; ts: number }>();
  const inflight = new Map<string, Promise<Buffer>>();

  const resolve = (key: string, produce: () => Promise<Buffer>): Promise<Buffer> => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < ttlMs) {
      cache.delete(key);
      cache.set(key, hit); // LRU touch → most-recently-used
      return Promise.resolve(hit.value);
    }

    const pending = inflight.get(key);
    if (pending) return pending;

    const run = (async () => {
      const value = await produce();
      cache.set(key, { value, ts: Date.now() });
      while (cache.size > maxEntries) {
        const oldest = cache.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return value;
    })();

    inflight.set(key, run);
    const cleanup = () => {
      inflight.delete(key);
    };
    run.then(cleanup, cleanup);
    return run;
  };

  return { resolve };
};
