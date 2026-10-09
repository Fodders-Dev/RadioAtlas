import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  BUDGETED_MODEL_PRICING,
  assertTrustedLoopbackRelay,
  createBudgetedProviderFetch,
  initializeProviderBudgetLedger,
  openProviderBudgetLedger,
  type ProviderCallAccounting
} from '../src/ai/providerBudget.js';
import { runLiraAgent } from '../src/ai/agentRunner.js';
import { CONTRACT_FIXTURES, createEvalTools, EVAL_STATIONS, runOfflineLiraContracts } from './liraEvalContracts.js';
import type {
  AiModelConfig,
  AiModelProvider,
  AssistantAction,
  ChatInput,
  ChatResult,
  SearchStationsArgs,
  VerifiedStationRef
} from '../src/ai/types.js';

type EvalFixture = {
  id: string;
  input: ChatInput;
  expectedActions: AssistantAction['kind'][];
  minStations: number;
  excludedStationIds?: string[];
};

type EvalRun = {
  fixture: string;
  passed: boolean;
  failures: string[];
  reply: string;
  action: AssistantAction['kind'];
  stations: string[];
  status: string;
  verifierPassed: boolean;
  steps: number;
  toolCalls: number;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  modelCallCount: number;
  usageResponseCount: number;
  failedAttempts: number;
  usageCountMismatch: boolean;
  reservedMicroUsd: number;
  estimatedUncachedUsd: number;
  catalogSearches: EvalCatalogSearch[];
};

type EvalCatalogSearch = {
  args: {
    query: string;
    tag?: string;
    language?: string;
    country?: string;
    limit?: number;
    semanticGenre?: string;
    semanticExcludeTags?: string[];
    catalogEra?: { fromYear: number; toYear: number };
    catalogEraTags?: string[];
  };
  returnedStationIds: string[];
};

type ProviderReport = {
  provider: AiModelProvider;
  model: string;
  priceSource: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  passCount: number;
  total: number;
  passRate: number;
  qualityAssessment: {
    assessedRunCount: number;
    unassessedRunCount: number;
    passCount: number;
    passRate: number | null;
  };
  medianDurationMs: number;
  promptTokens: number;
  completionTokens: number;
  estimatedUncachedUsd: number;
  reservedMicroUsd: number;
  reservedUsd: number;
  usageResponseCount: number;
  modelCallCount: number;
  failedAttempts: number;
  syntheticCatalog: true;
  runs: EvalRun[];
};

const PRICE_SOURCES = {
  deepseek: 'https://api-docs.deepseek.com/quick_start/pricing/',
  openai: 'https://openai.com/api/pricing/'
} as const;

const PROVIDER_STATIONS = [
  ...EVAL_STATIONS,
  {
    stationuuid: 'eval-sonic-energy', name: 'Blue Blur Radio', country: 'US',
    tags: ['sonic', 'video game', 'energetic electronic', 'fast dance'], favicon: '', url_resolved: 'https://streams.eval.invalid/eval-sonic-energy'
  },
  {
    stationuuid: 'eval-russian-2000s-dance', name: 'Russian Dance 2000s', country: 'RU',
    tags: ['russian pop', 'dance', '2000s', '2010s', 'electronic'], favicon: '', url_resolved: 'https://streams.eval.invalid/eval-russian-2000s-dance'
  },
  {
    stationuuid: 'eval-amiga-chiptune', name: 'Amiga Chip Archive', country: 'DE',
    tags: ['amiga', 'chiptune', 'computer music', 'tracker'], favicon: '', url_resolved: 'https://streams.eval.invalid/eval-amiga-chiptune'
  },
  {
    stationuuid: 'eval-amiga-arcade', name: 'Pixel Circuit', country: 'GB',
    tags: ['chiptune', 'video game', 'retro gaming', 'amiga'], favicon: '', url_resolved: 'https://streams.eval.invalid/eval-amiga-arcade'
  }
];

const FIXTURES: EvalFixture[] = [
  {
    id: 'evening-jazz',
    input: { userMessage: 'Посоветуй уютный вечерний джаз', surface: 'telegram', locale: 'ru' },
    expectedActions: ['open-station'],
    minStations: 1
  },
  {
    id: 'play-electronic',
    input: { userMessage: 'Включи энергичный электро-микс, чтобы встряхнуться', surface: 'telegram', locale: 'ru' },
    expectedActions: ['play'],
    minStations: 1
  },
  {
    id: 'focus-instrumental',
    input: { userMessage: 'Нужен ровный фон для работы — без слов и сюрпризов', surface: 'telegram', locale: 'ru' },
    expectedActions: ['open-station'],
    minStations: 1
  },
  {
    id: 'cultural-vibe',
    input: { userMessage: 'Подбери радио в духе GTA Vice City', surface: 'telegram', locale: 'ru' },
    expectedActions: ['open-station'],
    minStations: 1
  },
  {
    id: 'artist-reference',
    input: { userMessage: 'Что-то в стиле Robert Miles', surface: 'telegram', locale: 'ru' },
    expectedActions: ['open-station'],
    minStations: 1
  },
  {
    id: 'music-conversation',
    input: { userMessage: 'Почему людям так нравится джаз?', surface: 'telegram', locale: 'ru' },
    expectedActions: ['none'],
    minStations: 0
  },
  {
    id: 'casual-russian-chat',
    input: { userMessage: 'Сегодня такой тихий вечер, хочется просто поболтать о музыке.', surface: 'telegram', locale: 'ru' },
    expectedActions: ['none'], minStations: 0
  },
  {
    id: 'sonic-energetic',
    input: { userMessage: 'Подбери энергичную музыку как в Sonic, чтобы хотелось бежать. Не включай.', surface: 'telegram', locale: 'ru' },
    expectedActions: ['open-station'], minStations: 1
  },
  {
    id: '2000s-russian-refinement',
    input: {
      userMessage: 'Не 90-е, а 2000 по 2014, и русскоязычную станцию, пожалуйста.', surface: 'telegram', locale: 'ru',
      history: [
        { role: 'user', text: 'Подбери танцевальное радио, но не включай.' },
        { role: 'assistant', text: 'Нашла танцевальную музыку нулевых.' }
      ]
    },
    expectedActions: ['open-station'], minStations: 1
  },
  {
    id: 'amiga-chiptune',
    input: { userMessage: 'Найди радио с музыкой в стиле Amiga и чиптюна.', surface: 'telegram', locale: 'ru' },
    expectedActions: ['open-station'], minStations: 1
  },
  {
    id: 'rejection-clarifies',
    input: {
      userMessage: 'Нет, это совсем не то.', surface: 'telegram', locale: 'ru',
      history: [
        { role: 'user', text: 'Подбери энергичную танцевальную музыку.' },
        { role: 'assistant', text: 'Вот несколько вариантов: Blue Blur Radio и Electric Motion.' }
      ],
      userTaste: {
        lastSuggestedStationIds: ['eval-sonic-energy', 'eval-electronic'],
        lastRecommendedStationIds: ['eval-sonic-energy', 'eval-electronic']
      }
    },
    expectedActions: ['none', 'open-station'], minStations: 0,
    excludedStationIds: ['eval-sonic-energy', 'eval-electronic']
  },
  {
    id: 'do-not-repeat-prior-station',
    input: {
      userMessage: 'Ещё один вариант, но не повторяй предыдущий.', surface: 'telegram', locale: 'ru',
      history: [
        { role: 'user', text: 'Подбери энергичную музыку как в Sonic.' },
        { role: 'assistant', text: 'Нашла Blue Blur Radio.' }
      ],
      userTaste: { lastSuggestedStationIds: ['eval-sonic-energy'] }
    },
    expectedActions: ['open-station'], minStations: 1, excludedStationIds: ['eval-sonic-energy']
  }
];

const argValue = (name: string) => {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
};

const hasFlag = (name: string) => process.argv.slice(2).includes(`--${name}`);

if (hasFlag('init-budget')) {
  const databasePath = process.env.LIRA_PILOT_BUDGET_DB_PATH || '';
  const ledger = await initializeProviderBudgetLedger(databasePath);
  const campaigns = [ledger.snapshot('comparison'), ledger.snapshot('owner-trial')];
  ledger.close();
  console.log(JSON.stringify({ initialized: true, campaigns }, null, 2));
  process.exit(0);
}

const evalTools = createEvalTools(PROVIDER_STATIONS);

const createTracedEvalTools = (catalogSearches: EvalCatalogSearch[]) => ({
  ...evalTools,
  searchStations: async (args: SearchStationsArgs): Promise<VerifiedStationRef[]> => {
    const stations = await evalTools.searchStations(args);
    catalogSearches.push({
      args: {
        query: String(args.query || '').slice(0, 120),
        ...(args.tag ? { tag: String(args.tag).slice(0, 80) } : {}),
        ...(args.language ? { language: String(args.language).slice(0, 40) } : {}),
        ...(args.country ? { country: String(args.country).slice(0, 40) } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
        ...(args.semanticGenre ? { semanticGenre: String(args.semanticGenre).slice(0, 80) } : {}),
        ...(args.semanticExcludeTags ? { semanticExcludeTags: args.semanticExcludeTags.slice(0, 2).map(tag => String(tag).slice(0, 80)) } : {}),
        ...(args.catalogEra ? { catalogEra: { fromYear: args.catalogEra.fromYear, toYear: args.catalogEra.toYear } } : {}),
        ...(args.catalogEraTags ? { catalogEraTags: args.catalogEraTags.slice(0, 12).map(tag => String(tag).slice(0, 40)) } : {})
      },
      returnedStationIds: stations.map(station => station.stationuuid).slice(0, 8)
    });
    return stations;
  }
});

const modelConfig = (provider: AiModelProvider): AiModelConfig =>
  provider === 'openai'
    ? {
        provider,
        enabled: true,
        apiKey: process.env.LIRA_PILOT_OPENAI_API_KEY || '',
        baseUrl: process.env.LIRA_PILOT_OPENAI_BASE_URL || '',
        model: 'gpt-6-luna',
        maxOutputTokens: 1000,
        timeoutSec: 25,
        reasoningEffort: 'low'
      }
    : {
        provider,
        enabled: true,
        apiKey: process.env.DEEPSEEK_API_KEY || '',
        baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
        model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
        maxOutputTokens: 1000,
        timeoutSec: Math.max(1, Number(process.env.AI_TIMEOUT_SEC) || 20),
        reasoningEffort: 'none'
      };

const prices = (provider: AiModelProvider) => {
  const model = modelConfig(provider).model as keyof typeof BUDGETED_MODEL_PRICING;
  const price = BUDGETED_MODEL_PRICING[model];
  if (!price || (provider === 'openai' && model !== 'gpt-6-luna')) {
    throw new Error(`unpriced Lira evaluation model: ${model}`);
  }
  return { input: price.input / 1_000_000, output: price.output / 1_000_000 };
};

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
};

const evaluateResult = (
  fixture: EvalFixture,
  result: ChatResult,
  price: { input: number; output: number },
  accounting: ProviderCallAccounting,
  catalogSearches: EvalCatalogSearch[]
): EvalRun => {
  const action = result.actions[0]?.kind || 'none';
  const failures: string[] = [];
  if (!result.reply.trim()) failures.push('reply_empty');
  if (!fixture.expectedActions.includes(action)) failures.push(`unexpected_action:${action}`);
  if (result.stations.length < fixture.minStations) failures.push('station_count_below_minimum');
  if (action === 'open-station' && result.stations.length < 1) failures.push('open_station_without_cards');
  if (!result.agentRun?.verifierPassed) failures.push('verifier_failed');
  if (result.agentRun && result.agentRun.steps > 4) failures.push('step_limit_exceeded');
  if (result.agentRun && result.agentRun.toolCalls.length > 6) failures.push('tool_limit_exceeded');
  if (result.modelErrors?.length) failures.push(...result.modelErrors.map((error) => `model_error:${error}`));
  if (accounting.modelCallCount === 0) failures.push('no_provider_call_quality_not_assessed');
  if (accounting.failedAttempts) failures.push('provider_attempt_failed');
  const promptTokens = accounting.inputTokens;
  const completionTokens = accounting.outputTokens;
  const usageCountMismatch = accounting.modelCallCount !== accounting.usageResponseCount ||
    promptTokens !== (result.usage?.prompt || 0) || completionTokens !== (result.usage?.completion || 0);
  if (usageCountMismatch) failures.push('provider_usage_mismatch');
  const estimatedUncachedUsd =
    (promptTokens * price.input + completionTokens * price.output) / 1_000_000;
  if (fixture.excludedStationIds?.some((id) => result.stations.some((station) => station.stationuuid === id))) {
    failures.push('repeated_excluded_station');
  }
  return {
    fixture: fixture.id,
    passed: failures.length === 0,
    failures,
    reply: result.reply,
    action,
    stations: result.stations.map((item) => item.name),
    status: result.agentRun?.status || 'missing',
    verifierPassed: Boolean(result.agentRun?.verifierPassed),
    steps: result.agentRun?.steps || 0,
    toolCalls: result.agentRun?.toolCalls.length || 0,
    durationMs: result.agentRun?.durationMs || 0,
    promptTokens,
    completionTokens,
    modelCallCount: accounting.modelCallCount,
    usageResponseCount: accounting.usageResponseCount,
    failedAttempts: accounting.failedAttempts,
    usageCountMismatch,
    reservedMicroUsd: accounting.reservedMicroUsd,
    estimatedUncachedUsd: Number(estimatedUncachedUsd.toFixed(8)),
    catalogSearches
  };
};

const runProvider = async (
  provider: AiModelProvider,
  repeat: number,
  fixtures: EvalFixture[]
): Promise<ProviderReport> => {
  const model = modelConfig(provider);
  const price = prices(provider);
  const runs: EvalRun[] = [];
  const ledger = await openProviderBudgetLedger(process.env.LIRA_PILOT_BUDGET_DB_PATH || '');
  const fetch = createBudgetedProviderFetch({
    provider: provider === 'openai' ? 'openai' : 'deepseek',
    campaign: 'comparison',
    baseUrl: model.baseUrl,
    ledger,
    fetch: globalThis.fetch
  });
  try {
    for (let iteration = 0; iteration < repeat; iteration += 1) {
      for (const fixture of fixtures) {
        const catalogSearches: EvalCatalogSearch[] = [];
        const before = fetch.getBudgetAccounting();
        const result = await runLiraAgent(fixture.input, {
          model,
          tools: createTracedEvalTools(catalogSearches),
          musicServices: [],
          fetch,
          log: () => {},
          now: () => Date.UTC(2026, 7, 13, 12, iteration),
          safetyIdentifier: 'lira:provider-eval'
        });
        const after = fetch.getBudgetAccounting();
        const accounting: ProviderCallAccounting = {
          modelCallCount: after.modelCallCount - before.modelCallCount,
          failedAttempts: after.failedAttempts - before.failedAttempts,
          usageResponseCount: after.usageResponseCount - before.usageResponseCount,
          inputTokens: after.inputTokens - before.inputTokens,
          outputTokens: after.outputTokens - before.outputTokens,
          reservedMicroUsd: after.reservedMicroUsd - before.reservedMicroUsd
        };
        runs.push(evaluateResult(fixture, result, price, accounting, catalogSearches));
      }
    }
  } finally {
    ledger.close();
  }
  const passCount = runs.filter((run) => run.passed).length;
  const assessedRuns = runs.filter((run) =>
    run.modelCallCount > 0 && run.failedAttempts === 0 && !run.usageCountMismatch &&
    !run.failures.includes('no_provider_call_quality_not_assessed')
  );
  const assessedPassCount = assessedRuns.filter((run) => run.passed).length;
  const promptTokens = runs.reduce((sum, run) => sum + run.promptTokens, 0);
  const completionTokens = runs.reduce((sum, run) => sum + run.completionTokens, 0);
  return {
    provider,
    model: model.model,
    priceSource: PRICE_SOURCES[provider],
    inputUsdPerMillion: price.input,
    outputUsdPerMillion: price.output,
    passCount,
    total: runs.length,
    passRate: runs.length ? Number((passCount / runs.length).toFixed(4)) : 0,
    qualityAssessment: {
      assessedRunCount: assessedRuns.length,
      unassessedRunCount: runs.length - assessedRuns.length,
      passCount: assessedPassCount,
      passRate: assessedRuns.length ? Number((assessedPassCount / assessedRuns.length).toFixed(4)) : null
    },
    medianDurationMs: median(runs.map((run) => run.durationMs)),
    promptTokens,
    completionTokens,
    estimatedUncachedUsd: Number(
      runs.reduce((sum, run) => sum + run.estimatedUncachedUsd, 0).toFixed(8)
    ),
    reservedMicroUsd: runs.reduce((sum, run) => sum + run.reservedMicroUsd, 0),
    reservedUsd: Number((runs.reduce((sum, run) => sum + run.reservedMicroUsd, 0) / 1_000_000).toFixed(8)),
    usageResponseCount: runs.reduce((sum, run) => sum + run.usageResponseCount, 0),
    modelCallCount: runs.reduce((sum, run) => sum + run.modelCallCount, 0),
    failedAttempts: runs.reduce((sum, run) => sum + run.failedAttempts, 0),
    syntheticCatalog: true,
    runs
  };
};

const requestedProvider = argValue('provider') || 'both';
if (!['deepseek', 'openai', 'both'].includes(requestedProvider)) {
  throw new Error('--provider must be deepseek, openai, or both');
}
const providers: AiModelProvider[] =
  requestedProvider === 'both'
    ? ['deepseek', 'openai']
    : [requestedProvider as AiModelProvider];
const fixtureArgument = argValue('fixture');
const fixtureIds = fixtureArgument === undefined ? undefined : fixtureArgument.split(',').map(id => id.trim());
if (fixtureIds && (
  !fixtureIds.length || fixtureIds.some(id => !id) ||
  new Set(fixtureIds).size !== fixtureIds.length ||
  fixtureIds.some(id => !FIXTURES.some(fixture => fixture.id === id))
)) {
  throw new Error('--fixture must be a comma-separated list of known fixture ids');
}
const selectedFixtures = fixtureIds
  ? FIXTURES.filter(fixture => fixtureIds.includes(fixture.id))
  : FIXTURES;
const repeat = Math.max(1, Math.min(10, Number(argValue('repeat')) || 1));
const missing = providers.filter((provider) => !modelConfig(provider).apiKey);

if (hasFlag('dry-run')) {
  console.log(
    JSON.stringify(
      {
        mode: 'dry-run',
        providers: providers.map((provider) => ({
          provider,
          model: modelConfig(provider).model,
          keyConfigured: !missing.includes(provider),
          prices: prices(provider),
          priceSource: PRICE_SOURCES[provider]
        })),
        repeat,
        fixtures: selectedFixtures.map(({ id, expectedActions, minStations }) => ({
          id,
          expectedActions,
          minStations
        })),
        offlineContracts: CONTRACT_FIXTURES.map(({ id, input, stationIds, action }) => ({
          id, prompt: input.userMessage, expectedStationIds: stationIds, expectedAction: action
        }))
      },
      null,
      2
    )
  );
  process.exit(0);
}

if (missing.length) {
  console.error(`Missing API key(s) for: ${missing.join(', ')}. Use eval:lira:offline for free contracts, or --dry-run to list provider settings without calls.`);
  process.exit(2);
}

if (!process.env.LIRA_PILOT_BUDGET_DB_PATH) {
  throw new Error('LIRA_PILOT_BUDGET_DB_PATH must name a persistent absolute budget database before provider evaluation');
}
for (const provider of providers) {
  const config = modelConfig(provider);
  prices(provider); // Refuse unknown or unpriced model overrides before any calls.
  if (provider === 'openai') assertTrustedLoopbackRelay(config.baseUrl);
  else if (config.baseUrl.replace(/\/+$/, '') !== 'https://api.deepseek.com') {
    throw new Error('DeepSeek evaluation endpoint must be api.deepseek.com');
  }
}

// These deterministic contracts must pass before spending on provider calls.
// They remain separate from the provider-scored prompts so free contracts can
// never inflate a provider's measured quality.
const offlineContracts = await runOfflineLiraContracts();
if (offlineContracts.passCount !== offlineContracts.total) {
  console.error(JSON.stringify(offlineContracts, null, 2));
  process.exit(1);
}
const reports: ProviderReport[] = [];
for (const provider of providers) reports.push(await runProvider(provider, repeat, selectedFixtures));

const finalLedger = await openProviderBudgetLedger(process.env.LIRA_PILOT_BUDGET_DB_PATH);
const comparisonBudget = finalLedger.snapshot('comparison');
finalLedger.close();

const report = {
  generatedAt: new Date().toISOString(),
  note: 'Synthetic catalogue only; this compares model behavior, not live catalog success or production approval. Actual provider usage and conservative reserved budget are separate; failed or unmetered calls fail model quality.',
  syntheticCatalog: true,
  repeat,
  selectedFixtures: selectedFixtures.map(({ id }) => id),
  comparisonBudget,
  offlineContracts,
  reports
};
const output = `${JSON.stringify(report, null, 2)}\n`;
const outputPath = argValue('out');
if (outputPath) {
  const absolute = resolve(outputPath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, output, 'utf8');
  console.log(`Wrote ${absolute}`);
} else {
  console.log(output);
}

if (reports.some((provider) => provider.passCount !== provider.total)) process.exitCode = 1;
