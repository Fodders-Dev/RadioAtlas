import assert from 'node:assert/strict';
import test from 'node:test';
import { createTavilyWebSearch } from '../src/ai/webSearch.js';

const okResponse = (results: unknown[]) =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ results })
  }) as unknown as Response;

const result = (over: Record<string, unknown> = {}) => ({
  title: 'Oliver Tree tour',
  url: 'https://example.com/a',
  content: 'Oliver Tree is alive and touring.',
  score: 0.9,
  published_date: '2026-06-01',
  ...over
});

test('webSearch: maps Tavily results, drops below the 0.5 score floor', async () => {
  const fetchImpl = (async () =>
    okResponse([
      result({ url: 'https://a', score: 0.9 }),
      result({ url: 'https://b', score: 0.3 }), // below floor → dropped
      result({ url: 'https://c', score: 0.6 })
    ])) as unknown as typeof fetch;
  const ws = createTavilyWebSearch({ apiKey: 'k', dailyCap: 300, fetch: fetchImpl, now: () => 0 });
  const out = await ws.search('жив ли oliver tree', { fresh: true });
  assert.equal(out.status, 'ok');
  assert.deepEqual(out.sources.map((s) => s.url), ['https://a', 'https://c']);
  assert.equal(out.sources[0]?.score, 0.9);
});

test('webSearch (d): the daily cap refuses WITHOUT calling fetch', async () => {
  let fetchCalls = 0;
  const fetchImpl = (async () => {
    fetchCalls += 1;
    return okResponse([result()]);
  }) as unknown as typeof fetch;
  const ws = createTavilyWebSearch({ apiKey: 'k', dailyCap: 1, fetch: fetchImpl, now: () => 0 });

  const first = await ws.search('query one', { fresh: false });
  assert.equal(first.status, 'ok');
  assert.equal(fetchCalls, 1);

  // Second DISTINCT query is over the cap → refused, fetch NOT called again.
  const second = await ws.search('query two', { fresh: false });
  assert.equal(second.status, 'capped');
  assert.deepEqual(second.sources, []);
  assert.equal(fetchCalls, 1, 'no fetch over the cap');
});

test('webSearch: a repeated query inside the TTL is served from cache (no extra fetch)', async () => {
  let fetchCalls = 0;
  const fetchImpl = (async () => {
    fetchCalls += 1;
    return okResponse([result()]);
  }) as unknown as typeof fetch;
  let clock = 0;
  const ws = createTavilyWebSearch({ apiKey: 'k', dailyCap: 300, fetch: fetchImpl, now: () => clock });

  await ws.search('same query', { fresh: false });
  clock += 60_000; // < 1h stale TTL
  await ws.search('same query', { fresh: false });
  assert.equal(fetchCalls, 1, 'cache hit, no second fetch');

  // A fresh («жив/умер») query has a 3-min TTL: past it, refetch.
  await ws.search('жив ли артист', { fresh: true });
  clock += 4 * 60_000;
  await ws.search('жив ли артист', { fresh: true });
  assert.equal(fetchCalls, 3, 'fresh TTL expired → refetch');
});

test('webSearch: a non-2xx / thrown fetch degrades to error with no sources', async () => {
  const boom = (async () => {
    throw new Error('network down');
  }) as unknown as typeof fetch;
  const ws = createTavilyWebSearch({ apiKey: 'k', dailyCap: 300, fetch: boom, now: () => 0 });
  const out = await ws.search('anything', { fresh: false });
  assert.equal(out.status, 'error');
  assert.deepEqual(out.sources, []);
});

test('webSearch: empty key short-circuits to empty (never calls fetch)', async () => {
  let fetchCalls = 0;
  const fetchImpl = (async () => {
    fetchCalls += 1;
    return okResponse([result()]);
  }) as unknown as typeof fetch;
  const ws = createTavilyWebSearch({ apiKey: '', dailyCap: 300, fetch: fetchImpl, now: () => 0 });
  const out = await ws.search('x', { fresh: false });
  assert.equal(out.status, 'empty');
  assert.equal(fetchCalls, 0);
});
