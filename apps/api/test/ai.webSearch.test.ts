import assert from 'node:assert/strict';
import test from 'node:test';
import { createTavilyWebSearch, resolveTavilyRelayUrl } from '../src/ai/webSearch.js';

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

test('webSearch: only an explicit literal loopback origin is a credential relay', () => {
  assert.equal(resolveTavilyRelayUrl('http://127.0.0.1:8399'), 'http://127.0.0.1:8399/tavily/search');
  for (const base of [undefined, '', 'https://api.telegram.org', 'http://evil.test:8399',
    'http://localhost:8399', 'http://127.0.0.1', 'http://127.0.0.1:8399/prefix',
    'http://user@127.0.0.1:8399', 'http://127.0.0.1:8399/?secret=1', 'http://127.0.0.1:8399/#x']) {
    assert.equal(resolveTavilyRelayUrl(base), null, base);
  }
});

test('webSearch: one refused direct request uses bounded relay, then cache and daily cap', async () => {
  const urls: string[] = [];
  const requests: RequestInit[] = [];
  let cancelled = false;
  const ws = createTavilyWebSearch({apiKey:'k',dailyCap:2,relayBase:'http://127.0.0.1:8399',now:()=>0,
    fetch: (async (url, init) => {
      urls.push(String(url)); requests.push(init!);
      if (urls.length === 1) return {ok:false,status:403,body:{cancel:async()=>{cancelled=true;}}} as unknown as Response;
      assert.equal(cancelled, true, 'release the refused body before trying the relay');
      return okResponse([result()]);
    }) as typeof fetch});
  assert.equal((await ws.search('first', {fresh:false})).status,'ok');
  assert.deepEqual(urls,['https://api.tavily.com/search','http://127.0.0.1:8399/tavily/search']);
  const [direct, relayed] = requests;
  assert.ok(direct);
  assert.ok(relayed);
  assert.equal(direct.signal,relayed.signal,'one overall deadline');
  assert.equal(relayed.redirect,'error');
  assert.equal((await ws.search('first', {fresh:false})).status,'ok');
  assert.equal(urls.length,2,'cache costs no second search');
  assert.equal((await ws.search('second', {fresh:false})).status,'ok');
  assert.equal(urls[2],'http://127.0.0.1:8399/tavily/search');
  assert.equal((await ws.search('third', {fresh:false})).status,'capped');
  assert.equal(urls.length,3);
});

test('webSearch: no relay retry for authentication, quota, empty results or transport error', async () => {
  for (const status of [401,429,500,200,'throw'] as const) {
    const urls: string[] = [];
    const ws = createTavilyWebSearch({apiKey:'k',dailyCap:1,relayBase:'http://127.0.0.1:8399',now:()=>0,
      fetch:(async url=>{
        urls.push(String(url));
        if (status === 'throw') throw new Error('network');
        if (status === 200) return okResponse([]);
        return new Response('{}',{status});
      }) as typeof fetch});
    assert.equal((await ws.search('probe',{fresh:false})).status,status === 200 ? 'empty' : 'error');
    assert.deepEqual(urls,['https://api.tavily.com/search']);
  }
});

test('webSearch: simultaneous direct refusals each retain their own fallback', async () => {
  const pending: Array<(response:Response)=>void> = [];
  let relayed = 0;
  const ws = createTavilyWebSearch({apiKey:'k',dailyCap:2,relayBase:'http://127.0.0.1:8399',now:()=>0,
    fetch:(async url=>{
      if (String(url).startsWith('http://127.0.0.1:8399/')) { relayed++; return okResponse([result()]); }
      return new Promise<Response>(resolve=>pending.push(resolve));
    }) as typeof fetch});
  const first = ws.search('one',{fresh:false});
  const second = ws.search('two',{fresh:false});
  assert.equal(pending.length,2);
  pending[0]!(new Response('{}',{status:403}));
  assert.equal((await first).status,'ok');
  pending[1]!(new Response('{}',{status:403}));
  assert.equal((await second).status,'ok');
  assert.equal(relayed,2);
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

test('webSearch: authenticates with Bearer and keeps the key out of the search body', async () => {
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer server-only-test-key');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.api_key, undefined);
    assert.equal(body.query, 'Daft Punk Get Lucky album');
    assert.equal(body.search_depth, 'basic');
    assert.equal(body.include_raw_content, false);
    return okResponse([result()]);
  }) as typeof fetch;
  const ws = createTavilyWebSearch({apiKey:'server-only-test-key',dailyCap:1,fetch:fetchImpl,now:()=>0});
  assert.equal((await ws.search('Daft Punk Get Lucky album', {fresh:false})).status, 'ok');
});

test('webSearch: lyrics analysis can request cleaned page content without poisoning snippet cache', async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>);
    return okResponse([
      result({
        content: 'Short search snippet.',
        raw_content: 'Cleaned full page content for private analysis.'
      })
    ]);
  }) as unknown as typeof fetch;
  const ws = createTavilyWebSearch({ apiKey: 'k', dailyCap: 300, fetch: fetchImpl, now: () => 0 });

  const content = await ws.search('Song lyrics', { fresh: false, includeContent: true });
  const snippet = await ws.search('Song lyrics', { fresh: false });

  assert.equal(content.sources[0]?.snippet, 'Cleaned full page content for private analysis.');
  assert.equal(snippet.sources[0]?.snippet, 'Short search snippet.');
  assert.equal(bodies[0]?.include_raw_content, 'text');
  assert.equal(bodies[1]?.include_raw_content, false);
  assert.equal(bodies.length, 2, 'content and snippet modes use separate cache keys');
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
