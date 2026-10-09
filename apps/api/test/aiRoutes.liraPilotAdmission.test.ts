import assert from 'node:assert/strict';
import test from 'node:test';
import { createAssistantRuntime, createAssistantRuntimeAdmission } from '../src/aiRoutes.js';

test('default and pilot runtimes share one rolling-volume admission cap', async () => {
  let clock = 0;
  const admission = createAssistantRuntimeAdmission({ maxChatsPerWindow: 1, now: () => clock });
  const catalog = {
    getCatalog: async () => [],
    getStationById: async () => null,
    getSummary: async () => ({ trending: [] }),
    search: async () => ({ items: [] })
  } as any;
  const build = () => createAssistantRuntime({
    catalog,
    model: {
      provider: 'openai', enabled: false, apiKey: '', baseUrl: 'http://127.0.0.1:8399/openai',
      model: 'gpt-6-luna', maxOutputTokens: 1000, timeoutSec: 1, reasoningEffort: 'low'
    },
    musicServices: [], admission, now: () => clock
  });
  const defaultRuntime = build();
  const pilotRuntime = build();
  const request = { ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } } as any;
  for (let i = 0; i < 30; i += 1) assert.equal(defaultRuntime.checkRateLimit(request), null);
  assert.equal(pilotRuntime.checkRateLimit(request), 60, 'HTTP admission state is shared too');

  const first = await defaultRuntime.chat({ userMessage: 'hi', surface: 'telegram', locale: 'ru' });
  const second = await pilotRuntime.chat({ userMessage: 'hi again', surface: 'telegram', locale: 'ru' });
  assert.ok(first.agentRun, 'first runtime passes through shared admission');
  assert.equal(second.agentRun, undefined, 'second runtime is capped by the same admission');

  clock += 60_000;
  const afterWindow = await pilotRuntime.chat({ userMessage: 'after reset', surface: 'telegram', locale: 'ru' });
  assert.ok(afterWindow.agentRun, 'shared cap rolls over once for both runtimes');
});
