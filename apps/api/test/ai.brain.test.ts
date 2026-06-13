import assert from 'node:assert/strict';
import test from 'node:test';
import { chatWithAssistant } from '../src/ai/brain.js';
import { ALL_MUSIC_SERVICES } from '../src/ai/musicLinks.js';
import type {
  AssistantDeps,
  ChatInput,
  DeepseekConfig,
  ToolProvider,
  VerifiedStationRef
} from '../src/ai/types.js';

const station = (over: Partial<VerifiedStationRef> = {}): VerifiedStationRef => ({
  stationuuid: 'uuid-jazz',
  name: 'Paris Jazz',
  country: 'France',
  tags: ['jazz'],
  favicon: '',
  url_resolved: 'http://stream/jazz',
  ...over
});

const stubTools: ToolProvider = {
  searchStations: async () => [station()],
  getStation: async (id) => (id === 'uuid-jazz' ? station() : null),
  discoverTrending: async () => [{ id: 'mood-focus', label: 'Фокус', stations: [station({ stationuuid: 'uuid-focus', name: 'Focus Wave' })] }]
};

type StubResponses = {
  planner?: string[]; // one per planner call, in order
  compose?: string;
  composeStatus?: number;
};

const makeFetch = (responses: StubResponses) => {
  const calls: Array<{ phase: 'planner' | 'compose'; body: any }> = [];
  let plannerIndex = 0;
  const fetchImpl = (async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    const isPlanner = body.messages.some(
      (m: any) => m.role === 'system' && typeof m.content === 'string' && m.content.includes('PLANNER MODE')
    );
    calls.push({ phase: isPlanner ? 'planner' : 'compose', body });
    if (isPlanner) {
      const content = responses.planner?.[plannerIndex] ?? '{"action":"final"}';
      plannerIndex += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 5, completion_tokens: 5 } })
      };
    }
    const status = responses.composeStatus ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({
        choices: [{ message: { content: responses.compose ?? 'Тёплый ответ про музыку.' } }],
        usage: { prompt_tokens: 10, completion_tokens: 10 }
      })
    };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
};

const deepseek = (over: Partial<DeepseekConfig> = {}): DeepseekConfig => ({
  enabled: true,
  apiKey: 'test-key',
  baseUrl: 'http://deepseek.test',
  model: 'deepseek-v4-flash',
  maxOutputTokens: 1000,
  timeoutSec: 8,
  ...over
});

const makeDeps = (fetchImpl: typeof fetch, over: Partial<AssistantDeps> = {}): AssistantDeps => ({
  deepseek: deepseek(),
  tools: stubTools,
  musicServices: ALL_MUSIC_SERVICES,
  fetch: fetchImpl,
  log: () => {},
  now: () => 7,
  ...over
});

const ask = (text: string, extra: Partial<ChatInput> = {}): ChatInput => ({
  userMessage: text,
  surface: 'miniapp',
  ...extra
});

test('AI disabled → warm fallback, ZERO DeepSeek calls', async () => {
  const { fetchImpl, calls } = makeFetch({});
  const deps = makeDeps(fetchImpl, { deepseek: deepseek({ enabled: false }) });
  const result = await chatWithAssistant(ask('включи джаз'), deps);
  assert.equal(calls.length, 0);
  assert.ok(result.reply.length > 0);
  assert.deepEqual(result.stations, []);
});

test('smalltalk fast-path skips the planner — exactly one (compose) DeepSeek call', async () => {
  const { fetchImpl, calls } = makeFetch({ compose: 'Обожаю медленный джаз под дождь.' });
  const result = await chatWithAssistant(ask('что думаешь о джазе?'), makeDeps(fetchImpl));
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.phase, 'compose');
  assert.ok(result.reply.includes('джаз'));
  assert.deepEqual(result.stations, []);
});

test('action intent runs the planner → search tool → stations come from observations only', async () => {
  const { fetchImpl, calls } = makeFetch({
    planner: ['{"action":"use_tool","tool":"search_stations","args":{"query":"jazz"}}', '{"action":"final"}'],
    compose: 'Вот тёплая станция под джаз.'
  });
  const result = await chatWithAssistant(ask('посоветуй джазовую станцию'), makeDeps(fetchImpl));
  assert.ok(calls.filter((c) => c.phase === 'planner').length >= 1);
  assert.equal(calls.at(-1)?.phase, 'compose');
  assert.equal(result.stations.length, 1);
  assert.equal(result.stations[0]?.stationuuid, 'uuid-jazz');
  assert.equal(result.actions[0]?.kind, 'open-station');
});

test('explicit play intent marks the lead station for autoplay', async () => {
  const { fetchImpl } = makeFetch({
    planner: ['{"action":"use_tool","tool":"search_stations","args":{"query":"jazz"}}'],
    compose: 'Включаю джаз!'
  });
  const result = await chatWithAssistant(ask('включи мне джаз'), makeDeps(fetchImpl));
  assert.equal(result.actions[0]?.kind, 'play');
  assert.equal(result.actions[0]?.stationuuid, 'uuid-jazz');
});

test('duplicate tool+args is not run twice — the loop breaks on repeat', async () => {
  let searchCount = 0;
  const countingTools: ToolProvider = {
    ...stubTools,
    searchStations: async () => {
      searchCount += 1;
      return [station()];
    }
  };
  const { fetchImpl } = makeFetch({
    // planner keeps asking for the identical call; the loop must stop after one.
    planner: [
      '{"action":"use_tool","tool":"search_stations","args":{"query":"jazz"}}',
      '{"action":"use_tool","tool":"search_stations","args":{"query":"jazz"}}',
      '{"action":"use_tool","tool":"search_stations","args":{"query":"jazz"}}'
    ],
    compose: 'Готово.'
  });
  await chatWithAssistant(ask('найди джаз'), makeDeps(fetchImpl, { tools: countingTools }));
  assert.equal(searchCount, 1);
});

test('a model reply that invents a station yields ZERO station buttons (no observation = no card)', async () => {
  const { fetchImpl } = makeFetch({
    // planner finds nothing (final immediately), compose hallucinates a name.
    planner: ['{"action":"final"}'],
    compose: 'Обязательно включи «Radio Phantom 101.5» — моя любимая!'
  });
  const result = await chatWithAssistant(ask('посоветуй радио'), makeDeps(fetchImpl));
  assert.deepEqual(result.stations, []);
  assert.equal(result.actions[0]?.kind, 'none');
});

test('music_service_search observation → serviceLinks collected and url-encoded', async () => {
  const { fetchImpl } = makeFetch({
    planner: ['{"action":"use_tool","tool":"music_service_search","args":{"query":"Aphex Twin"}}'],
    compose: 'Лови ссылки на Aphex Twin.'
  });
  const result = await chatWithAssistant(ask('найди трек Aphex Twin'), makeDeps(fetchImpl));
  assert.equal(result.serviceLinks.length, 6);
  assert.ok(result.serviceLinks.every((l) => l.url.includes('Aphex%20Twin')));
});

test('compose HTTP error → warm fallback, still carrying verified stations', async () => {
  const { fetchImpl } = makeFetch({
    planner: ['{"action":"use_tool","tool":"search_stations","args":{"query":"jazz"}}'],
    composeStatus: 500
  });
  const result = await chatWithAssistant(ask('посоветуй джаз'), makeDeps(fetchImpl));
  assert.ok(result.reply.length > 0);
  assert.equal(result.stations.length, 1); // fallback keeps the found station
});

test('voice-unsafe compose → warm fallback instead of the off-voice text', async () => {
  const { fetchImpl } = makeFetch({
    planner: ['{"action":"final"}'],
    compose: 'Я ассистент и работаю с каталогом станций.'
  });
  const result = await chatWithAssistant(ask('расскажи о себе'), makeDeps(fetchImpl));
  assert.ok(!/ассистент|каталог/i.test(result.reply));
  assert.ok(result.reply.length > 0);
});
