import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_FALLBACK_TEXT,
  buildAiButtons,
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
      json: async () => response.body ?? {}
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
