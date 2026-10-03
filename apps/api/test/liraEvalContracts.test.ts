import assert from 'node:assert/strict';
import test from 'node:test';
import { checkContractResult, CONTRACT_FIXTURES, createEvalTools, EVAL_STATIONS, runOfflineLiraContracts } from '../scripts/liraEvalContracts.js';
import type { ChatResult } from '../src/ai/types.js';

test('offline Lira contracts exercise the real worker with zero provider calls and separate quality status', async () => {
  const report = await runOfflineLiraContracts();
  assert.equal(report.mode, 'offline-contract');
  assert.equal(report.modelQualityAssessed, false);
  assert.equal(report.modelCalls, 0);
  assert.equal(report.total, 24);
  assert.equal(report.passCount, report.total, JSON.stringify(report.runs.filter(run => !run.passed)));
  assert.equal(report.runs.find(run => run.fixture === 'lookup-unavailable')?.status, 'failed');
  assert.equal(report.runs.find(run => run.fixture === 'search-unavailable')?.status, 'failed');
});

test('eval catalogue honors country, tag and cap; the real adapter filters foreign sources before cap', async () => {
  const tools = createEvalTools();
  assert.deepEqual((await tools.searchStations({ query: '', country: 'DE', tag: 'jazz' })).map(item => item.stationuuid), ['eval-berlin']);
  assert.deepEqual(await tools.searchStations({ query: '', country: 'Imaginary Republic', tag: 'jazz' }), []);
  assert.deepEqual((await tools.searchStations({ query: 'jazz', limit: 1 })).map(item => item.stationuuid), ['eval-jazz']);
  assert.deepEqual((await tools.searchStations({ query: 'jazz', limit: 2,
    relatedTo: { stationuuid: 'eval-paris', country: 'France', genres: ['jazz'] }, excludeStationIds: ['eval-jazz']
  })).map(item => item.stationuuid), ['eval-berlin', 'eval-tokyo']);
});

test('contract grading rejects unrelated or altered cards, hidden writes, and fallback after a model attempt', () => {
  const fixture = CONTRACT_FIXTURES.find(item => item.id === 'foreign-no-play')!;
  const result: ChatResult = {
    reply: 'Catalogue genres from other countries.', serviceLinks: [], sources: [], usage: { prompt: 0, completion: 0 },
    stations: fixture.stationIds.map(id => EVAL_STATIONS.find(item => item.stationuuid === id)!),
    actions: [{ kind: 'open-station', stationuuid: 'eval-jazz', permission: 'read' }],
    agentRun: { runId: 'fixture-run', taskId: 'fixture', provider: 'openai', model: 'offline-contract', route: 'music_worker', status: 'completed',
      steps: 2, toolCalls: [], durationMs: 0, verifierPassed: true, warnings: [] }
  };
  assert.deepEqual(checkContractResult(fixture, result, 0), []);
  assert.ok(checkContractResult(fixture, { ...result, sources: [{ title: 'Invented citation', url: 'https://invented.invalid', snippet: 'Invented fact', score: 1 }] }, 0).includes('unexpected_sources'));
  assert.ok(checkContractResult(fixture, { ...result, serviceLinks: [{ service: 'spotify', label: 'Invented link', url: 'https://invented.invalid', query: 'Jazz' }] }, 0).includes('unexpected_service_links'));
  assert.ok(checkContractResult(fixture, result, 1).includes('unexpected_model_call'));
  assert.ok(checkContractResult(fixture, { ...result, stations: [EVAL_STATIONS[5]!] }, 0).includes('wrong_station_ids'));
  assert.ok(checkContractResult(fixture, { ...result, stations: result.stations.map(item => ({ ...item, country: 'France' })) }, 0).includes('wrong_station_facts'));
  assert.ok(checkContractResult(fixture, { ...result, actions: [...result.actions, { kind: 'play', stationuuid: 'eval-jazz', permission: 'write' }] }, 0).includes('wrong_actions'));
  assert.ok(checkContractResult(fixture, { ...result, actions: [{ kind: 'open-station', stationuuid: 'eval-rock', permission: 'read' }] }, 0).includes('action_target_not_eligible'));
  assert.ok(checkContractResult(fixture, { ...result, reply: 'Wrong browser name is our source' }, 0).includes('unverified_display_name'));
  assert.ok(checkContractResult(fixture, { ...result, usage: { prompt: 2, completion: 1 } }, 0).includes('unexpected_model_usage'));
});
