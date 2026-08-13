import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyDirectActionIntent, runLiraAgent } from '../src/ai/agentRunner.js';
import type { AssistantDeps, VerifiedStationRef } from '../src/ai/types.js';

const station: VerifiedStationRef = {
  stationuuid: '11111111-1111-4111-8111-111111111111',
  name: 'Agent Radio',
  country: 'DE',
  tags: ['electronic'],
  favicon: '',
  url_resolved: 'https://radio.example/stream'
};

const deps = (getStation = async () => station): AssistantDeps => ({
  model: {
    provider: 'deepseek',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://deepseek.invalid',
    model: 'test-model',
    maxOutputTokens: 200,
    timeoutSec: 2
  },
  tools: {
    searchStations: async () => [],
    getStation,
    discoverTrending: async () => []
  },
  musicServices: [],
  fetch: globalThis.fetch,
  log: () => {},
  now: () => 1
});

test('explicit current-station writes route deterministically even when context is missing', () => {
  assert.deepEqual(classifyDirectActionIntent('добавь текущую в избранное', false), {
    kind: 'set-favorite',
    desired: true
  });
});

test('questions and ordinary English preference phrasing do not become writes', () => {
  assert.equal(classifyDirectActionIntent('what is pause?', true), null);
  assert.equal(classifyDirectActionIntent("I'd like jazz radio", true), null);
  assert.equal(classifyDirectActionIntent('what is a queue?', true), null);
});

test('direct action returns needs_input instead of asking the model to improvise', async () => {
  const result = await runLiraAgent(
    { userMessage: 'добавь текущую в очередь', surface: 'miniapp' },
    deps()
  );
  assert.equal(result.agentRun?.route, 'direct_action');
  assert.equal(result.agentRun?.status, 'needs_input');
  assert.equal(result.actions[0]?.kind, 'none');
});

test('verified direct action is policy-stamped and fully traced', async () => {
  const result = await runLiraAgent(
    {
      userMessage: 'добавь текущую в очередь',
      surface: 'miniapp',
      nowPlaying: { stationUuid: station.stationuuid, stationName: station.name },
      agentContext: { queueStationIds: [] }
    },
    deps()
  );
  assert.equal(result.actions[0]?.kind, 'enqueue');
  assert.equal(result.actions[0]?.stationuuid, station.stationuuid);
  assert.equal(result.actions[0]?.permission, 'write');
  assert.match(result.actions[0]?.actionId || '', /^[0-9a-f-]+:1$/i);
  assert.equal(result.agentRun?.verifierPassed, true);
  assert.equal(result.agentRun?.toolCalls[0]?.name, 'get_station');
  assert.equal(result.agentRun?.toolCalls[0]?.status, 'completed');
  assert.equal(result.agentRun?.provider, 'deepseek');
});

test('pause is idempotent and performs no catalog or model call', async () => {
  let stationCalls = 0;
  const result = await runLiraAgent(
    {
      userMessage: 'поставь на паузу',
      surface: 'miniapp',
      agentContext: { isPlaying: false }
    },
    deps(async () => {
      stationCalls += 1;
      return station;
    })
  );
  assert.equal(result.actions[0]?.kind, 'none');
  assert.equal(result.agentRun?.route, 'direct_action');
  assert.equal(result.agentRun?.toolCalls.length, 0);
  assert.equal(stationCalls, 0);
});

test('Telegram never routes into Mini App state mutations', async () => {
  const result = await runLiraAgent(
    { userMessage: 'поставь на паузу', surface: 'telegram' },
    deps()
  );
  assert.equal(result.agentRun?.route, 'music_worker');
  assert.equal(result.actions[0]?.kind, 'none');
});
