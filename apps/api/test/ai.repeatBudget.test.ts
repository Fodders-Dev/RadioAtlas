import assert from 'node:assert/strict';
import test from 'node:test';

import { runLiraAgent } from '../src/ai/agentRunner.js';
import { createCatalogToolProvider, type CatalogServiceLike } from '../src/ai/catalogToolProvider.js';
import { createStationExclusionMatcherFromRows } from '../src/ai/stationExclusions.js';
import type { AssistantDeps, ChatInput, VerifiedStationRef } from '../src/ai/types.js';

type Row = {
  stationuuid: string;
  name: string;
  country?: string | null;
  tags?: string | null;
  favicon?: string | null;
  url_resolved?: string | null;
};

const row = (stationuuid: string, name: string, tags: string, url_resolved = `https://radio.test/${stationuuid}`, country = 'Russia'): Row => ({
  stationuuid, name, tags, url_resolved, country, favicon: ''
});

const priorRows = (): Row[] => [
  row('prior-uuid', 'UUID Anchor', 'industrial', 'https://radio.test/uuid'),
  row('prior-stream', 'Stream Anchor', 'industrial', 'https://radio.test/shared?channel=a#old'),
  row('prior-name', 'Turbo Radio AAC', 'industrial', 'https://radio.test/name-anchor', 'NL'),
  row('prior-four', 'Fourth Anchor', 'industrial'),
  row('prior-five', 'Fifth Anchor', 'industrial')
];

const repeatCandidates = (genre: string): Row[] => [
  row('prior-uuid', 'UUID Anchor', genre, 'https://radio.test/uuid'),
  row(`${genre}-stream-mirror`, 'Separate Stream Name', genre, 'https://radio.test/shared?channel=a#new'),
  row(`${genre}-name-mirror`, 'Turbo Radio (128 kbps)', genre, 'https://radio.test/codec-mirror', 'NL')
];

const fetchFixture = (planner: string, requests: string[]) => (async (url, init) => {
  const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: Array<{ role: string; content: string }> };
  const systemText = (body.messages || []).filter(message => message.role === 'system').map(message => message.content).join('\n');
  requests.push(String(url));
  const content = systemText.includes('PLANNER MODE') ? planner : 'Нашла проверенные станции по вашему запросу.';
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 12, completion_tokens: 8 } }), {
    status: 200, headers: { 'content-type': 'application/json' }
  });
}) as typeof fetch;

const dependencies = (tools: AssistantDeps['tools'], planner: string, requests: string[], log: string[] = []): AssistantDeps => ({
  model: {
    provider: 'deepseek', enabled: true, apiKey: 'fixture-only', baseUrl: 'https://fixture.invalid/v1',
    model: 'fixture', maxOutputTokens: 1000, timeoutSec: 5
  },
  tools,
  musicServices: [],
  fetch: fetchFixture(planner, requests),
  log: message => log.push(message),
  now: () => 1_800_000_000_000
});

const request = (message = 'и?'): ChatInput => ({
  userMessage: message,
  history: [
    { role: 'user', text: 'Подбери энергичное радио из России, не включай.' },
    { role: 'assistant', text: 'Вот предыдущие варианты.' }
  ],
  surface: 'miniapp',
  locale: 'ru',
  userTaste: { lastRecommendedStationIds: ['prior-uuid', 'prior-stream', 'prior-name', 'prior-four', 'prior-five'] }
});

const plan = JSON.stringify({
  action: 'use_tool', intent: 'recommend', tool: 'search_stations', args: { query: 'industrial' },
  semanticSearch: { kind: 'hypothesis', tags: ['industrial', 'breakbeat'] }
});

const catalogWith = (allRows: Row[], searches?: string[], fullReads?: number[], singleReads?: string[]): CatalogServiceLike => ({
  search: async filters => {
    searches?.push(`${filters.tag}|${filters.country}`);
    const rows = filters.tag === 'industrial'
      ? [...repeatCandidates('industrial'), row('industrial-fresh', 'Industrial Fresh', 'industrial')]
      : filters.tag === 'breakbeat'
        ? [...repeatCandidates('breakbeat'), row('breakbeat-fresh', 'Breakbeat Fresh', 'breakbeat')]
        : [];
    return { items: rows, nextCursor: null };
  },
  getStationById: async id => {
    singleReads?.push(id);
    return allRows.find(station => station.stationuuid === id) || null;
  },
  getSummary: async () => ({}),
  getCatalog: async () => {
    if (fullReads) fullReads[0] = (fullReads[0] || 0) + 1;
    return allRows;
  }
});

test('catalog batch lookup dedupes, caps at 128, verifies IDs and preserves requested order', async () => {
  const rows = Array.from({ length: 130 }, (_, index) => row(`id-${index}`, `Station ${index}`, 'jazz'));
  rows.push(row('mismatch', 'Unrequested Station', 'jazz'));
  rows.push(row('no-stream', 'No Stream', 'jazz', ''));
  const reads = [0];
  const provider = createCatalogToolProvider(catalogWith(rows, undefined, reads));
  const ids = ['id-127', 'missing', 'id-126', ...Array.from({ length: 125 }, (_, index) => `id-${125 - index}`),
    'id-127', 'no-stream', 'id-128', 'id-129', 'mismatch'];

  const stations = await provider.getStationsByIds!(ids);
  assert.equal(stations.length, 127, 'one missing requested id has no resolved row');
  assert.equal(stations[0]?.stationuuid, 'id-127');
  assert.equal(stations[1]?.stationuuid, 'id-126');
  assert.equal(stations[126]?.stationuuid, 'id-1');
  assert.ok(!stations.some(station => ['id-0', 'id-128', 'id-129', 'mismatch', 'no-stream'].includes(station.stationuuid)));
  assert.equal(reads[0], 1, 'the bounded batch uses exactly one full-catalog read');
  assert.deepEqual(await provider.getStationsByIds!(['no-stream', 'mismatch-request']), []);
  assert.equal(reads[0], 2, 'unknown and unresolved rows are not returned');
  assert.deepEqual(await provider.getStationsByIds!(['', '  ']), []);
  assert.equal(reads[0], 2, 'empty requests do not read the catalog');
});

test('runLiraAgent uses one batch for five anchors so both semantic directions survive', async () => {
  const searches: string[] = [];
  const fullReads = [0];
  const singleReads: string[] = [];
  const modelRequests: string[] = [];
  const catalogRows = [
    ...priorRows(),
    ...repeatCandidates('industrial'),
    row('industrial-fresh', 'Industrial Fresh', 'industrial'),
    row('industrial-extra-1', 'Industrial Extra One', 'industrial'),
    row('industrial-extra-2', 'Industrial Extra Two', 'industrial'),
    row('industrial-extra-3', 'Industrial Extra Three', 'industrial'),
    row('industrial-extra-4', 'Industrial Extra Four', 'industrial'),
    ...repeatCandidates('breakbeat'),
    row('breakbeat-fresh', 'Breakbeat Fresh', 'breakbeat'),
    row('breakbeat-extra-1', 'Breakbeat Extra One', 'breakbeat'),
    row('breakbeat-extra-2', 'Breakbeat Extra Two', 'breakbeat'),
    row('breakbeat-extra-3', 'Breakbeat Extra Three', 'breakbeat'),
    row('breakbeat-extra-4', 'Breakbeat Extra Four', 'breakbeat')
  ];
  const tools = createCatalogToolProvider(catalogWith(catalogRows, searches, fullReads, singleReads));
  let batchFullReads = 0;
  const rawBatch = tools.getStationsByIds!;
  tools.getStationsByIds = async ids => {
    const before = fullReads[0] || 0;
    const result = await rawBatch(ids);
    batchFullReads += (fullReads[0] || 0) - before;
    return result;
  };
  const result = await runLiraAgent(request(), dependencies(tools, plan, modelRequests));

  assert.deepEqual(searches, ['industrial|Russia', 'breakbeat|Russia']);
  assert.equal(fullReads[0], 3, 'two country-scoped searches and one repeat batch read the local catalog');
  assert.equal(batchFullReads, 1, 'the repeat matcher uses exactly one local catalog read');
  assert.ok(result.stations.some(station => station.stationuuid === 'industrial-fresh'));
  assert.ok(result.stations.some(station => station.stationuuid === 'breakbeat-fresh'));
  assert.deepEqual(result.stations.slice(0, 2).map(station => station.tags[0]), ['industrial', 'breakbeat']);
  assert.ok(result.stations.every(station => !['prior-uuid', 'industrial-stream-mirror', 'industrial-name-mirror',
    'breakbeat-stream-mirror', 'breakbeat-name-mirror'].includes(station.stationuuid)));
  assert.equal(result.actions[0]?.kind, 'open-station');
  assert.equal(result.actions[0]?.stationuuid, 'industrial-fresh');
  assert.ok(result.actions.every(action => action.kind !== 'play'), 'the earlier no-play instruction remains in force');
  assert.ok(result.agentRun);
  assert.ok(result.agentRun.toolCalls.length <= 6);
  assert.equal(result.agentRun.warnings.includes('max_tool_calls_reached'), false);
  assert.equal(result.agentRun.toolCalls.filter(call => call.name === 'get_stations_by_ids').length, 1);
  assert.equal(result.agentRun.toolCalls.filter(call => call.name === 'get_station').length, 0);
  assert.equal(result.agentRun.toolCalls.filter(call => call.name === 'search_stations').length, 2);
  assert.equal(singleReads.length, 10, 'provider-side exclusion remains bounded and sequential per search');
  assert.ok(modelRequests.length > 0);
  assert.ok(modelRequests.every(url => url.startsWith('https://fixture.invalid/')));
});

test('a failed batch keeps UUID exclusions and never falls back to serial resolution', async () => {
  let batchCalls = 0;
  let singleCalls = 0;
  const searches: string[] = [];
  const tools: AssistantDeps['tools'] = {
    getStation: async () => { singleCalls += 1; return null; },
    getStationsByIds: async () => { batchCalls += 1; throw new Error('fixture batch failure'); },
    searchStations: async args => {
      searches.push(args.query);
      return [
        { stationuuid: 'prior-uuid', name: 'UUID Anchor', country: 'Russia', tags: [args.query], favicon: '', url_resolved: 'https://radio.test/uuid' },
        { stationuuid: `${args.query}-fresh`, name: `${args.query} Fresh`, country: 'Russia', tags: [args.query], favicon: '', url_resolved: `https://radio.test/${args.query}` }
      ];
    },
    discoverTrending: async () => []
  };
  const result = await runLiraAgent(request(), dependencies(tools, plan, []));

  assert.equal(batchCalls, 1);
  assert.equal(singleCalls, 0, 'failure does not fan out into instrumented get_station calls');
  assert.deepEqual(searches, ['industrial', 'breakbeat']);
  assert.ok(!result.stations.some(station => station.stationuuid === 'prior-uuid'));
  assert.ok(result.stations.some(station => station.stationuuid === 'industrial-fresh'));
  assert.ok(result.stations.some(station => station.stationuuid === 'breakbeat-fresh'));
  assert.ok((result.agentRun?.toolCalls.length ?? 7) <= 6);
  assert.equal(result.agentRun?.toolCalls.filter(call => call.name === 'get_stations_by_ids').length, 1);
  assert.equal(result.agentRun?.toolCalls.filter(call => call.name === 'get_station').length, 0);
});

test('the batch matcher independently rejects same-country codec names and preserves different countries/streams', () => {
  const matcher = createStationExclusionMatcherFromRows(
    ['prior-name', 'prior-stream'],
    [
      { stationuuid: 'prior-name', name: 'Turbo Radio AAC', country: 'NL', url_resolved: 'https://radio.test/name' },
      { stationuuid: 'prior-stream', name: 'Stream Anchor', country: 'RU', url_resolved: 'https://radio.test/live?channel=a#old' },
      { stationuuid: 'unrequested-row', name: 'Unrequested Anchor', country: 'RU', url_resolved: 'https://radio.test/unrequested' }
    ]
  );
  assert.ok(matcher({ stationuuid: 'name-mirror', name: 'Turbo Radio (128 kbps)', country: 'Netherlands', url_resolved: 'https://radio.test/other' }));
  assert.ok(!matcher({ stationuuid: 'foreign-same-name', name: 'Turbo Radio', country: 'Russia', url_resolved: 'https://radio.test/other' }));
  assert.ok(matcher({ stationuuid: 'stream-mirror', name: 'Other Label', country: 'Russia', url_resolved: 'https://radio.test/live?channel=a#new' }));
  assert.ok(!matcher({ stationuuid: 'different-channel', name: 'Other Label', country: 'Russia', url_resolved: 'https://radio.test/live?channel=b' }));
  assert.ok(!matcher({ stationuuid: 'unrequested-mirror', name: 'Unrequested Anchor', country: 'Russia', url_resolved: 'https://radio.test/other' }));
});

test('a nonmusic turn followed by a short reply does not revive old repeat anchors', async () => {
  let batchCalls = 0;
  let singleCalls = 0;
  let searchCalls = 0;
  const tools: AssistantDeps['tools'] = {
    getStation: async () => { singleCalls += 1; return null; },
    getStationsByIds: async () => { batchCalls += 1; return []; },
    searchStations: async () => { searchCalls += 1; return []; },
    discoverTrending: async () => []
  };
  const input: ChatInput = {
    ...request('и?'),
    history: [
      { role: 'user', text: 'Подбери энергичное радио из России, не включай.' },
      { role: 'assistant', text: 'Вот предыдущие варианты.' },
      { role: 'user', text: 'Что лучше подать к пицце?' },
      { role: 'assistant', text: 'Можно взять салат и напиток.' }
    ]
  };
  const result = await runLiraAgent(input, dependencies(tools, JSON.stringify({ action: 'final', intent: 'chat' }), []));

  assert.equal(batchCalls, 0);
  assert.equal(singleCalls, 0);
  assert.equal(searchCalls, 0);
  assert.deepEqual(result.stations, []);
});
