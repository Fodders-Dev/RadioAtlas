import assert from 'node:assert/strict';
import test from 'node:test';
import type express from 'express';
import { createAiTicketIdentityResolver, registerAiRoutes } from '../src/aiRoutes.js';
import { createPrimaryProviderController } from '../src/ai/providerController.js';
import type { AssistantRuntime } from '../src/aiRoutes.js';
import type { ChatResult } from '../src/ai/types.js';

const chatResult = (reply: string, modelErrors?: ChatResult['modelErrors']): ChatResult => ({
  reply, stations: [], serviceLinks: [], sources: [], actions: [], ...(modelErrors ? { modelErrors } : {})
});
const runtime = (chat: AssistantRuntime['chat']): AssistantRuntime => ({ chat, checkRateLimit: () => null });

test('/ai/chat sends GPT failure consent metadata and dispatches only the immutable retry to DeepSeek', async () => {
  let handler: ((req: express.Request, res: express.Response) => unknown) | undefined;
  let gptCalls = 0;
  let deepseekCalls = 0;
  const app = {
    post: (path: string, candidate: (req: express.Request, res: express.Response) => unknown) => {
      if (path === '/ai/chat') handler = candidate;
    }
  } as unknown as express.Express;
  const primaryProviderController = createPrimaryProviderController({
    gptRuntime: runtime(async () => { gptCalls += 1; return chatResult('failed', ['network']); }),
    deepseekRuntime: runtime(async (input) => {
      deepseekCalls += 1;
      assert.equal(input.userMessage, 'Найди джаз');
      assert.equal(input.history?.length, 1);
      return chatResult('готово');
    })
  });
  const resolveTicketIdentity = createAiTicketIdentityResolver(async (token) =>
    token === 'session-a' || token === 'session-b' ? { id: 'same-account' } : null
  );
  registerAiRoutes(app, { primaryProviderController, resolveTicketIdentity });
  assert.ok(handler);

  let responseBody: any;
  const res = {
    setHeader() { return this; },
    status() { return this; },
    json(body: unknown) { responseBody = body; return this; }
  } as unknown as express.Response;
  const body = { message: 'Найди джаз', locale: 'ru', accountId: 'untrusted-client-id', history: [{ role: 'user', text: 'Привет' }] };
  const invoke = (requestBody: unknown, authorization = 'Bearer session-a') => handler!({
    body: requestBody, headers: { authorization }, ip: '203.0.113.8', socket: { remoteAddress: '127.0.0.1' }
  } as unknown as express.Request, res);
  await invoke(body);
  assert.equal(gptCalls, 1);
  assert.equal(deepseekCalls, 0);
  assert.deepEqual(responseBody.stations, []);
  assert.deepEqual(responseBody.actions, []);
  assert.deepEqual(responseBody.provider, { name: 'gpt-6-luna', fallback: false });
  const token = responseBody.providerFallback.token as string;
  assert.equal(token.length, 43);

  await invoke({ ...body, message: 'другой запрос', fallbackToken: token });
  assert.equal(deepseekCalls, 0, 'a payload mismatch cannot call DeepSeek');
  assert.equal(responseBody.providerFallback, undefined);

  await invoke({ ...body, fallbackToken: token }, 'Bearer session-b');
  assert.equal(deepseekCalls, 0, 'a second valid session for the same account cannot consume this ticket');
  assert.equal(responseBody.providerFallback, undefined);

  await invoke({ ...body, fallbackToken: token });
  assert.equal(gptCalls, 1);
  assert.equal(deepseekCalls, 1);
  assert.deepEqual(responseBody.provider, { name: 'deepseek', fallback: true });
  assert.equal(responseBody.providerFallback, undefined);
});

test('ticket identity uses verified account sessions or stable anonymous transport affinity, never body IDs', async () => {
  const resolveTicketIdentity = createAiTicketIdentityResolver(async (token) =>
    token.startsWith('valid-') ? { id: 'account-1' } : null
  );
  const request = (token?: string, ip = '203.0.113.10') => ({
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'user-agent': 'RadioAtlas/1' },
    ip, socket: { remoteAddress: '127.0.0.1' }, body: { accountId: 'untrusted' }
  } as unknown as express.Request);

  const firstSession = await resolveTicketIdentity(request('valid-session-a'));
  const secondSession = await resolveTicketIdentity(request('valid-session-b'));
  assert.notEqual(firstSession, secondSession);
  assert.match(firstSession, /^account:account-1:session:[a-f0-9]{64}$/);

  const anonymous = await resolveTicketIdentity(request('invalid-session'));
  assert.match(anonymous, /^anonymous:[a-f0-9]{64}$/);
  assert.equal(await resolveTicketIdentity(request()), anonymous);
  assert.notEqual(await resolveTicketIdentity(request(undefined, '203.0.113.11')), anonymous);
});
