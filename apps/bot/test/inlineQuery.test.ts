import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveInlineQuery, type InlineQueryDeps } from '../src/inlineQuery.js';

const apiUrl = 'http://127.0.0.1:3001';

// A minimal fetch stub: records the requested URL and returns a canned body.
const stubFetch = (
  handler: (url: string) => { ok: boolean; body: unknown }
): { fetch: typeof fetch; urls: string[] } => {
  const urls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    urls.push(url);
    const { ok, body } = handler(url);
    return {
      ok,
      json: async () => body
    } as Response;
  }) as typeof fetch;
  return { fetch: fetchImpl, urls };
};

const station = (id: string) => ({
  stationuuid: id,
  name: `Station ${id}`,
  favicon: `https://cdn.example.com/${id}.png`,
  country: 'Japan',
  tags: 'jpop'
});

test('resolveInlineQuery: a typed query hits /catalog/search and returns article results', async () => {
  const { fetch, urls } = stubFetch(() => ({ ok: true, body: { items: [station('a'), station('b')] } }));
  const { results, cacheTime } = await resolveInlineQuery(
    { query: 'jazz', username: 'radioatlasbot' },
    { fetch, apiUrl } as InlineQueryDeps
  );

  assert.equal(urls.length, 1);
  assert.ok(urls[0].includes('/catalog/search?q=jazz&limit=12'), urls[0]);
  assert.equal(results.length, 2);
  assert.equal(results[0].id, 'a');
  assert.equal(cacheTime, 60);
});

test('resolveInlineQuery: an empty query hits /catalog/summary and returns trending', async () => {
  const { fetch, urls } = stubFetch(() => ({
    ok: true,
    body: { trending: [station('t1'), station('t2'), station('t3')] }
  }));
  const { results } = await resolveInlineQuery(
    { query: '   ', username: 'radioatlasbot' },
    { fetch, apiUrl } as InlineQueryDeps
  );

  assert.equal(urls.length, 1);
  assert.ok(urls[0].endsWith('/catalog/summary'), urls[0]);
  assert.equal(results.length, 3);
  assert.equal(results[0].id, 't1');
});

test('resolveInlineQuery: query is URL-encoded into the search path', async () => {
  const { fetch, urls } = stubFetch(() => ({ ok: true, body: { items: [] } }));
  await resolveInlineQuery({ query: 'lo-fi & chill', username: 'radioatlasbot' }, {
    fetch,
    apiUrl
  } as InlineQueryDeps);
  assert.ok(urls[0].includes('q=lo-fi%20%26%20chill'), urls[0]);
});

test('resolveInlineQuery: API non-2xx → graceful fallback result (no crash)', async () => {
  const { fetch } = stubFetch(() => ({ ok: false, body: { error: 'boom' } }));
  const { results } = await resolveInlineQuery(
    { query: 'jazz', username: 'radioatlasbot' },
    { fetch, apiUrl } as InlineQueryDeps
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'open-radioatlas');
});

test('resolveInlineQuery: fetch throws → graceful fallback result (no crash)', async () => {
  const fetchImpl = (async () => {
    throw new Error('network down');
  }) as typeof fetch;
  const { results } = await resolveInlineQuery(
    { query: 'jazz', username: 'radioatlasbot' },
    { fetch: fetchImpl, apiUrl }
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'open-radioatlas');
});

test('resolveInlineQuery: no apiUrl configured → fallback without touching fetch', async () => {
  let called = 0;
  const fetchImpl = (async () => {
    called += 1;
    return { ok: true, json: async () => ({ items: [] }) } as Response;
  }) as typeof fetch;
  const { results } = await resolveInlineQuery(
    { query: 'jazz', username: 'radioatlasbot' },
    { fetch: fetchImpl, apiUrl: '' }
  );
  assert.equal(called, 0);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'open-radioatlas');
});
