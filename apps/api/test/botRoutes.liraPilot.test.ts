import assert from 'node:assert/strict';
import test from 'node:test';
import type express from 'express';
import { registerBotRoutes, selectBotAssistantRuntime } from '../src/botRoutes.js';
import type { AssistantRuntime } from '../src/aiRoutes.js';

const runtime = (chat: AssistantRuntime['chat']): AssistantRuntime => ({
  chat,
  checkRateLimit: () => null
});

test('only the configured numeric Telegram owner receives the Luna pilot runtime', () => {
  const fallback = runtime(async () => { throw new Error('default should not be called'); });
  const pilot = runtime(async () => { throw new Error('pilot should not be called'); });
  const configured = {
    pilotTelegramId: '123456789',
    defaultRuntime: fallback,
    pilotRuntime: pilot
  };

  assert.equal(selectBotAssistantRuntime({ ...configured, telegramId: '123456789' }), pilot);
  assert.equal(selectBotAssistantRuntime({ ...configured, telegramId: '123456790' }), fallback);
  assert.equal(selectBotAssistantRuntime({ ...configured, telegramId: '' }), fallback);
  assert.equal(selectBotAssistantRuntime({ ...configured, telegramId: '@sonicsuperhedgehog' }), fallback);
  assert.equal(selectBotAssistantRuntime({ ...configured, telegramId: '123456789x' }), fallback);
  assert.equal(selectBotAssistantRuntime({
    telegramId: '123456789', pilotTelegramId: '123456789', defaultRuntime: fallback
  }), null);
});

test('internal bot chat rejects a bad token before either runtime can run', async () => {
  let chatCalls = 0;
  let handler: ((req: express.Request, res: express.Response) => unknown) | undefined;
  const app = {
    post: (path: string, candidate: (req: express.Request, res: express.Response) => unknown) => {
      if (path === '/internal/bot/ai-chat') handler = candidate;
    },
    get: () => {}
  } as unknown as express.Express;
  const unusedRuntime = runtime(async () => {
    chatCalls += 1;
    throw new Error('must not call');
  });
  registerBotRoutes(app, {
    internalWebhookToken: 'expected-token',
    aiRuntime: unusedRuntime,
    aiLunaPilotRuntime: unusedRuntime,
    aiLunaPilotTelegramId: '123456789'
  });
  assert.ok(handler);

  let statusCode = 200;
  let responseBody: unknown;
  const res = {
    status(code: number) { statusCode = code; return this; },
    json(body: unknown) { responseBody = body; return this; }
  } as unknown as express.Response;
  const req = {
    body: { telegramId: '123456789', text: 'hello' },
    header: () => 'wrong-token'
  } as unknown as express.Request;

  await handler!(req, res);
  assert.equal(statusCode, 401);
  assert.deepEqual(responseBody, { error: 'unauthorized' });
  assert.equal(chatCalls, 0);
});

test('an explicitly configured owner receives a static unavailable reply instead of DeepSeek fallback', async () => {
  let handler: ((req: express.Request, res: express.Response) => unknown) | undefined;
  const app = {
    post: (path: string, candidate: (req: express.Request, res: express.Response) => unknown) => {
      if (path === '/internal/bot/ai-chat') handler = candidate;
    },
    get: () => {}
  } as unknown as express.Express;
  registerBotRoutes(app, {
    internalWebhookToken: 'expected-token',
    aiRuntime: runtime(async () => { throw new Error('must not route owner to default'); }),
    aiLunaPilotTelegramId: '123456789'
  });
  assert.ok(handler);

  let responseBody: any;
  const res = {
    status() { return this; },
    json(body: unknown) { responseBody = body; return this; }
  } as unknown as express.Response;
  const req = {
    body: { telegramId: '123456789', text: 'привет' },
    header: () => 'expected-token'
  } as unknown as express.Request;

  await handler!(req, res);
  assert.match(responseBody.reply, /не переключила запрос на другую модель/);
  assert.deepEqual(responseBody.stations, []);
});
