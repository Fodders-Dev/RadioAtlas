// Controlled catalogue and independent expected UUIDs for CLI evaluation.
// No dotenv, credentials, live catalogue, streams or provider calls here.
import { createCatalogToolProvider, type CatalogServiceLike } from '../src/ai/catalogToolProvider.js';
import { runLiraAgent } from '../src/ai/agentRunner.js';
import type { AssistantAction, AssistantDeps, ChatInput, ChatResult, VerifiedStationRef } from '../src/ai/types.js';

const station = (stationuuid: string, name: string, country: string, tags: string[]): VerifiedStationRef => ({
  stationuuid, name, country, tags, favicon: '', url_resolved: `https://streams.eval.invalid/${stationuuid}`
});

export const EVAL_STATIONS = [
  station('eval-jazz', 'Midnight Jazz', 'US', ['jazz', 'smooth jazz']),
  station('eval-electronic', 'Electric Motion', 'DE', ['electronic', 'drum and bass']),
  station('eval-synthwave', 'Neon Drive', 'US', ['synthwave', 'new wave']),
  station('eval-ambient', 'Quiet Focus', 'IS', ['ambient', 'instrumental']),
  station('eval-trance', 'Trance Miles', 'NL', ['trance', 'progressive']),
  station('eval-rock', 'Guitar Signal', 'GB', ['rock', 'alternative']),
  station('eval-paris', 'Paris Jazz', 'France', ['jazz']),
  // Deliberately before the foreign matches: filtering a ranked page AFTER
  // its cap would lose Berlin/Tokyo and fail the fixed expected UUID set.
  ...Array.from({ length: 20 }, (_, i) => station(`eval-home-${i}`, `French Jazz ${i}`, 'France', ['jazz'])),
  station('eval-alias-home', 'French Alias Jazz', 'FR', ['jazz']),
  station('eval-berlin', 'Berlin Jazz', 'Germany', ['jazz']),
  station('eval-tokyo', 'Tokyo Jazz', 'Japan', ['smooth jazz']),
  station('eval-unknown', 'Unlocated Jazz', '', ['jazz']),
  station('eval-unknown-label', 'Unknown Country Jazz', 'Unknown', ['jazz']),
  station('eval-talk', 'Jazz News', 'Germany', ['jazz', 'news']),
  station('eval-no-genre', 'Radio News', 'France', ['news']),
  { ...station('eval-no-stream', 'Disconnected Jazz', 'Germany', ['jazz']), url_resolved: '' }
];

const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const regions = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (country: string) => normalize(/^[a-z]{2}$/i.test(country) ? regions.of(country.toUpperCase()) || country : country);

export const createEvalTools = (stations: VerifiedStationRef[] = EVAL_STATIONS): AssistantDeps['tools'] => {
  const rows = stations.map(item => ({ ...item, tags: item.tags.join(',') }));
  const catalogue: CatalogServiceLike = {
    getCatalog: async () => rows,
    getStationById: async id => rows.find(item => item.stationuuid === id) || null,
    getSummary: async () => ({ trending: rows.slice(0, 5) }),
    search: async filters => {
      const terms = normalize(filters.q).split(/\s+/).filter(Boolean);
      const candidates = rows.filter(item => {
        if (filters.country && countryName(item.country) !== countryName(filters.country)) return false;
        if (filters.tag && !item.tags.split(',').some(tag => normalize(tag) === normalize(filters.tag))) return false;
        const haystack = normalize(`${item.name} ${item.tags}`);
        return !terms.length || terms.some(term => term.length > 2 && haystack.includes(term));
      });
      return { items: candidates.slice(filters.cursor, filters.cursor + filters.limit) };
    }
  };
  // Exercise the REAL adapter, including foreign constraints before the cap.
  // Only the catalogue service is an in-memory fixture.
  const tools = createCatalogToolProvider(catalogue);
  return {
    ...tools,
    matchStationsByArtistName: async artist => normalize(artist).includes('robert miles')
      ? stations.filter(item => item.stationuuid === 'eval-trance') : []
  };
};

type ContractFixture = {
  id: string;
  input: ChatInput;
  stationIds: string[];
  action: AssistantAction['kind'];
  toolFailure?: 'lookup' | 'search';
  homeOnly?: boolean;
  replyIncludes?: string;
};

const input = (userMessage: string, extra: Partial<ChatInput> = {}): ChatInput => ({
  userMessage, surface: 'miniapp', locale: 'ru',
  nowPlaying: { stationUuid: 'eval-paris', stationName: 'Wrong browser name' },
  agentContext: { isPlaying: false, queueStationIds: ['eval-rock', 'eval-paris'] }, ...extra
});
const foreign = ['eval-jazz', 'eval-berlin', 'eval-tokyo'];
const query = 'Найди похожее из другой страны, не включай';

export const CONTRACT_FIXTURES: ContractFixture[] = [
  { id: 'foreign-no-play', input: input(query), stationIds: foreign, action: 'open-station' },
  { id: 'foreign-en', input: input("Find similar stations from another country, don't play", { locale: 'en' }), stationIds: foreign, action: 'open-station' },
  { id: 'foreign-explicit-play', input: input('Включи похожее из другой страны'), stationIds: foreign, action: 'play' },
  { id: 'play-then-prohibition', input: input('Включи похожее из другой страны, но не включай пока'), stationIds: foreign, action: 'open-station' },
  { id: 'foreign-more', input: input('ещё варианты', {
    history: [{ role: 'user', text: query }, { role: 'assistant', text: 'Wrong guessed source: Guitar Signal' }],
    userTaste: { hiddenStationIds: ['eval-berlin'], lastRecommendedStationIds: ['eval-jazz'] }
  }), stationIds: ['eval-tokyo'], action: 'open-station' },
  { id: 'missing-context', input: input(query, { nowPlaying: undefined }), stationIds: [], action: 'none' },
  { id: 'missing-source', input: input(query, { nowPlaying: { stationUuid: 'not-in-catalogue' } }), stationIds: [], action: 'none' },
  { id: 'missing-country', input: input(query, { nowPlaying: { stationUuid: 'eval-unknown' } }), stationIds: [], action: 'none' },
  { id: 'missing-genre', input: input(query, { nowPlaying: { stationUuid: 'eval-no-genre' } }), stationIds: [], action: 'none' },
  { id: 'unsupported-energy', input: input('Найди похожее из другой страны, но спокойнее'), stationIds: [], action: 'none', replyIncludes: 'дополнительные условия' },
  { id: 'unsupported-more', input: input('давай', { history: [{ role: 'user', text: 'Найди похожее из другой страны без вокала' }] }), stationIds: [], action: 'none', replyIncludes: 'дополнительные условия' },
  { id: 'no-foreign-match', input: input(query), stationIds: [], action: 'none', homeOnly: true },
  { id: 'lookup-unavailable', input: input(query), stationIds: [], action: 'none', toolFailure: 'lookup' },
  { id: 'search-unavailable', input: input(query), stationIds: [], action: 'none', toolFailure: 'search' },
  { id: 'pause-is-transport', input: input('Поставь на паузу и найди похожее из другой страны', { agentContext: { isPlaying: true, queueStationIds: ['eval-paris'] } }), stationIds: [], action: 'pause' },
  { id: 'already-paused', input: input('Поставь на паузу и найди похожее из другой страны'), stationIds: [], action: 'none' },
  { id: 'unsupported-enqueue', input: input('Найди похожее из другой страны и добавь в очередь'), stationIds: [], action: 'none' }
];

export const checkContractResult = (fixture: ContractFixture, result: ChatResult, modelCalls: number): string[] => {
  const failures: string[] = [];
  if (modelCalls !== 0) failures.push('unexpected_model_call');
  if (!result.reply.trim()) failures.push('reply_empty');
  if (result.sources.length) failures.push('unexpected_sources');
  if (result.serviceLinks.length) failures.push('unexpected_service_links');
  const ids = result.stations.map(item => item.stationuuid);
  if (ids.length !== fixture.stationIds.length || ids.some(id => !fixture.stationIds.includes(id)) || new Set(ids).size !== ids.length) failures.push('wrong_station_ids');
  for (const item of result.stations) {
    const expected = EVAL_STATIONS.find(station => station.stationuuid === item.stationuuid);
    if (expected && (item.name !== expected.name || item.country !== expected.country || item.url_resolved !== expected.url_resolved ||
      item.tags.slice().sort().join(',') !== expected.tags.slice().sort().join(','))) failures.push('wrong_station_facts');
  }
  if (result.reply.includes('Wrong browser name')) failures.push('unverified_display_name');
  if (result.actions.length !== 1 || result.actions.some(action => action.kind !== fixture.action)) failures.push('wrong_actions');
  for (const action of result.actions) {
    if (action.permission !== (action.kind === 'play' || action.kind === 'pause' ? 'write' : 'read')) failures.push('wrong_action_permission');
    if (action.kind === 'play' || action.kind === 'open-station') {
      if (!action.stationuuid || !fixture.stationIds.includes(action.stationuuid)) failures.push('action_target_not_eligible');
    }
  }
  if (!result.agentRun?.verifierPassed) failures.push('verifier_failed');
  if (fixture.toolFailure && result.agentRun?.status !== 'failed') failures.push('missing_failure_status');
  if (!fixture.toolFailure && result.agentRun?.status !== 'completed') failures.push('unexpected_status');
  if ((result.agentRun?.steps || 0) > 4 || (result.agentRun?.toolCalls.length || 0) > 6) failures.push('agent_limit_exceeded');
  if (result.modelErrors?.length) failures.push('unexpected_model_error');
  if ((result.usage?.prompt || 0) !== 0 || (result.usage?.completion || 0) !== 0) failures.push('unexpected_model_usage');
  if (fixture.replyIncludes && !result.reply.includes(fixture.replyIncludes)) failures.push('unsupported_condition_not_acknowledged');
  return failures;
};

export const runOfflineLiraContracts = async () => {
  const runs = [];
  for (const fixture of CONTRACT_FIXTURES) {
    let modelCalls = 0;
    const beforeInput = JSON.stringify(fixture.input);
    const tools = createEvalTools(fixture.homeOnly ? EVAL_STATIONS.filter(item => item.country === 'France' || item.country === 'FR') : EVAL_STATIONS);
    if (fixture.toolFailure === 'lookup') tools.getStation = async () => { throw new Error('fixture lookup unavailable'); };
    if (fixture.toolFailure === 'search') tools.searchStations = async () => { throw new Error('fixture search unavailable'); };
    const result = await runLiraAgent(fixture.input, {
      model: { enabled: true, apiKey: 'fixture-only', baseUrl: 'https://model.eval.invalid', model: 'offline-contract', maxOutputTokens: 300, timeoutSec: 2 },
      tools, musicServices: [],
      fetch: (async () => { modelCalls++; throw new Error('Provider calls are forbidden in offline contracts'); }) as typeof fetch,
      log: () => {}, now: () => Date.UTC(2026, 9, 1), safetyIdentifier: 'lira:offline-eval'
    });
    const failures = checkContractResult(fixture, result, modelCalls);
    if (JSON.stringify(fixture.input) !== beforeInput) failures.push('input_mutated');
    runs.push({ fixture: fixture.id, passed: failures.length === 0, failures, reply: result.reply,
      stationIds: result.stations.map(item => item.stationuuid), actions: result.actions,
      status: result.agentRun?.status, modelCalls });
  }
  return { mode: 'offline-contract' as const, modelQualityAssessed: false,
    total: runs.length, passCount: runs.filter(run => run.passed).length,
    modelCalls: runs.reduce((sum, run) => sum + run.modelCalls, 0), runs };
};
