import assert from 'node:assert/strict';
import test from 'node:test';
import type express from 'express';
import { ProtectedMediaRoute } from '../src/media/protection.js';
import { createAssistantRuntime } from '../src/aiRoutes.js';
import { ALL_MUSIC_SERVICES } from '../src/ai/musicLinks.js';
import type { ChatInput, DeepseekConfig } from '../src/ai/types.js';

// --- 1. XFF / cost-bypass guard --------------------------------------------
// The ai-chat fix keys the rate limit on req.ip (the trusted single hop behind
// Caddy's `trust proxy`) instead of the spoofable X-Forwarded-For. Media routes
// must keep the forwarded-first behaviour.
const fakeReq = (ip: string, xff: string): express.Request =>
  ({ ip, socket: { remoteAddress: ip }, headers: { 'x-forwarded-for': xff } }) as unknown as express.Request;

test('ai-chat rate limit keys on req.ip — a rotated X-Forwarded-For cannot mint a fresh bucket', () => {
  const guard = new ProtectedMediaRoute({
    routeName: 'ai-chat',
    rateLimitPerWindow: 1,
    maxConcurrency: 4,
    sharedMaxConcurrency: 8,
    rateLimitWindowMs: 60_000
  });
  // Same real hop (req.ip), DIFFERENT spoofed X-Forwarded-For each time.
  const first = guard.checkRateLimit(fakeReq('1.1.1.1', '9.9.9.9'));
  const second = guard.checkRateLimit(fakeReq('1.1.1.1', '8.8.8.8'));
  assert.equal(first, null); // first request in the bucket
  assert.notEqual(second, null); // SAME bucket → limited, despite the new XFF
});

test('media (image) rate limit still keys on X-Forwarded-For (behaviour unchanged)', () => {
  const guard = new ProtectedMediaRoute({
    routeName: 'image',
    rateLimitPerWindow: 1,
    maxConcurrency: 4,
    sharedMaxConcurrency: 8,
    rateLimitWindowMs: 60_000
  });
  const first = guard.checkRateLimit(fakeReq('1.1.1.1', '9.9.9.9'));
  const second = guard.checkRateLimit(fakeReq('1.1.1.1', '8.8.8.8'));
  assert.equal(first, null); // bucket 9.9.9.9
  assert.equal(second, null); // bucket 8.8.8.8 → different bucket, not limited
});

// --- 3. Cost-guard wiring on the runtime -----------------------------------
const stubCatalog = {
  search: async () => ({ items: [] }),
  getStationById: async () => null,
  getSummary: async () => ({ moodRails: [], trending: [] })
};

const deepseek = (over: Partial<DeepseekConfig> = {}): DeepseekConfig => ({
  enabled: true,
  apiKey: 'test-key',
  baseUrl: 'http://deepseek.test',
  model: 'deepseek-v4-flash',
  maxOutputTokens: 1000,
  timeoutSec: 30,
  ...over
});

const ask = (text: string): ChatInput => ({ userMessage: text, surface: 'miniapp' });

const okResponse = (content: string) =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })
  }) as unknown as Response;

test('cost guard: over the rolling volume cap → warm fallback with ZERO DeepSeek calls', async () => {
  let calls = 0;
  const spyFetch = (async () => {
    calls += 1;
    return okResponse('Тёплый ответ про музыку.');
  }) as unknown as typeof fetch;
  const runtime = createAssistantRuntime({
    catalog: stubCatalog,
    deepseek: deepseek(),
    musicServices: ALL_MUSIC_SERVICES,
    fetch: spyFetch,
    maxChatsPerWindow: 1,
    now: () => 1
  });

  const first = await runtime.chat(ask('что думаешь о джазе?'));
  assert.ok(first.reply.length > 0);
  assert.equal(calls, 1); // DeepSeek was called once

  const capped = await runtime.chat(ask('а ещё что посоветуешь?'));
  assert.ok(capped.reply.length > 0); // still a warm reply
  assert.equal(capped.actions[0]?.kind, 'none'); // fallback shape
  assert.equal(calls, 1); // capped → NO extra DeepSeek call
});

test('cost guard: a concurrency overload degrades to a warm fallback (never throws)', async () => {
  const resolvers: Array<() => void> = [];
  const spyFetch = (async () =>
    new Promise<Response>((resolve) => {
      resolvers.push(() => resolve(okResponse('ok')));
    })) as unknown as typeof fetch;
  const runtime = createAssistantRuntime({
    catalog: stubCatalog,
    deepseek: deepseek(),
    musicServices: ALL_MUSIC_SERVICES,
    fetch: spyFetch,
    maxChatsPerWindow: 100,
    now: () => 1
  });

  // Saturate the route's maxConcurrency (4) with pending chats (fetch parked).
  const pending = ['a', 'b', 'c', 'd'].map((t) => runtime.chat(ask(t)));
  await new Promise((r) => setImmediate(r));

  // The 5th overloads the guard → must resolve to a warm fallback, not reject.
  const overloaded = await runtime.chat(ask('e'));
  assert.ok(overloaded.reply.length > 0);
  assert.equal(overloaded.actions[0]?.kind, 'none');

  // Drain the parked fetches so the pending chats finish and timers clear.
  resolvers.forEach((fn) => fn());
  await Promise.all(pending);
});
