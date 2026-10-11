import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPrimaryProviderController,
  FallbackTicketStore
} from '../src/ai/providerController.js';
import type { AssistantRuntime } from '../src/aiRoutes.js';
import type { ChatInput, ChatResult } from '../src/ai/types.js';

const input: ChatInput = {
  userMessage: 'Найди джаз', surface: 'miniapp', locale: 'ru',
  history: [{ role: 'user', text: 'Привет' }]
};
const result = (extra: Partial<ChatResult> = {}): ChatResult => ({
  reply: 'Готово', stations: [], serviceLinks: [], sources: [], actions: [], ...extra
});
const runtime = (chat: AssistantRuntime['chat']): AssistantRuntime => ({ chat, checkRateLimit: () => null });

test('GPT result is primary; only an explicit ticket retry invokes DeepSeek once', async () => {
  let gptCalls = 0;
  let deepseekCalls = 0;
  const controller = createPrimaryProviderController({
    gptRuntime: runtime(async () => {
      gptCalls += 1;
      return result({ modelErrors: ['network'], usage: { prompt: 10, completion: 4 } });
    }),
    deepseekRuntime: runtime(async () => { deepseekCalls += 1; return result({ reply: 'Ответ DeepSeek' }); })
  });
  const initial = await controller.chat(input);
  assert.equal(gptCalls, 1);
  assert.equal(deepseekCalls, 0);
  assert.match(initial.reply, /GPT-6 Luna сейчас недоступна/);
  assert.deepEqual(initial.stations, []);
  assert.deepEqual(initial.serviceLinks, []);
  assert.deepEqual(initial.actions, []);
  assert.deepEqual(initial.modelErrors, ['network']);
  assert.deepEqual(initial.usage, { prompt: 10, completion: 4 });
  assert.equal(initial.provider?.name, 'gpt-6-luna');
  assert.equal(initial.providerFallback?.provider, 'deepseek');
  assert.equal(initial.providerFallback?.reason, 'unavailable');

  const retried = await controller.chat(input, { fallbackToken: initial.providerFallback!.token });
  assert.equal(deepseekCalls, 1);
  assert.equal(retried.reply, 'Ответ DeepSeek');
  assert.deepEqual(retried.provider, { name: 'deepseek', fallback: true });
  await controller.chat(input, { fallbackToken: initial.providerFallback!.token });
  assert.equal(deepseekCalls, 1, 'replay cannot call DeepSeek');
});

test('budget exhaustion has a distinct consent reason; empty catalogue and safety results do not switch', async () => {
  const budget = createPrimaryProviderController({
    gptRuntime: runtime(async () => result({ modelErrors: ['budget'] })),
    deepseekRuntime: runtime(async () => result())
  });
  assert.equal((await budget.chat(input)).providerFallback?.reason, 'budget');

  let deepseekCalls = 0;
  const healthyEmpty = createPrimaryProviderController({
    gptRuntime: runtime(async () => result({ reply: 'Каталог пуст.' })),
    deepseekRuntime: runtime(async () => { deepseekCalls += 1; return result(); })
  });
  const response = await healthyEmpty.chat(input);
  assert.equal(response.reply, 'Каталог пуст.');
  assert.equal(response.providerFallback, undefined);
  assert.equal(deepseekCalls, 0);

  const invalidRequest = createPrimaryProviderController({
    gptRuntime: runtime(async () => result({ modelErrors: ['http'] })),
    deepseekRuntime: runtime(async () => { deepseekCalls += 1; return result(); })
  });
  assert.equal((await invalidRequest.chat(input)).providerFallback, undefined);
  assert.equal(deepseekCalls, 0, 'ambiguous HTTP/client failures are not treated as provider outages');
});

test('tickets expire, bind exact request content and Telegram identity, and are one use', () => {
  let now = 100;
  const tickets = new FallbackTicketStore(() => now);
  const token = tickets.issue(input, '123456789', 'unavailable');
  assert.ok(token);
  assert.equal(token!.length, 43);
  assert.equal(tickets.consume(token!, { ...input, userMessage: 'different' }, '123456789'), false);
  assert.equal(tickets.consume(token!, input, '123456788'), false);
  assert.equal(tickets.consume(token!, input, '123456789'), true);
  assert.equal(tickets.consume(token!, input, '123456789'), false);

  const expired = tickets.issue(input, 'id', 'budget');
  assert.ok(expired);
  now += 10 * 60_000;
  assert.equal(tickets.consume(expired!, input, 'id'), false);
});

test('missing DeepSeek never issues a consent token or makes an implicit provider call', async () => {
  let gptCalls = 0;
  const controller = createPrimaryProviderController({
    gptRuntime: runtime(async () => { gptCalls += 1; return result({ modelErrors: ['provider_unavailable'] }); }),
    deepseekRuntime: null
  });
  const response = await controller.chat(input);
  assert.equal(gptCalls, 1);
  assert.equal(response.providerFallback, undefined);
  assert.doesNotMatch(response.reply, /DeepSeek/);
  assert.deepEqual(response.stations, []);
  assert.deepEqual(response.actions, []);
});

test('unexpected GPT runtime exceptions propagate and do not trigger DeepSeek', async () => {
  let deepseekCalls = 0;
  const controller = createPrimaryProviderController({
    gptRuntime: runtime(async () => { throw new Error('catalog bug'); }),
    deepseekRuntime: runtime(async () => { deepseekCalls += 1; return result(); })
  });
  await assert.rejects(controller.chat(input), /catalog bug/);
  assert.equal(deepseekCalls, 0);
});
