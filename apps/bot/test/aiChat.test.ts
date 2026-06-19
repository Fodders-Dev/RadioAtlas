import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_FALLBACK_TEXT,
  buildAiButtons,
  createAiLimiter,
  isAiEligibleMessage,
  requestAiChat,
  stationDeepLink,
  type AiChatResult
} from '../src/aiChat.js';

const stubFetch = (response: { ok: boolean; status?: number; body?: unknown }) => {
  const calls: Array<{ url: string; init: any }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: any) => {
    calls.push({ url: typeof input === 'string' ? input : input.toString(), init });
    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      // Loosened: a test may pass body:null to exercise the null-JSON path.
      json: async () => ('body' in response ? response.body : {})
    } as Response;
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
};

const deps = (fetchImpl: typeof fetch) => ({
  fetch: fetchImpl,
  apiUrl: 'http://127.0.0.1:3001',
  internalWebhookToken: 'secret-token'
});

test('requestAiChat posts to the internal endpoint with the X-Internal-Token and body', async () => {
  const { fetch: fetchImpl, calls } = stubFetch({
    ok: true,
    body: { reply: 'Привет!', stations: [{ stationuuid: 'u1', name: 'Jazz', country: 'FR' }], serviceLinks: [] }
  });
  const result = await requestAiChat({ telegramId: 42, text: 'привет' }, deps(fetchImpl));
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'http://127.0.0.1:3001/internal/bot/ai-chat');
  assert.equal(calls[0]?.init?.headers['X-Internal-Token'], 'secret-token');
  const body = JSON.parse(calls[0]?.init?.body);
  assert.equal(body.telegramId, '42');
  assert.equal(body.text, 'привет');
  assert.equal(result?.reply, 'Привет!');
  assert.equal(result?.stations[0]?.stationuuid, 'u1');
});

test('requestAiChat forwards conversation history in the body (so the brain has context)', async () => {
  const { fetch: fetchImpl, calls } = stubFetch({ ok: true, body: { reply: 'ok' } });
  const history = [
    { role: 'user' as const, text: 'котёнок-поварёнок' },
    { role: 'assistant' as const, text: 'JPop Kawaii' }
  ];
  await requestAiChat({ telegramId: 7, text: 'без азиатских нот', history }, deps(fetchImpl));
  const body = JSON.parse(calls[0]?.init?.body);
  assert.deepEqual(body.history, history);
});

test('requestAiChat returns null on a non-200 (bot then shows the warm fallback)', async () => {
  const { fetch: fetchImpl } = stubFetch({ ok: false, status: 500 });
  assert.equal(await requestAiChat({ telegramId: 1, text: 'hi' }, deps(fetchImpl)), null);
  assert.ok(AI_FALLBACK_TEXT.length > 0);
});

test('requestAiChat returns null when apiUrl or token is missing (never calls fetch)', async () => {
  const { fetch: fetchImpl, calls } = stubFetch({ ok: true, body: { reply: 'x' } });
  assert.equal(
    await requestAiChat({ telegramId: 1, text: 'hi' }, { fetch: fetchImpl, apiUrl: '', internalWebhookToken: 't' }),
    null
  );
  assert.equal(
    await requestAiChat({ telegramId: 1, text: 'hi' }, { fetch: fetchImpl, apiUrl: 'http://x', internalWebhookToken: '' }),
    null
  );
  assert.equal(calls.length, 0);
});

test('isAiEligibleMessage: private text only — skips commands, groups, empty and over-long', () => {
  assert.equal(isAiEligibleMessage({ text: 'посоветуй джаз', chatType: 'private' }), true);
  assert.equal(isAiEligibleMessage({ text: '/start', chatType: 'private' }), false);
  assert.equal(isAiEligibleMessage({ text: 'привет', chatType: 'group' }), false);
  assert.equal(isAiEligibleMessage({ text: 'привет', chatType: 'supergroup' }), false);
  assert.equal(isAiEligibleMessage({ text: '   ', chatType: 'private' }), false);
  assert.equal(isAiEligibleMessage({ text: 'a'.repeat(1001), chatType: 'private' }), false);
});

test('buildAiButtons: station deep-links one-per-row, service links two-per-row', () => {
  const result: AiChatResult = {
    reply: 'r',
    stations: [
      { stationuuid: 'u1', name: 'Jazz FM' },
      { stationuuid: 'u2', name: 'Focus Wave' }
    ],
    serviceLinks: [
      { service: 'spotify', label: 'Spotify', url: 'https://open.spotify.com/search/x', query: 'x' },
      { service: 'youtube', label: 'YouTube', url: 'https://youtube.com/results?search_query=x', query: 'x' },
      { service: 'yandex', label: 'Яндекс Музыка', url: 'https://music.yandex.ru/search?text=x', query: 'x' }
    ]
  };
  const rows = buildAiButtons(result, 'radioatlasbot');
  assert.equal(rows[0]?.[0]?.url, stationDeepLink('radioatlasbot', 'u1'));
  assert.equal(rows[0]?.[0]?.url, 'https://t.me/radioatlasbot?startapp=station_u1');
  assert.equal(rows[1]?.[0]?.url, stationDeepLink('radioatlasbot', 'u2'));
  // service links: [Spotify, YouTube] on one row, [Яндекс] on the next.
  assert.equal(rows[2]?.length, 2);
  assert.equal(rows[3]?.length, 1);
});

test('buildAiButtons: no username → no station deep-links (avoids t.me/undefined)', () => {
  const result: AiChatResult = {
    reply: 'r',
    stations: [{ stationuuid: 'u1', name: 'Jazz' }],
    serviceLinks: []
  };
  assert.deepEqual(buildAiButtons(result, ''), []);
});

test('buildAiButtons with no stations and no links → empty keyboard', () => {
  assert.deepEqual(buildAiButtons({ reply: 'r', stations: [], serviceLinks: [] }, 'validuser'), []);
});

test('requestAiChat returns null on a 200 with a malformed body (reply not a string / null)', async () => {
  const numberReply = stubFetch({ ok: true, body: { reply: 42 } });
  assert.equal(await requestAiChat({ telegramId: 1, text: 'hi' }, deps(numberReply.fetch)), null);
  const nullBody = stubFetch({ ok: true, body: null });
  assert.equal(await requestAiChat({ telegramId: 1, text: 'hi' }, deps(nullBody.fetch)), null);
});

test('createAiLimiter: 10 ok then flood; window expiry resets; busy on in-flight; global cap; release frees', () => {
  let clock = 0;
  const limiter = createAiLimiter({ windowMs: 1000, maxPerWindow: 10, maxInflight: 8, now: () => clock });

  for (let i = 0; i < 10; i += 1) assert.equal(limiter.verdict('u1'), 'ok');
  assert.equal(limiter.verdict('u1'), 'flood'); // 11th

  clock += 1000; // window rolls over
  assert.equal(limiter.verdict('u1'), 'ok');

  // in-flight → busy for the SAME user (acquire without release).
  limiter.acquire('u2');
  assert.equal(limiter.verdict('u2'), 'busy');
  limiter.release('u2');
  assert.equal(limiter.verdict('u2'), 'ok');

  // global in-flight cap = 8: hold 8 distinct users in flight → a 9th is busy.
  const fresh = createAiLimiter({ windowMs: 1000, maxPerWindow: 10, maxInflight: 8, now: () => clock });
  for (let i = 0; i < 8; i += 1) fresh.acquire(`g${i}`);
  assert.equal(fresh.verdict('g8'), 'busy');
  fresh.release('g0');
  assert.equal(fresh.verdict('g8'), 'ok');
});

test('createAiLimiter prunes empty rolling-window buckets (no unbounded Map growth)', () => {
  let clock = 0;
  const limiter = createAiLimiter({ windowMs: 1000, maxPerWindow: 5, maxInflight: 8, now: () => clock });
  limiter.verdict('a');
  limiter.verdict('b');
  assert.equal(limiter.size(), 2);
  clock += 1000; // both windows expire
  limiter.verdict('a'); // prune deletes a(old) + b, then re-adds a
  assert.equal(limiter.size(), 1); // only the fresh 'a' bucket; 'b' removed, not kept empty
});
