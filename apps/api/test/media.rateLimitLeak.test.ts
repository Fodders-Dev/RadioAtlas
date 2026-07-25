import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { ProtectedMediaRoute } from '../src/media/protection.js';

/**
 * Both maps behind the media rate limiter only ever grew.
 *
 * `rateLimits` stored one bucket per client address and never deleted any — an
 * expired bucket was OVERWRITTEN, and only if that same address came back, so a
 * one-time visitor kept a bucket for the life of the process. `alertCooldowns`
 * is keyed `media-rate-limit:<route>:<ip>` and was write-only.
 *
 * This is the process whose memory ceiling already had to go 512M -> 896M
 * (#151), so an unbounded per-address map is not a theoretical concern.
 */
const requestFrom = (ip: string) =>
  ({
    ip,
    headers: {},
    get: () => undefined,
    socket: { remoteAddress: ip }
  }) as unknown as express.Request;

const routeFor = (windowMs: number) =>
  new ProtectedMediaRoute({
    routeName: 'leak-test',
    maxConcurrent: 4,
    queueLimit: 4,
    rateLimitPerWindow: 1000,
    rateLimitWindowMs: windowMs,
    cacheTtlMs: 1000
  });

test('buckets for addresses that never return do not accumulate forever', async () => {
  const windowMs = 40;
  const route = routeFor(windowMs);

  for (let i = 0; i < 500; i += 1) {
    route.checkRateLimit(requestFrom(`203.0.113.${i % 256}.${i}`));
  }
  const peak = route.rateLimitBucketCount;
  assert.ok(peak > 100, `expected the map to fill first, got ${peak}`);

  // Let every bucket expire, then make one more call from a single address.
  await new Promise((resolve) => setTimeout(resolve, windowMs + 20));
  route.checkRateLimit(requestFrom('198.51.100.7'));

  assert.equal(
    route.rateLimitBucketCount,
    1,
    `expired buckets must be swept; ${route.rateLimitBucketCount} survived out of ${peak}`
  );
});

test('a still-active bucket is never swept away', async () => {
  // The sweep must not hand a rate-limited caller a fresh allowance.
  const route = new ProtectedMediaRoute({
    routeName: 'leak-test-active',
    maxConcurrent: 4,
    queueLimit: 4,
    rateLimitPerWindow: 2,
    rateLimitWindowMs: 5_000,
    cacheTtlMs: 1000
  });

  const offender = requestFrom('198.51.100.9');
  assert.equal(route.checkRateLimit(offender), null);
  assert.equal(route.checkRateLimit(offender), null);

  // Fill the map with other addresses so a sweep would run if it were unguarded.
  for (let i = 0; i < 200; i += 1) {
    route.checkRateLimit(requestFrom(`203.0.113.${i}`));
  }

  const retryAfter = route.checkRateLimit(offender);
  assert.ok(
    typeof retryAfter === 'number' && retryAfter > 0,
    'the offender must still be limited after a sweep'
  );
});

test('the sweep costs nothing on a quiet route', () => {
  // It runs at most once per window; back-to-back calls must not re-scan.
  const route = routeFor(60_000);
  for (let i = 0; i < 50; i += 1) {
    route.checkRateLimit(requestFrom(`203.0.113.${i}`));
  }
  assert.equal(route.rateLimitBucketCount, 50, 'nothing has expired yet, so nothing is dropped');
});
