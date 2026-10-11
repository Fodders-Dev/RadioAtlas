import assert from 'node:assert/strict';
import test from 'node:test';
import type express from 'express';
import { registerBotRoutes } from '../src/botRoutes.js';
import { createPrimaryProviderController } from '../src/ai/providerController.js';
import type { AssistantRuntime } from '../src/aiRoutes.js';
import type { ChatResult } from '../src/ai/types.js';

const chatResult = (reply: string, modelErrors?: ChatResult['modelErrors']): ChatResult => ({
  reply, stations: [], serviceLinks: [], sources: [], actions: [], ...(modelErrors ? { modelErrors } : {})
});
const runtime = (chat: AssistantRuntime['chat']): AssistantRuntime => ({ chat, checkRateLimit: () => null });

test('internal bot route returns GPT consent ticket and requires explicit retry for DeepSeek', async () => {
  let handler: ((req: express.Request, res: express.Response) => unknown) | undefined;
  let gptCalls = 0;
  let deepseekCalls = 0;
  const app = {
    post: (path: string, candidate: (req: express.Request, res: express.Response) => unknown) => {
      if (path === '/internal/bot/ai-chat') handler = candidate;
    },
    get: () => {}
  } as unknown as express.Express;
  const primaryProviderController = createPrimaryProviderController({
    gptRuntime: runtime(async () => { gptCalls += 1; return chatResult('failed', ['provider_unavailable']); }),
    deepseekRuntime: runtime(async (input) => {
      deepseekCalls += 1;
      assert.equal(input.userMessage, 'Найди джаз');
      assert.deepEqual(input.history, [{ role: 'user', text: 'Привет' }]);
      return chatResult('ответ');
    })
  });
  registerBotRoutes(app, { internalWebhookToken: 'token', primaryProviderController });
  assert.ok(handler);
  let responseBody: any;
  const res = {
    status() { return this; },
    json(body: unknown) { responseBody = body; return this; }
  } as unknown as express.Response;
  const body = { text: 'Найди джаз', history: [{ role: 'user', text: 'Привет' }] };
  const invoke = (requestBody: unknown) => handler!({
    body: requestBody,
    header: (name: string) => name === 'x-internal-token' ? 'token' : undefined
  } as unknown as express.Request, res);

  await invoke(body);
  assert.equal(gptCalls, 1);
  assert.equal(deepseekCalls, 0);
  assert.deepEqual(responseBody.stations, []);
  assert.deepEqual(responseBody.provider, { name: 'gpt-6-luna', fallback: false });
  const token = responseBody.providerFallback.token as string;

  await invoke({ ...body, fallbackToken: token });
  assert.equal(gptCalls, 1);
  assert.equal(deepseekCalls, 1);
  assert.deepEqual(responseBody.provider, { name: 'deepseek', fallback: true });
  assert.equal(responseBody.providerFallback, undefined);
});
