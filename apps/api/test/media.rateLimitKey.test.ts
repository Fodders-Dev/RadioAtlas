import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import { ProtectedMediaRoute } from '../src/media/protection.js';

/**
 * The metadata / fetch / stream / image limits used to key on the LEFTMOST
 * X-Forwarded-For value — a header the caller writes. Rotating it handed out a
 * fresh bucket every request, so those four limits existed in the code and did
 * nothing in production. (ai-chat was already fixed for this reason, because it
 * fronts paid DeepSeek calls.)
 *
 * These run through a real express app so `trust proxy` behaves exactly as it
 * does in index.ts, rather than against a hand-made request object.
 */
const withRoute = async (
  route: ProtectedMediaRoute<unknown>,
  run: (call: (headers?: Record<string, string>) => Promise<number>) => Promise<void>
) => {
  const app = express();
  app.set('trust proxy', 1);
  app.get('/probe', (req, res) => {
    const retryAfter = route.checkRateLimit(req);
    if (retryAfter) {
      res.status(429).json({ retryAfter });
      return;
    }
    res.json({ ok: true });
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(async (headers = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}/probe`, { headers });
      return response.status;
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

const makeRoute = (perWindow: number) =>
  new ProtectedMediaRoute({
    routeName: 'stream',
    maxConcurrency: 8,
    sharedMaxConcurrency: 16,
    rateLimitPerWindow: perWindow,
    rateLimitWindowMs: 60_000,
  });

test('a rotating X-Forwarded-For no longer buys a fresh allowance', async () => {
  const route = makeRoute(3);
  await withRoute(route, async (call) => {
    // Every request claims a different "client" address. Before the fix each one
    // opened its own bucket and nothing was ever limited.
    // Caddy appends the true address last; the caller can only control the
    // prefix. Measured: with `trust proxy 1`, "203.0.113.9, 198.51.100.5"
    // resolves req.ip to 198.51.100.5 no matter what precedes it.
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push(await call({ 'x-forwarded-for': `203.0.113.${i}, 198.51.100.5` }));
    }
    assert.deepEqual(
      statuses,
      [200, 200, 200, 429, 429, 429],
      `header rotation must not reset the window, got ${statuses.join(',')}`
    );
    assert.equal(route.rateLimitBucketCount, 1, 'all of it must land in ONE bucket');
  });
});

test('a spoofed loopback address does not get its own bucket either', async () => {
  const route = makeRoute(2);
  await withRoute(route, async (call) => {
    assert.equal(await call({ 'x-forwarded-for': '127.0.0.1, 198.51.100.5' }), 200);
    assert.equal(await call({ 'x-forwarded-for': '::1, 198.51.100.5' }), 200);
    assert.equal(await call({ 'x-forwarded-for': '10.0.0.1, 198.51.100.5' }), 429);
    assert.equal(route.rateLimitBucketCount, 1);
  });
});

test('a caller with no forwarding header is still limited normally', async () => {
  const route = makeRoute(2);
  await withRoute(route, async (call) => {
    assert.equal(await call(), 200);
    assert.equal(await call(), 200);
    assert.equal(await call(), 429);
  });
});
