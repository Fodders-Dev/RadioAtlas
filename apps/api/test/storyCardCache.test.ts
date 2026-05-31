import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as yieldTick } from 'node:timers/promises';
import { createRenderCache } from '../src/share/storyCardCache.js';

const png = (tag: string) => Buffer.from(`png:${tag}`);

test('single-flight: N concurrent resolves of one key produce ONCE', async () => {
  let produces = 0;
  const cache = createRenderCache({ maxEntries: 10, ttlMs: 60_000 });
  const produce = async () => {
    produces += 1;
    await yieldTick();
    return png('a');
  };

  const [a, b, c] = await Promise.all([
    cache.resolve('a', produce),
    cache.resolve('a', produce),
    cache.resolve('a', produce)
  ]);

  assert.equal(produces, 1, 'three concurrent same-key resolves collapse to one render');
  assert.ok(a.equals(b) && b.equals(c));
});

test('cache hit: a repeat resolve does not re-produce', async () => {
  let produces = 0;
  const cache = createRenderCache({ maxEntries: 10, ttlMs: 60_000 });
  const produce = async () => {
    produces += 1;
    return png('a');
  };

  await cache.resolve('a', produce);
  await cache.resolve('a', produce);
  assert.equal(produces, 1);
});

test('LRU bound evicts the oldest key past the cap', async () => {
  const cache = createRenderCache({ maxEntries: 2, ttlMs: 60_000 });
  const counts: Record<string, number> = {};
  const produce = (key: string) => async () => {
    counts[key] = (counts[key] || 0) + 1;
    return png(key);
  };

  await cache.resolve('k1', produce('k1'));
  await cache.resolve('k2', produce('k2'));
  await cache.resolve('k3', produce('k3')); // → evicts k1 (oldest)
  await cache.resolve('k1', produce('k1')); // evicted → re-produce
  await cache.resolve('k3', produce('k3')); // still cached → no re-produce

  assert.equal(counts.k1, 2, 'evicted key re-produces');
  assert.equal(counts.k3, 1, 'still-cached key does not');
});

test('a zero TTL never serves stale (re-produces each call)', async () => {
  let produces = 0;
  const cache = createRenderCache({ maxEntries: 10, ttlMs: 0 });
  const produce = async () => {
    produces += 1;
    return png('a');
  };
  await cache.resolve('a', produce);
  await cache.resolve('a', produce);
  assert.equal(produces, 2);
});

test('a failed render is not cached and clears inflight → next call recomputes', async () => {
  const cache = createRenderCache({ maxEntries: 10, ttlMs: 60_000 });
  let mode: 'throw' | 'ok' = 'throw';
  let produces = 0;
  const produce = async () => {
    produces += 1;
    await yieldTick();
    if (mode === 'throw') throw new Error('render failed');
    return png('a');
  };

  const settled = await Promise.allSettled([cache.resolve('a', produce), cache.resolve('a', produce)]);
  assert.equal(settled[0].status, 'rejected');
  assert.equal(settled[1].status, 'rejected');
  assert.equal(produces, 1, 'concurrent failures collapse to one render');

  mode = 'ok';
  const recovered = await cache.resolve('a', produce);
  assert.equal(produces, 2, 'inflight cleared on failure → recompute');
  assert.ok(recovered.equals(png('a')));
});
