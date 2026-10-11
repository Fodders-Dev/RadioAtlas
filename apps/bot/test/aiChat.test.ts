import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_FALLBACK_TEXT,
  AI_FALLBACK_OFFER_PREFIX,
  buildAiButtons,
  createAiFallbackOffers,
  createAiLimiter,
  deliverAiFallbackOffer,
  deliverAiChatReply,
  isAiEligibleMessage,
  requestAiChat,
  runAiFallbackCallback,
  stationDeepLink,
  type AiChatResult
} from '../src/aiChat.js';

const stubFetch = (response: {
  ok: boolean;
  status?: number;
  body?: unknown;
  redirected?: boolean;
  url?: string;
}) => {
  const calls: Array<{ url: string; init: any }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: any) => {
    calls.push({ url: typeof input === 'string' ? input : input.toString(), init });
    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      redirected: response.redirected ?? false,
      url: response.url ?? (typeof input === 'string' ? input : input.toString()),
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

test('requestAiChat forwards only the explicit fallback ticket and parses typed provider metadata', async () => {
  const { fetch: fetchImpl, calls } = stubFetch({ ok: true, body: {
    reply: 'Tokyo jazz', stations: [], serviceLinks: [], sources: [],
    provider: { name: 'deepseek', fallback: true }
  } });
  const result = await requestAiChat({ telegramId: 7, text: 'Tokyo', history: [], fallbackToken: 'ticket-1' }, deps(fetchImpl));
  assert.equal(JSON.parse(calls[0]?.init?.body).fallbackToken, 'ticket-1');
  assert.deepEqual(result?.provider, { name: 'deepseek', fallback: true });
});

test('fallback offers are opaque, bounded, expiring, user-bound and consumed once', () => {
  let clock = 100;
  let nextId = 0;
  const offers = createAiFallbackOffers({ now: () => clock, makeId: () => `opaque-${++nextId}`, ttlMs: 50, maxOffers: 2 });
  offers.invalidateUser('42');
  const generation = offers.currentGeneration('42');
  const original = { telegramId: '42', text: 'find jazz', history: [{ role: 'user' as const, text: 'earlier' }] };
  const first = offers.create(original, 'secret-provider-ticket', '42', '42', generation);
  assert.ok(first);
  assert.ok(first.startsWith(AI_FALLBACK_OFFER_PREFIX));
  assert.ok(first.length <= 64);
  assert.equal(first.includes('secret-provider-ticket'), false);
  assert.equal(offers.consume(first, '99', '99'), null);
  assert.equal(offers.consume(first, '42', 'group-1'), null);
  assert.deepEqual(offers.consume(first, '42', '42')?.input, original);
  assert.equal(offers.consume(first, '42', '42'), null);

  const expired = offers.create(original, 'ticket-2', '42', '42', generation);
  assert.ok(expired);
  clock += 50;
  assert.equal(offers.consume(expired, '42', '42'), null);

  const replacedA = offers.create(original, 'ticket-3', '42', '42', generation);
  const replacedB = offers.create(original, 'ticket-4', '42', '42', generation);
  const replacement = offers.create(original, 'ticket-5', '42', '42', generation);
  assert.equal(offers.consume(replacedA!, '42', '42'), null); // bounded eviction
  offers.invalidateUser('42');
  assert.equal(offers.consume(replacedB!, '42', '42'), null);
  assert.equal(offers.consume(replacement!, '42', '42'), null);
  assert.equal(offers.size(), 0);
});

test('fallback network retry starts only after consuming the explicit callback offer', async () => {
  const initial = stubFetch({ ok: true, body: {
    reply: 'GPT is unavailable', stations: [], serviceLinks: [], sources: [],
    provider: { name: 'gpt-6-luna', fallback: false },
    providerFallback: { token: 'provider-ticket', reason: 'unavailable', provider: 'deepseek' }
  } });
  const fallback = stubFetch({ ok: true, body: {
    reply: 'DeepSeek answer', stations: [], serviceLinks: [], sources: [],
    provider: { name: 'deepseek', fallback: true }
  } });
  const offers = createAiFallbackOffers({ now: () => 0, makeId: () => 'click-1' });
  const original = { telegramId: '42', text: 'find calm jazz', history: [{ role: 'user' as const, text: 'earlier' }] };
  const first = await requestAiChat(original, deps(initial.fetch));
  assert.equal(initial.calls.length, 1);
  offers.invalidateUser('42');
  const generation = offers.currentGeneration('42');
  let warningDelivered = false;
  const callbackData = await deliverAiFallbackOffer({
    offers, input: original, token: first?.providerFallback?.token || '',
    userId: '42', chatId: '42', generation,
    deliver: async (data) => { warningDelivered = true; assert.ok(data.startsWith(AI_FALLBACK_OFFER_PREFIX)); }
  });
  assert.ok(callbackData);
  // The callback helper is the path used by index.ts after Telegram delivers
  // the warning. No retry is possible before that explicit callback.
  assert.equal(fallback.calls.length, 0);
  const forged = await runAiFallbackCallback({
    offers, callbackData: `${AI_FALLBACK_OFFER_PREFIX}forged`, userId: '42', chatId: '42',
    beforeRequest: async () => true,
    request: (input) => requestAiChat(input, deps(fallback.fetch))
  });
  const foreignUser = await runAiFallbackCallback({
    offers, callbackData, userId: '99', chatId: '99',
    beforeRequest: async () => true,
    request: (input) => requestAiChat(input, deps(fallback.fetch))
  });
  assert.equal(forged, null);
  assert.equal(foreignUser, null);
  assert.equal(fallback.calls.length, 0);
  const outcome = await runAiFallbackCallback({
    offers, callbackData, userId: '42', chatId: '42',
    beforeRequest: async () => warningDelivered,
    request: (input) => requestAiChat(input, deps(fallback.fetch))
  });
  assert.equal(fallback.calls.length, 1);
  assert.deepEqual(JSON.parse(fallback.calls[0]?.init?.body), {
    telegramId: '42', text: 'find calm jazz', history: original.history, fallbackToken: 'provider-ticket'
  });
  assert.equal(outcome?.result?.provider?.fallback, true);
  const replay = await runAiFallbackCallback({
    offers, callbackData, userId: '42', chatId: '42',
    beforeRequest: async () => true,
    request: (input) => requestAiChat(input, deps(fallback.fetch))
  });
  assert.equal(replay, null);
  assert.equal(fallback.calls.length, 1);
});

test('failed warning delivery removes the offer, and a newer message/reset invalidates in-flight offers', async () => {
  let nextId = 0;
  const offers = createAiFallbackOffers({ now: () => 1, makeId: () => `id-${++nextId}` });
  const input = { telegramId: '5', text: 'find ambient', history: [] };
  offers.invalidateUser('5');
  const firstGeneration = offers.currentGeneration('5');
  let callbackData = '';
  await assert.rejects(() => deliverAiFallbackOffer({
    offers, input, token: 'ticket-a', userId: '5', chatId: '5', generation: firstGeneration,
    deliver: async (data) => { callbackData = data; throw new Error('telegram unavailable'); }
  }));
  assert.equal(offers.consume(callbackData, '5', '5'), null);

  // A text update or /reset advances the same per-user epoch used by pending
  // initial replies and callbacks, so a late GPT result cannot recreate an offer.
  offers.invalidateUser('5');
  const secondGeneration = offers.currentGeneration('5');
  offers.invalidateUser('5');
  assert.equal(offers.isCurrent('5', secondGeneration), false);
  assert.equal(offers.create(input, 'late-ticket', '5', '5', secondGeneration), null);
});

test('a message arriving while callback acknowledgement is pending prevents the retry call', async () => {
  let nextId = 0;
  const offers = createAiFallbackOffers({ now: () => 1, makeId: () => `race-${++nextId}` });
  offers.invalidateUser('8');
  const generation = offers.currentGeneration('8');
  const callbackData = offers.create({ telegramId: '8', text: 'find jazz' }, 'ticket', '8', '8', generation);
  assert.ok(callbackData);
  let calls = 0;
  const outcome = await runAiFallbackCallback({
    offers, callbackData, userId: '8', chatId: '8',
    beforeRequest: async () => { offers.invalidateUser('8'); return true; },
    request: async () => { calls += 1; return null; }
  });
  assert.equal(outcome, null);
  assert.equal(calls, 0);
});

test('bot records only successfully delivered replies from the current user generation', async () => {
  let current = true;
  const records: string[] = [];
  await assert.rejects(() => deliverAiChatReply({
    isCurrent: () => current,
    deliver: async () => { throw new Error('Telegram rejected HTML'); },
    recordDeliveredReply: () => records.push('failed')
  }));
  assert.equal(records.length, 0);

  await deliverAiChatReply({
    isCurrent: () => current,
    deliver: async () => { current = false; },
    recordDeliveredReply: () => records.push('stale')
  });
  assert.equal(records.length, 0);

  current = true;
  const delivered = await deliverAiChatReply({
    isCurrent: () => current,
    deliver: async () => {},
    recordDeliveredReply: () => records.push('delivered')
  });
  assert.equal(delivered, true);
  assert.deepEqual(records, ['delivered']);
});

test('requestAiChat retries POST on final URL when canonical host redirect turns POST into GET', async () => {
  const calls: Array<{ url: string; init: any }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: any) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    if (calls.length === 1) {
      return {
        ok: false,
        status: 404,
        redirected: true,
        url: 'https://radioatlas.ru/api/internal/bot/ai-chat',
        json: async () => ({ error: 'not found' })
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      redirected: false,
      url,
      json: async () => ({ reply: 'На связи', stations: [], serviceLinks: [], sources: [] })
    } as Response;
  }) as typeof fetch;

  const result = await requestAiChat(
    { telegramId: 1, text: 'алло' },
    {
      fetch: fetchImpl,
      apiUrl: 'https://radioatlas.duckdns.org/api',
      internalWebhookToken: 'secret-token'
    }
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.url, 'https://radioatlas.ru/api/internal/bot/ai-chat');
  assert.equal(calls[1]?.init?.method, 'POST');
  assert.equal(JSON.parse(calls[1]?.init?.body).text, 'алло');
  assert.equal(result?.reply, 'На связи');
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
    ],
    sources: []
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
    serviceLinks: [],
    sources: []
  };
  assert.deepEqual(buildAiButtons(result, ''), []);
});

test('buildAiButtons with no stations and no links → empty keyboard', () => {
  assert.deepEqual(buildAiButtons({ reply: 'r', stations: [], serviceLinks: [], sources: [] }, 'validuser'), []);
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
