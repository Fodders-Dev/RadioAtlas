import assert from 'node:assert/strict';
import test from 'node:test';
import type express from 'express';
import { createStationStoryResolver, lautFmSlugForStation } from '../src/catalog/stationStory.js';
import { registerCatalogRoutes } from '../src/catalogRoutes.js';

const station = (patch: Partial<{ homepage: string; url: string; url_resolved: string }> = {}) => ({
  homepage: 'https://laut.fm/jcradio4m3',
  url: 'https://stream.laut.fm/jcradio4m3',
  url_resolved: 'https://stream.laut.fm/jcradio4m3',
  ...patch
});
const payload = (patch: Record<string, unknown> = {}) => ({
  name: 'jcradio4m3',
  description: ' Ein christliches Jugendradio. ',
  images: { station_640x640: 'https://assets.laut.fm/images/jcradio4m3/640x640.png' },
  top_artists: ['Cross', 'ApologetiX', 'Matt Redman', 'Switchfoot', 'Ignored fifth'],
  ...patch
});
const response = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json' },
  ...init
});

test('laut.fm slug identification is exact and never fetches a caller-supplied host', async () => {
  assert.equal(lautFmSlugForStation(station()), 'jcradio4m3');
  assert.equal(lautFmSlugForStation(station({ homepage: 'https://laut.fm.evil.test/jcradio4m3', url: 'https://evil.test/live', url_resolved: 'https://evil.test/live' })), null);
  assert.equal(lautFmSlugForStation(station({ homepage: 'https://evil.test/jcradio4m3', url: 'https://evil.test/live', url_resolved: 'https://evil.test/live' })), null);
  assert.equal(lautFmSlugForStation(station({ homepage: 'https://laut.fm/user@evil.test/jcradio4m3', url: 'https://evil.test/live', url_resolved: 'https://evil.test/live' })), null);
  let calls = 0;
  const resolver = createStationStoryResolver({ fetch: async () => { calls += 1; return response(payload()); } });
  assert.equal(await resolver.resolve(station({ homepage: 'https://evil.test/live', url: 'https://evil.test/live', url_resolved: 'https://evil.test/live' })), null);
  assert.equal(calls, 0);
});

test('story allowlist keeps original copy, first four artists, and only station artwork on assets.laut.fm', async () => {
  const resolver = createStationStoryResolver({ fetch: async (input, init) => {
    assert.equal(String(input), 'https://api.laut.fm/station/jcradio4m3');
    assert.equal((init as RequestInit).redirect, 'manual');
    return response(payload({ images: {
      station_640x640: 'https://assets.laut.fm/logo.png',
      website_640x640: 'https://assets.laut.fm/site.png'
    } }));
  } });
  assert.deepEqual(await resolver.resolve(station()), {
    description: 'Ein christliches Jugendradio.',
    artworkUrl: 'https://assets.laut.fm/logo.png',
    artists: ['Cross', 'ApologetiX', 'Matt Redman', 'Switchfoot'],
    sourceUrl: 'https://laut.fm/jcradio4m3',
    sourceLabel: 'laut.fm'
  });
  for (const artwork of ['http://assets.laut.fm/a.png', 'https://assets.laut.fm:444/a.png', 'https://evil.test/a.png']) {
    const noArtwork = createStationStoryResolver({ fetch: async () => response(payload({
      description: '', top_artists: [], images: { station_640x640: artwork }
    })) });
    assert.equal(await noArtwork.resolve(station()), null);
  }
});

test('provider data for another station and empty payloads resolve to null', async () => {
  for (const data of [payload({ name: 'different-station' }), { name: 'jcradio4m3', description: '', top_artists: [], images: {} }]) {
    const resolver = createStationStoryResolver({ fetch: async () => response(data) });
    assert.equal(await resolver.resolve(station()), null);
  }
});

test('provider response body has a hard byte limit', async () => {
  let cancelled = false;
  const bigBody = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(128 * 1024 + 1)); },
    cancel() { cancelled = true; }
  });
  const resolver = createStationStoryResolver({ fetch: async () => new Response(bigBody) });
  assert.equal(await resolver.resolve(station()), null);
  assert.equal(cancelled, true);
});

test('provider timeout covers a stalled response body and caches the failure briefly', async () => {
  let now = 0;
  let calls = 0;
  const resolver = createStationStoryResolver({
    now: () => now,
    timeoutMs: 20,
    fetch: async (_input, init) => {
      calls += 1;
      const signal = (init as RequestInit).signal as AbortSignal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) { signal.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true }); }
      });
      return new Response(body);
    }
  });
  assert.equal(await resolver.resolve(station()), null);
  assert.equal(await resolver.resolve(station()), null);
  assert.equal(calls, 1);
  now += 120_001;
  assert.equal(await resolver.resolve(station()), null);
  assert.equal(calls, 2);
});

test('provider requests deduplicate and successful values use the six-hour cache', async () => {
  let now = 0;
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const resolver = createStationStoryResolver({
    now: () => now,
    fetch: async () => { calls += 1; await gate; return response(payload()); }
  });
  const first = resolver.resolve(station());
  const second = resolver.resolve(station());
  release();
  assert.deepEqual(await first, await second);
  assert.equal(calls, 1);
  await resolver.resolve(station());
  assert.equal(calls, 1);
  now += 6 * 60 * 60 * 1000 + 1;
  await resolver.resolve(station());
  assert.equal(calls, 2);
});

test('provider concurrency is capped at four and excess distinct slugs fail fast', async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const resolver = createStationStoryResolver({ fetch: async () => {
    calls += 1;
    await gate;
    return response(payload());
  } });
  const requests = ['one', 'two', 'three', 'four'].map((slug) => resolver.resolve(station({
    homepage: `https://laut.fm/${slug}`,
    url: `https://stream.laut.fm/${slug}`,
    url_resolved: `https://stream.laut.fm/${slug}`
  })));
  assert.equal(calls, 4);
  assert.equal(await resolver.resolve(station({
    homepage: 'https://laut.fm/five',
    url: 'https://stream.laut.fm/five',
    url_resolved: 'https://stream.laut.fm/five'
  })), null);
  assert.equal(calls, 4);
  release();
  await Promise.all(requests);
});

test('story route returns 404 for unknown stations and null immediately for non-laut.fm stations', async () => {
  const stations = [
    { stationuuid: 'non-laut', name: 'Other', url: 'https://radio.example/live', url_resolved: 'https://radio.example/live', homepage: 'https://radio.example/' }
  ];
  const handlers = new Map<string, (req: any, res: any) => Promise<void>>();
  let resolverCalls = 0;
  registerCatalogRoutes({ get: (path: string, handler: (req: any, res: any) => Promise<void>) => handlers.set(path, handler) } as unknown as express.Express, {
    getCatalog: async () => stations as any,
    withStationProfiles: async (value) => value,
    stationStory: { resolve: async () => { resolverCalls += 1; return null; } }
  });
  const route = handlers.get('/catalog/stations/:id/story')!;
  const run = async (id: string) => {
    const result: { status: number; body?: unknown } = { status: 200 };
    const res = {
      status(code: number) { result.status = code; return this; },
      set() { return this; },
      json(body: unknown) { result.body = body; return this; }
    };
    await route({ params: { id } }, res);
    return result;
  };
  assert.deepEqual(await run('missing'), { status: 404, body: { error: 'Station not found' } });
  assert.deepEqual(await run('non-laut'), { status: 200, body: { story: null } });
  assert.equal(resolverCalls, 1);
});
