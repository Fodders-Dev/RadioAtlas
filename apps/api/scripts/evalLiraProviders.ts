import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runLiraAgent } from '../src/ai/agentRunner.js';
import { CONTRACT_FIXTURES, createEvalTools, runOfflineLiraContracts } from './liraEvalContracts.js';
import type {
  AiModelConfig,
  AiModelProvider,
  AssistantAction,
  ChatInput,
  ChatResult
} from '../src/ai/types.js';

type EvalFixture = {
  id: string;
  input: ChatInput;
  expectedActions: AssistantAction['kind'][];
  minStations: number;
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
  estimatedUncachedUsd: number;
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
  medianDurationMs: number;
  promptTokens: number;
  completionTokens: number;
  estimatedUncachedUsd: number;
  runs: EvalRun[];
};

const PRICE_SOURCES = {
  deepseek: 'https://api-docs.deepseek.com/quick_start/pricing/',
  openai: 'https://openai.com/index/advancing-the-price-performance-frontier-with-gpt-5-6/'
} as const;

const FIXTURES: EvalFixture[] = [
  {
    id: 'evening-jazz',
    input: { userMessage: 'Посоветуй уютный вечерний джаз', surface: 'miniapp', locale: 'ru' },
    expectedActions: ['open-station'],
    minStations: 1
  },
  {
    id: 'play-electronic',
    input: { userMessage: 'Включи энергичный электро-микс, чтобы встряхнуться', surface: 'miniapp', locale: 'ru' },
    expectedActions: ['play'],
    minStations: 1
  },
  {
    id: 'focus-instrumental',
    input: { userMessage: 'Нужен ровный фон для работы — без слов и сюрпризов', surface: 'miniapp', locale: 'ru' },
    expectedActions: ['open-station'],
    minStations: 1
  },
  {
    id: 'cultural-vibe',
    input: { userMessage: 'Подбери радио в духе GTA Vice City', surface: 'miniapp', locale: 'ru' },
    expectedActions: ['open-station'],
    minStations: 1
  },
  {
    id: 'artist-reference',
    input: { userMessage: 'Что-то в стиле Robert Miles', surface: 'miniapp', locale: 'ru' },
    expectedActions: ['open-station'],
    minStations: 1
  },
  {
    id: 'music-conversation',
    input: { userMessage: 'Почему людям так нравится джаз?', surface: 'miniapp', locale: 'ru' },
    expectedActions: ['none'],
    minStations: 0
  }
];

const argValue = (name: string) => {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
};

const hasFlag = (name: string) => process.argv.slice(2).includes(`--${name}`);

const numberEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const evalTools = createEvalTools();

const modelConfig = (provider: AiModelProvider): AiModelConfig =>
  provider === 'openai'
    ? {
        provider,
        enabled: true,
        apiKey: process.env.OPENAI_API_KEY || '',
        baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        model: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
        maxOutputTokens: Math.max(64, Number(process.env.AI_MAX_OUTPUT_TOKENS) || 1000),
        timeoutSec: Math.max(1, Number(process.env.AI_TIMEOUT_SEC) || 20),
        reasoningEffort: 'low'
      }
    : {
        provider,
        enabled: true,
        apiKey: process.env.DEEPSEEK_API_KEY || '',
        baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
        model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
        maxOutputTokens: Math.max(64, Number(process.env.AI_MAX_OUTPUT_TOKENS) || 1000),
        timeoutSec: Math.max(1, Number(process.env.AI_TIMEOUT_SEC) || 20),
        reasoningEffort: 'none'
      };

const prices = (provider: AiModelProvider) =>
  provider === 'openai'
    ? {
        input: numberEnv('LIRA_EVAL_OPENAI_INPUT_USD_PER_MTOK', 0.2),
        output: numberEnv('LIRA_EVAL_OPENAI_OUTPUT_USD_PER_MTOK', 1.2)
      }
    : {
        input: numberEnv('LIRA_EVAL_DEEPSEEK_INPUT_USD_PER_MTOK', 0.14),
        output: numberEnv('LIRA_EVAL_DEEPSEEK_OUTPUT_USD_PER_MTOK', 0.28)
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
  price: { input: number; output: number }
): EvalRun => {
  const action = result.actions[0]?.kind || 'none';
  const failures: string[] = [];
  if (!result.reply.trim()) failures.push('reply_empty');
  if (!fixture.expectedActions.includes(action)) failures.push(`unexpected_action:${action}`);
  if (result.stations.length < fixture.minStations) failures.push('station_count_below_minimum');
  if (!result.agentRun?.verifierPassed) failures.push('verifier_failed');
  if (result.agentRun && result.agentRun.steps > 4) failures.push('step_limit_exceeded');
  if (result.agentRun && result.agentRun.toolCalls.length > 6) failures.push('tool_limit_exceeded');
  const promptTokens = result.usage?.prompt || 0;
  const completionTokens = result.usage?.completion || 0;
  const estimatedUncachedUsd =
    (promptTokens * price.input + completionTokens * price.output) / 1_000_000;
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
    estimatedUncachedUsd: Number(estimatedUncachedUsd.toFixed(8))
  };
};

const runProvider = async (
  provider: AiModelProvider,
  repeat: number
): Promise<ProviderReport> => {
  const model = modelConfig(provider);
  const price = prices(provider);
  const runs: EvalRun[] = [];
  for (let iteration = 0; iteration < repeat; iteration += 1) {
    for (const fixture of FIXTURES) {
      const result = await runLiraAgent(fixture.input, {
        model,
        tools: evalTools,
        musicServices: [],
        fetch: globalThis.fetch,
        log: () => {},
        now: () => Date.UTC(2026, 7, 13, 12, iteration),
        safetyIdentifier: 'lira:provider-eval'
      });
      runs.push(evaluateResult(fixture, result, price));
    }
  }
  const passCount = runs.filter((run) => run.passed).length;
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
    medianDurationMs: median(runs.map((run) => run.durationMs)),
    promptTokens,
    completionTokens,
    estimatedUncachedUsd: Number(
      runs.reduce((sum, run) => sum + run.estimatedUncachedUsd, 0).toFixed(8)
    ),
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
        fixtures: FIXTURES.map(({ id, input, expectedActions, minStations }) => ({
          id,
          prompt: input.userMessage,
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

// These deterministic contracts must pass before spending on provider calls.
// They remain separate from the six provider-scored prompts: otherwise adding
// free, deterministic wins would inflate a model's apparent quality.
const offlineContracts = await runOfflineLiraContracts();
if (offlineContracts.passCount !== offlineContracts.total) {
  console.error(JSON.stringify(offlineContracts, null, 2));
  process.exit(1);
}
const reports: ProviderReport[] = [];
for (const provider of providers) reports.push(await runProvider(provider, repeat));

const report = {
  generatedAt: new Date().toISOString(),
  note: 'Cost is an uncached estimate. Review reply quality manually before changing production.',
  repeat,
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
