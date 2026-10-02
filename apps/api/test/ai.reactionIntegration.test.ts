import assert from 'node:assert/strict';
import test from 'node:test';

import { runLiraAgent } from '../src/ai/agentRunner.js';
import type { AssistantDeps, ChatInput, ToolProvider, VerifiedStationRef } from '../src/ai/types.js';

const original = 'Подбери энергичное радио из России, без новостей. Два варианта, не включай.';
const anchorIds = ['anchor-1', 'anchor-2', 'anchor-3', 'anchor-4', 'anchor-5'];
const tagPairs: Record<string, [string, string]> = {
  'Помягче': ['dream pop', 'trip hop'],
  'Хочется рванее': ['drum and bass', 'breakbeat'],
  'Больше энергии': ['hardcore', 'industrial'],
  'Другое направление': ['shoegaze', 'post punk'],
  'Теперь deep house': ['deep house', 'deep house'],
  'и?': ['drum and bass', 'breakbeat'],
  'Из Японии, три станции, новости можно': ['drum and bass', 'breakbeat'],
  'Подбери мягкий джаз': ['jazz', 'soul']
};

const station = (id: string, tags: string[], country = 'Russia'): VerifiedStationRef => ({
  stationuuid: id,
  name: `Fixture ${id}`,
  country,
  tags,
  favicon: '',
  url_resolved: `https://radio.fixture/${encodeURIComponent(id)}`
});

const plannerPlan = (message: string, continuity: unknown = { mode: 'continue', fromUserTurnId: 'u0' }, intent = 'recommend') => {
  const tags = tagPairs[message] || tagPairs['Хочется рванее']!;
  return JSON.stringify({
    action: 'use_tool', intent, tool: 'search_stations', args: { query: tags[0] },
    ...(continuity === undefined ? {} : { continuity }),
    ...(intent === 'recommend' ? { semanticSearch: { kind: 'hypothesis', tags } } : {})
  });
};

type FixtureConfig = {
  message: string;
  history?: ChatInput['history'];
  continuity?: unknown;
  intent?: string;
  planner?: string;
  plannerStatus?: number;
  originals?: string[];
  onlyNews?: boolean;
  salt?: string;
};

const runFixture = async (config: FixtureConfig) => {
  const message = config.message;
  const history = config.history ?? [
    { role: 'user' as const, text: original },
    { role: 'assistant' as const, text: 'Раньше я предложила неподтверждённые варианты; это не пользовательская просьба.' }
  ];
  const modelMessages: Array<{ phase: 'planner' | 'compose' | 'tag-mapper'; messages: Array<{ role: string; content: string }> }> = [];
  const logs: string[] = [];
  const searches: Array<{ query: string; country?: string; limit?: number; semanticGenre?: string; excludeStationIds?: string[] }> = [];
  const batches: string[][] = [];
  const previous = [
    ...anchorIds.map((id, index) => station(id, ['ambient'], index === 2 ? 'France' : 'Russia')),
    ...(config.originals || []).map(id => station(id, ['deep house']))
  ];
  const tools: ToolProvider = {
    searchStations: async args => {
      searches.push({
        query: args.query,
        country: args.country,
        limit: args.limit,
        semanticGenre: args.semanticGenre,
        excludeStationIds: args.excludeStationIds
      });
      const genre = args.semanticGenre || args.query;
      const localeCountry = args.country || 'Russia';
      if (config.onlyNews) return [
        station(`${genre}-${config.salt || 'fresh'}-news-a`, [genre, 'news'], localeCountry),
        station(`${genre}-${config.salt || 'fresh'}-news-b`, [genre, 'news'], localeCountry)
      ];
      const streamMirror = station(`${genre}-stream-mirror`, [genre], localeCountry);
      streamMirror.url_resolved = previous[1]!.url_resolved;
      const nameMirror = station(`${genre}-name-mirror`, [genre], 'Russia');
      nameMirror.name = previous[3]!.name;
      return [
        station(`${genre}-${config.salt || 'fresh'}-fresh-a`, [genre], localeCountry),
        station(`${genre}-${config.salt || 'fresh'}-fresh-b`, [genre], localeCountry),
        station(`${genre}-${config.salt || 'fresh'}-news`, [genre, 'news'], localeCountry),
        station(`${genre}-foreign`, [genre], 'France'),
        station(anchorIds[0]!, [genre], localeCountry),
        streamMirror,
        nameMirror
      ];
    },
    getStation: async () => null,
    getStationsByIds: async ids => {
      batches.push([...ids]);
      return previous.filter(row => ids.includes(row.stationuuid));
    },
    discoverTrending: async () => []
  };
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      messages?: Array<{ role: string; content: string }>;
    };
    const messages = body.messages || [];
    const isPlanner = messages.some(message => message.role === 'system' && message.content.includes('PLANNER MODE'));
    const isTagMapper = !isPlanner && messages.some(message => message.role === 'system' && message.content.includes('radio genre tag'));
    modelMessages.push({ phase: isPlanner ? 'planner' : isTagMapper ? 'tag-mapper' : 'compose', messages });
    const content = isPlanner
      ? config.planner ?? plannerPlan(message, config.continuity === undefined ? { mode: 'continue', fromUserTurnId: 'u0' } : config.continuity, config.intent)
      : 'Нашла новые станции по этим направлениям.';
    return new Response(JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 12, completion_tokens: 8 }
    }), { status: isPlanner ? config.plannerStatus ?? 200 : 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const deps: AssistantDeps = {
    model: {
      provider: 'deepseek', enabled: true, apiKey: 'fixture-only', baseUrl: 'https://fixture.invalid/v1',
      model: 'fixture', maxOutputTokens: 1000, timeoutSec: 5
    },
    tools,
    musicServices: [],
    fetch: fetchImpl,
    log: message => logs.push(message),
    now: () => 1_800_000_000_000
  };
  const input: ChatInput = {
    userMessage: message,
    history,
    surface: 'miniapp',
    locale: 'ru',
    userTaste: { lastRecommendedStationIds: config.originals ?? anchorIds }
  };
  const result = await runLiraAgent(input, deps);
  return { result, searches, batches, modelMessages, logs };
};

const assertNoPlay = (result: Awaited<ReturnType<typeof runFixture>>['result']) => {
  assert.ok(result.actions.every(action => action.kind !== 'play'), 'selection must not renew old playback permission');
};

test('four free-form reactions keep the USER selection context and return two fresh country-safe directions', async () => {
  for (const reaction of ['Помягче', 'Хочется рванее', 'Больше энергии', 'Другое направление']) {
    const { result, searches, batches, modelMessages } = await runFixture({ message: reaction });
    assert.equal(result.stations.length, 2, reaction);
    assert.deepEqual(result.stations.map(row => row.country), ['Russia', 'Russia'], reaction);
    assert.ok(result.stations.every(row => !row.tags.some(tag => /news/i.test(tag))), reaction);
    const [first, second] = tagPairs[reaction]!;
    assert.deepEqual(result.stations.map(row => row.tags[0]), [first, second], reaction);
    assert.equal(searches.length, 2, reaction);
    assert.ok(searches.every(search => search.country === 'Russia'), reaction);
    assert.equal(batches.length, 1, reaction);
    assert.deepEqual(batches[0], anchorIds, reaction);
    assert.ok((result.agentRun?.toolCalls.length ?? 99) <= 6, reaction);
    assert.equal(result.agentRun?.toolCalls.filter(call => call.name === 'get_stations_by_ids').length, 1, reaction);
    assert.equal(result.agentRun?.toolCalls.filter(call => call.name === 'search_stations').length, 2, reaction);
    assert.ok(!result.stations.some(row => anchorIds.includes(row.stationuuid) || /-(?:stream|name)-mirror$/u.test(row.stationuuid)), reaction);
    assertNoPlay(result);
    const planner = modelMessages.find(call => call.phase === 'planner');
    assert.ok(planner, reaction);
    const record = planner!.messages.find(item => item.role === 'system' && item.content.startsWith('USER REQUEST RECORD'))?.content || '';
    assert.ok(/"id"\s*:\s*"u0"/u.test(record) && record.includes(original), `${reaction}: ${record}`);
    assert.ok(!record.includes('неподтверждённые варианты'), reaction);
  }
  // Tags here are fixed fixture choices; this contract checks that two planner
  // directions survive the server pipeline, not whether a model understands them.
});

test('a music-to-pizza barrier followed by “и?” cannot revive the old selection', async () => {
  const { result, searches, batches } = await runFixture({
    message: 'и?',
    intent: 'chat',
    history: [
      { role: 'user', text: original },
      { role: 'assistant', text: 'Предложила старые варианты.' },
      { role: 'user', text: 'А теперь хочу пиццу.' },
      { role: 'assistant', text: 'Можно заказать маргариту.' }
    ],
    planner: JSON.stringify({ action: 'final', intent: 'chat' })
  });
  assert.deepEqual(result.stations, []);
  assert.deepEqual(result.serviceLinks, []);
  assert.equal(searches.length, 0);
  assert.equal(batches.length, 0);
  assertNoPlay(result);
});

test('explicit decline returns without model, search, repeat batch or playback, even with a country request', async () => {
  for (const message of ['Не подбирай радио.', 'Страну сохрани. Не подбирай радио.']) {
    const { result, searches, batches, modelMessages } = await runFixture({ message });
    assert.deepEqual(result.stations, [], message);
    assert.deepEqual(result.serviceLinks, [], message);
    assert.equal(searches.length, 0, message);
    assert.equal(batches.length, 0, message);
    assert.equal(modelMessages.length, 0, message);
    assertNoPlay(result);
  }
});

test('knowledge intent does not resolve a selection or fetch repeat anchors', async () => {
  const { result, searches, batches } = await runFixture({
    message: 'Что такое drum and bass?',
    intent: 'knowledge',
    planner: JSON.stringify({ action: 'final', intent: 'knowledge', continuity: { mode: 'continue', fromUserTurnId: 'u0' } })
  });
  assert.deepEqual(result.stations, []);
  assert.deepEqual(result.serviceLinks, []);
  assert.equal(searches.length, 0);
  assert.equal(batches.length, 0);
  assertNoPlay(result);
});

test('missing, malformed, out-of-range and intentless plans fail closed without fallback genre mapping', async () => {
  const decisions: Array<{ message: string; planner?: string; plannerStatus?: number }> = [
    { message: 'Хочется рванее', planner: JSON.stringify({ action: 'use_tool', intent: 'recommend', tool: 'search_stations', args: { query: 'drum and bass' }, semanticSearch: { kind: 'hypothesis', tags: ['drum and bass', 'breakbeat'] } }) },
    { message: 'Больше энергии', planner: JSON.stringify({ action: 'use_tool', intent: 'recommend', tool: 'search_stations', args: { query: 'hardcore' }, continuity: { mode: 'maybe', fromUserTurnId: 'u0' }, semanticSearch: { kind: 'hypothesis', tags: ['hardcore', 'industrial'] } }) },
    { message: 'Хочется рванее', planner: JSON.stringify({ action: 'use_tool', intent: 'recommend', tool: 'search_stations', args: { query: 'drum and bass' }, continuity: { mode: 'continue', fromUserTurnId: 'u88' }, semanticSearch: { kind: 'hypothesis', tags: ['drum and bass', 'breakbeat'] } }) },
    { message: 'Хочется рванее', planner: JSON.stringify({ action: 'use_tool', tool: 'search_stations', args: { query: 'drum and bass' }, semanticSearch: { kind: 'hypothesis', tags: ['drum and bass', 'breakbeat'] } }) },
    { message: 'Хочется рванее', planner: '{invalid json' },
    { message: 'Хочется рванее', planner: JSON.stringify({ action: 'final' }) },
    { message: 'Хочется рванее', plannerStatus: 503 }
  ];
  for (const scenario of decisions) {
    const { result, searches, batches, modelMessages } = await runFixture(scenario);
    assert.deepEqual(result.stations, []);
    assert.deepEqual(result.serviceLinks, []);
    assert.equal(searches.length, 0);
    assert.equal(batches.length, 0);
    assert.equal(modelMessages.filter(call => call.phase === 'tag-mapper').length, 0);
    assertNoPlay(result);
  }
});

test('an assistant-only offer is not a selection origin', async () => {
  const { result, searches, batches } = await runFixture({
    message: 'Помягче',
    history: [
      { role: 'user', text: 'Привет!' },
      { role: 'assistant', text: 'Хочешь, я подберу тебе радио?' }
    ],
    planner: plannerPlan('Помягче', { mode: 'continue', fromUserTurnId: 'u0' })
  });
  assert.deepEqual(result.stations, []);
  assert.equal(searches.length, 0);
  assert.equal(batches.length, 0);
  assertNoPlay(result);
});

test('a statement about liking music plus an assistant suggestion is not a selection origin', async () => {
  const { result, searches, batches } = await runFixture({
    message: 'Помягче',
    history: [
      { role: 'user', text: 'Я люблю музыку.' },
      { role: 'assistant', text: 'Могу подобрать радио, например jazz.' }
    ],
    planner: plannerPlan('Помягче', { mode: 'continue', fromUserTurnId: 'u0' })
  });
  assert.deepEqual(result.stations, []);
  assert.equal(searches.length, 0);
  assert.equal(batches.length, 0);
  assertNoPlay(result);
});

test('a pizza request followed by an unsolicited assistant music offer is still a barrier', async () => {
  const { result, searches, batches } = await runFixture({
    message: 'Помягче',
    history: [
      { role: 'user', text: 'Хочу пиццу.' },
      { role: 'assistant', text: 'Могу подобрать радио, например jazz.' }
    ],
    planner: plannerPlan('Помягче', { mode: 'continue', fromUserTurnId: 'u0' })
  });
  assert.deepEqual(result.stations, []);
  assert.deepEqual(result.serviceLinks, []);
  assert.equal(searches.length, 0);
  assert.equal(batches.length, 0);
  assertNoPlay(result);
});

test('old play permission does not carry into a new free-form reaction', async () => {
  const playedBefore = 'Включи энергичное радио из России, без новостей. Два варианта.';
  const { result, searches, batches } = await runFixture({
    message: 'Помягче',
    history: [
      { role: 'user', text: playedBefore },
      { role: 'assistant', text: 'Вот станции.' }
    ]
  });
  assert.equal(result.stations.length, 2);
  assert.ok(searches.length > 0);
  assert.equal(batches.length, 1);
  assertNoPlay(result);
});

test('current country, count and named exclusion release override carried constraints', async () => {
  const { result, searches, batches, logs, modelMessages } = await runFixture({ message: 'Из Японии, три станции, новости можно', onlyNews: true });
  assert.equal(result.stations.length, 3, JSON.stringify({searches,batches,phases:modelMessages.map(call=>call.phase),calls:result.agentRun?.toolCalls,warnings:result.agentRun?.warnings,logs}));
  assert.ok(result.stations.every(row => row.country === 'Japan'));
  assert.ok(result.stations.every(row => row.tags.includes('news')), 'only matching news candidates existed, so their presence proves the release took effect');
  assert.ok(searches.every(search => search.country === 'Japan'));
  assert.equal(batches.length, 1);
  assertNoPlay(result);
});

test('intermediate exclusion release remains cleared on a later continuation', async () => {
  const { result, searches, batches, logs, modelMessages } = await runFixture({
    message: 'и?',
    history: [
      { role: 'user', text: original },
      { role: 'assistant', text: 'Есть варианты.' },
      { role: 'user', text: 'Теперь новости можно.' },
      { role: 'assistant', text: 'Поняла.' }
    ],
    onlyNews: true
  });
  assert.equal(result.stations.length, 2, JSON.stringify({searches,batches,phases:modelMessages.map(call=>call.phase),calls:result.agentRun?.toolCalls,warnings:result.agentRun?.warnings,logs}));
  assert.ok(result.stations.every(row => row.tags.includes('news')), 'only matching news candidates existed, so their presence proves the intermediate release persisted');
  assert.ok(searches.length > 0);
  assert.equal(batches.length, 1);
  assertNoPlay(result);
});

test('original request continues through a free reaction, direct genre refinement and a later “и?”', async () => {
  const softening = await runFixture({
    message: 'Теперь deep house',
    history: [
      { role: 'user', text: original },
      { role: 'assistant', text: 'Нашла первые варианты.' },
      { role: 'user', text: 'Помягче' },
      { role: 'assistant', text: 'Переформулировала направление.' }
    ],
    planner: plannerPlan('Теперь deep house', { mode: 'continue', fromUserTurnId: 'u0' })
  });
  assert.ok(softening.modelMessages.some(call => call.phase === 'planner'), 'direct genre refinement must be admitted through the existing continuity planner');
  assert.equal(softening.result.stations.length, 2);
  assert.ok(softening.result.stations.every(row => row.country === 'Russia' && row.tags.includes('deep house')));
  assert.ok(softening.result.stations.every(row => !row.tags.includes('news')));
  assert.equal(softening.searches.length, 1);
  assert.equal(softening.searches[0]?.country, 'Russia');
  assert.equal(softening.batches.length, 1);
  assert.deepEqual(softening.batches[0], anchorIds);
  assertNoPlay(softening.result);

  const laterReaction = await runFixture({
    message: 'и?',
    history: [
      { role: 'user', text: original },
      { role: 'assistant', text: 'Нашла первые варианты.' },
      { role: 'user', text: 'Помягче' },
      { role: 'assistant', text: 'Переформулировала направление.' },
      { role: 'user', text: 'Теперь deep house' },
      { role: 'assistant', text: 'Вот две станции.' }
    ],
    continuity: { mode: 'continue', fromUserTurnId: 'u0' },
    planner: JSON.stringify({
      action: 'use_tool', intent: 'recommend', tool: 'search_stations', args: { query: 'deep house' },
      continuity: { mode: 'continue', fromUserTurnId: 'u0' },
      semanticSearch: { kind: 'hypothesis', tags: ['deep house'] }
    }),
    originals: softening.result.stations.map(row => row.stationuuid),
    salt: 'later'
  });
  assert.equal(laterReaction.result.stations.length, 2);
  assert.ok(laterReaction.result.stations.every(row => row.country === 'Russia' && row.tags.includes('deep house')));
  assert.ok(laterReaction.result.stations.every(row => !row.tags.includes('news')));
  assert.ok(laterReaction.result.stations.every(row => !softening.result.stations.some(old => old.stationuuid === row.stationuuid)));
  assert.equal(laterReaction.searches.length, 1);
  assert.equal(laterReaction.searches[0]?.country, 'Russia');
  assert.equal(laterReaction.batches.length, 1);
  assert.deepEqual(laterReaction.batches[0], softening.result.stations.map(row => row.stationuuid));
  assertNoPlay(laterReaction.result);
});

test('malformed continuity on a direct genre refinement does not enter deterministic search', async () => {
  const { result, searches, batches, modelMessages } = await runFixture({
    message: 'Теперь deep house',
    history: [
      { role: 'user', text: original },
      { role: 'assistant', text: 'Нашла первые варианты.' },
      { role: 'user', text: 'Помягче' },
      { role: 'assistant', text: 'Переформулировала направление.' }
    ],
    planner: JSON.stringify({
      action: 'use_tool', intent: 'recommend', tool: 'search_stations', args: { query: 'deep house' },
      continuity: { mode: 'continue', fromUserTurnId: 'u88' },
      semanticSearch: { kind: 'genre', tags: ['deep house'] }
    })
  });
  assert.ok(modelMessages.some(call => call.phase === 'planner'));
  assert.deepEqual(result.stations, []);
  assert.deepEqual(result.serviceLinks, []);
  assert.equal(searches.length, 0);
  assert.equal(batches.length, 0);
  assertNoPlay(result);
});

test('an explicit new music request discards prior country, count and exclusions', async () => {
  const { result, searches, batches } = await runFixture({
    message: 'Подбери мягкий джаз',
    continuity: { mode: 'new' }
  });
  assert.ok(result.stations.length > 2);
  assert.ok(searches.every(search => search.country === undefined));
  assert.ok(result.stations.some(row => row.tags.includes('news')), 'old no-news constraint does not cross into a new selection');
  assert.equal(batches.length, 0, 'a new selection does not trigger repeat discovery');
  assertNoPlay(result);
});
