import { lstat, mkdir, open as openFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';

export type BudgetCampaign = 'comparison' | 'owner-trial';
export type BudgetProvider = 'openai' | 'deepseek';
export type ProviderCallAccounting = {
  modelCallCount: number;
  failedAttempts: number;
  usageResponseCount: number;
  inputTokens: number;
  outputTokens: number;
  reservedMicroUsd: number;
};
export type BudgetedProviderFetch = typeof fetch & {
  getBudgetAccounting: () => ProviderCallAccounting;
};

export const LIRA_BUDGET_LIMIT_MICRO_USD: Record<BudgetCampaign, number> = {
  comparison: 1_000_000,
  'owner-trial': 1_990_000
};

export const LIRA_BUDGET_CAMPAIGN_ID: Record<BudgetCampaign, string> = {
  comparison: 'lira-gpt6-luna-comparison-v1',
  'owner-trial': 'lira-gpt6-luna-owner-trial-v1'
};
export const LIRA_PILOT_PRODUCTION_BUDGET_PATH =
  '/opt/RadioAtlas/shared/data/lira-luna-budget-20261009.sqlite';

const MAX_BODY_BYTES = 128 * 1024;
const MAX_MESSAGES = 64;
const MAX_OUTPUT_TOKENS = 1000;
const INPUT_OVERHEAD_TOKENS = 4096;
const PER_MESSAGE_OVERHEAD_TOKENS = 128;

type Statement = {
  run: (...params: unknown[]) => { changes: number };
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
};

export type BudgetDatabase = {
  exec(sql: string): void;
  prepare(sql: string): Statement;
};

export class ProviderBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderBudgetError';
  }
}

const isCampaign = (value: string): value is BudgetCampaign =>
  value === 'comparison' || value === 'owner-trial';

export const createProviderBudgetLedger = (database: BudgetDatabase) => {
  database.exec(`CREATE TABLE IF NOT EXISTS lira_provider_budget (
    campaign TEXT PRIMARY KEY,
    limit_micro_usd INTEGER NOT NULL,
    reserved_micro_usd INTEGER NOT NULL DEFAULT 0,
    CHECK (limit_micro_usd > 0),
    CHECK (reserved_micro_usd >= 0 AND reserved_micro_usd <= limit_micro_usd)
  );`);

  const insert = database.prepare(
    'INSERT OR IGNORE INTO lira_provider_budget (campaign, limit_micro_usd, reserved_micro_usd) VALUES (?, ?, 0)'
  );
  for (const campaign of Object.keys(LIRA_BUDGET_CAMPAIGN_ID) as BudgetCampaign[]) {
    insert.run(LIRA_BUDGET_CAMPAIGN_ID[campaign], LIRA_BUDGET_LIMIT_MICRO_USD[campaign]);
    const row = database.prepare(
      'SELECT limit_micro_usd FROM lira_provider_budget WHERE campaign = ?'
    ).get(LIRA_BUDGET_CAMPAIGN_ID[campaign]);
    if (Number(row?.limit_micro_usd) !== LIRA_BUDGET_LIMIT_MICRO_USD[campaign]) {
      throw new ProviderBudgetError(`budget campaign configuration mismatch: ${campaign}`);
    }
  }

  return createLedgerOperations(database);
};

const createLedgerOperations = (database: BudgetDatabase) => ({
    reserve(campaign: BudgetCampaign, amountMicroUsd: number): number {
      if (!isCampaign(campaign) || !Number.isSafeInteger(amountMicroUsd) || amountMicroUsd <= 0) {
        throw new ProviderBudgetError('invalid provider budget reservation');
      }
      const key = LIRA_BUDGET_CAMPAIGN_ID[campaign];
      database.exec('BEGIN IMMEDIATE');
      try {
        const result = database.prepare(
          'UPDATE lira_provider_budget SET reserved_micro_usd = reserved_micro_usd + ? WHERE campaign = ? AND reserved_micro_usd <= limit_micro_usd - ?'
        ).run(amountMicroUsd, key, amountMicroUsd);
        if (result.changes !== 1) {
          throw new ProviderBudgetError(`provider budget exhausted: ${campaign}`);
        }
        const row = database.prepare(
          'SELECT reserved_micro_usd FROM lira_provider_budget WHERE campaign = ?'
        ).get(key);
        database.exec('COMMIT');
        return Number(row?.reserved_micro_usd);
      } catch (error) {
        try { database.exec('ROLLBACK'); } catch { /* transaction may already be closed */ }
        throw error;
      }
    },
    snapshot(campaign: BudgetCampaign) {
      const key = LIRA_BUDGET_CAMPAIGN_ID[campaign];
      const row = database.prepare(
        'SELECT reserved_micro_usd, limit_micro_usd FROM lira_provider_budget WHERE campaign = ?'
      ).get(key);
      if (!row) throw new ProviderBudgetError('provider budget ledger unavailable');
      return {
        campaign,
        reservedMicroUsd: Number(row.reserved_micro_usd),
        limitMicroUsd: Number(row.limit_micro_usd)
      };
    }
});

const validateExistingProviderBudgetLedger = (database: BudgetDatabase) => {
  database.exec('PRAGMA busy_timeout = 5000;');
  const table = database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'lira_provider_budget'"
  ).get();
  if (!table) throw new ProviderBudgetError('provider budget ledger table is missing');

  for (const campaign of Object.keys(LIRA_BUDGET_CAMPAIGN_ID) as BudgetCampaign[]) {
    const row = database.prepare(
      'SELECT limit_micro_usd, reserved_micro_usd FROM lira_provider_budget WHERE campaign = ?'
    ).get(LIRA_BUDGET_CAMPAIGN_ID[campaign]);
    const limit = Number(row?.limit_micro_usd);
    const reserved = Number(row?.reserved_micro_usd);
    if (
      !row || limit !== LIRA_BUDGET_LIMIT_MICRO_USD[campaign] ||
      !Number.isSafeInteger(reserved) || reserved < 0 || reserved > limit
    ) {
      throw new ProviderBudgetError(`budget campaign missing or invalid: ${campaign}`);
    }
  }
  return createLedgerOperations(database);
};

const sqliteDatabaseConstructor = async () => {
  const sqliteModuleName = 'node:sqlite';
  return await import(sqliteModuleName) as {
    DatabaseSync: new (path: string) => BudgetDatabase & { close(): void };
  };
};

export const initializeProviderBudgetLedger = async (databasePath: string) => {
  if (!databasePath || !isAbsolute(databasePath)) {
    throw new ProviderBudgetError('LIRA_PILOT_BUDGET_DB_PATH must be an absolute persistent path');
  }
  await mkdir(dirname(databasePath), { recursive: true });
  const created = await openFile(databasePath, 'wx', 0o600).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'EEXIST') throw new ProviderBudgetError('refusing to initialize an existing budget database');
    throw error;
  });
  await created.close();

  const sqlite = await sqliteDatabaseConstructor();
  const database = new sqlite.DatabaseSync(databasePath);
  try {
    database.exec('PRAGMA journal_mode = WAL;');
    const ledger = createProviderBudgetLedger(database);
    ledger.snapshot('comparison');
    ledger.snapshot('owner-trial');
    return { ...ledger, close: () => database.close() };
  } catch (error) {
    database.close();
    throw error;
  }
};

export const openProviderBudgetLedger = async (databasePath: string) => {
  if (!databasePath || !isAbsolute(databasePath)) {
    throw new ProviderBudgetError('LIRA_PILOT_BUDGET_DB_PATH must be an absolute persistent path');
  }
  const fileInfo = await lstat(databasePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') throw new ProviderBudgetError('provider budget database does not exist');
    throw error;
  });
  if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
    throw new ProviderBudgetError('provider budget path must be an existing regular file');
  }
  const sqlite = await sqliteDatabaseConstructor();
  const database = new sqlite.DatabaseSync(databasePath);
  try {
    const ledger = validateExistingProviderBudgetLedger(database);
    return { ...ledger, close: () => database.close() };
  } catch (error) {
    database.close();
    throw error;
  }
};

export const BUDGETED_MODEL_PRICING = {
  'gpt-6-luna': { input: 100_000, output: 500_000 },
  'deepseek-v4-flash': { input: 300_000, output: 1_200_000 },
  'deepseek-v4-pro': { input: 1_320_000, output: 3_960_000 }
};

export const estimateRequestReservationMicroUsd = (
  model: keyof typeof BUDGETED_MODEL_PRICING,
  bodyBytes: number,
  messageCount: number,
  maxOutputTokens: number
) => {
  const price = BUDGETED_MODEL_PRICING[model];
  const inputTokenUpperBound = bodyBytes + INPUT_OVERHEAD_TOKENS + messageCount * PER_MESSAGE_OVERHEAD_TOKENS;
  // Prices are micro-USD per million tokens. Round up so every reservation is
  // conservative, including fractional micro-USD amounts.
  return Math.ceil(
    (inputTokenUpperBound * price.input + maxOutputTokens * price.output) / 1_000_000
  );
};

const urlString = (input: string | URL | Request): string =>
  input instanceof Request ? input.url : String(input);

const normalizeBase = (baseUrl: string) => baseUrl.replace(/\/+$/, '');

export const assertTrustedLoopbackRelay = (baseUrl: string): string => {
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new ProviderBudgetError('invalid pilot relay URL'); }
  const loopback = url.hostname.toLowerCase() === '127.0.0.1';
  const relayPath = url.pathname.replace(/\/+$/, '');
  if (
    url.protocol !== 'http:' || !loopback || url.port !== '8399' || relayPath !== '/openai' ||
    url.username || url.password || url.search || url.hash
  ) {
    throw new ProviderBudgetError('pilot relay must be http://127.0.0.1:8399/openai');
  }
  return normalizeBase(url.toString());
};

const validMessages = (provider: BudgetProvider, body: Record<string, unknown>) => {
  const field = provider === 'openai' ? body.input : body.messages;
  if (!Array.isArray(field) || field.length === 0 || field.length > MAX_MESSAGES) return false;
  return field.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const message = item as Record<string, unknown>;
    const allowedRoles = provider === 'openai'
      ? ['developer', 'system', 'user', 'assistant']
      : ['system', 'user', 'assistant'];
    return Object.keys(message).every((key) => key === 'role' || key === 'content') &&
      allowedRoles.includes(String(message.role)) && typeof message.content === 'string';
  });
};

const onlyKeys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));

const validOpenAiEnvelope = (body: Record<string, unknown>) => {
  if (!onlyKeys(body, ['model', 'input', 'max_output_tokens', 'reasoning', 'text', 'safety_identifier', 'store'])) return false;
  if (body.store !== false) return false;
  const reasoning = body.reasoning;
  if (!reasoning || typeof reasoning !== 'object' || Array.isArray(reasoning)) return false;
  const reasoningFields = reasoning as Record<string, unknown>;
  if (!onlyKeys(reasoningFields, ['effort', 'context']) || reasoningFields.context !== 'current_turn') return false;
  if (!['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(String(reasoningFields.effort))) return false;
  const text = body.text;
  if (!text || typeof text !== 'object' || Array.isArray(text)) return false;
  const textFields = text as Record<string, unknown>;
  if (!onlyKeys(textFields, ['verbosity', 'format']) || textFields.verbosity !== 'low') return false;
  if (textFields.format !== undefined) {
    const format = textFields.format;
    if (!format || typeof format !== 'object' || Array.isArray(format)) return false;
    const fields = format as Record<string, unknown>;
    if (
      !onlyKeys(fields, ['type', 'name', 'strict', 'schema']) || fields.type !== 'json_schema' ||
      typeof fields.name !== 'string' || fields.name.length < 1 || fields.name.length > 80 ||
      typeof fields.strict !== 'boolean' || !fields.schema || typeof fields.schema !== 'object' || Array.isArray(fields.schema)
    ) return false;
  }
  if (body.safety_identifier !== undefined &&
    (typeof body.safety_identifier !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(body.safety_identifier))) return false;
  return true;
};

const validDeepseekEnvelope = (body: Record<string, unknown>) => {
  if (!onlyKeys(body, ['model', 'messages', 'temperature', 'max_tokens', 'thinking', 'reasoning_effort', 'response_format', 'user_id', 'stream'])) return false;
  const thinking = body.thinking;
  if (!thinking || typeof thinking !== 'object' || Array.isArray(thinking)) return false;
  const thinkingFields = thinking as Record<string, unknown>;
  if (!onlyKeys(thinkingFields, ['type']) || !['disabled', 'enabled'].includes(String(thinkingFields.type))) return false;
  if (body.reasoning_effort !== undefined && !['high', 'max'].includes(String(body.reasoning_effort))) return false;
  if (body.temperature !== undefined &&
    (typeof body.temperature !== 'number' || !Number.isFinite(body.temperature) || body.temperature < 0 || body.temperature > 2)) return false;
  if (body.response_format !== undefined) {
    const format = body.response_format;
    if (!format || typeof format !== 'object' || Array.isArray(format) || !onlyKeys(format as Record<string, unknown>, ['type']) || (format as Record<string, unknown>).type !== 'json_object') return false;
  }
  if (body.user_id !== undefined &&
    (typeof body.user_id !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(body.user_id))) return false;
  return true;
};

export const createBudgetedProviderFetch = (options: {
  provider: BudgetProvider;
  campaign: BudgetCampaign;
  baseUrl: string;
  ledger: ReturnType<typeof createProviderBudgetLedger>;
  fetch?: typeof fetch;
}): BudgetedProviderFetch => {
  const baseUrl = options.provider === 'openai'
    ? assertTrustedLoopbackRelay(options.baseUrl)
    : normalizeBase(options.baseUrl);
  if (options.provider === 'deepseek' && baseUrl !== 'https://api.deepseek.com') {
    throw new ProviderBudgetError('DeepSeek evaluation endpoint must be api.deepseek.com');
  }
  const endpoint = options.provider === 'openai'
    ? `${baseUrl}/responses`
    : `${baseUrl}/chat/completions`;
  const allowedModels = options.provider === 'openai'
    ? ['gpt-6-luna']
    : ['deepseek-v4-flash', 'deepseek-v4-pro'];
  const upstream = options.fetch || globalThis.fetch.bind(globalThis);
  const accounting: ProviderCallAccounting = {
    modelCallCount: 0,
    failedAttempts: 0,
    usageResponseCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    reservedMicroUsd: 0
  };

  const budgetedFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const requestUrl = new URL(urlString(input));
    if (requestUrl.toString() !== endpoint || String(init?.method || 'GET').toUpperCase() !== 'POST') {
      throw new ProviderBudgetError('provider request outside the fixed budgeted endpoint');
    }
    if (typeof init?.body !== 'string') throw new ProviderBudgetError('provider request body must be JSON text');
    const bodyBytes = Buffer.byteLength(init.body, 'utf8');
    if (bodyBytes > MAX_BODY_BYTES) throw new ProviderBudgetError('provider request exceeds 128 KiB');

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(init.body);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
      body = parsed as Record<string, unknown>;
    } catch {
      throw new ProviderBudgetError('provider request body is not valid JSON');
    }
    const tokenField = options.provider === 'openai' ? 'max_output_tokens' : 'max_tokens';
    const maxOutputTokens = body[tokenField];
    if (
      typeof body.model !== 'string' || !allowedModels.includes(body.model) ||
      !Number.isSafeInteger(maxOutputTokens) ||
      Number(maxOutputTokens) < 1 || Number(maxOutputTokens) > MAX_OUTPUT_TOKENS ||
      (options.provider === 'openai' ? body.stream !== undefined && body.stream !== false : body.stream !== false) ||
      (options.provider === 'openai' ? !validOpenAiEnvelope(body) : !validDeepseekEnvelope(body)) ||
      !validMessages(options.provider, body)
    ) {
      throw new ProviderBudgetError('provider request exceeds the fixed text-only pilot envelope');
    }

    const messageField = options.provider === 'openai' ? body.input : body.messages;
    const messageCount = (messageField as unknown[]).length;
    const reservation = estimateRequestReservationMicroUsd(
      body.model as keyof typeof BUDGETED_MODEL_PRICING,
      bodyBytes,
      messageCount,
      Number(maxOutputTokens)
    );
    options.ledger.reserve(options.campaign, reservation);
    accounting.reservedMicroUsd += reservation;
    accounting.modelCallCount += 1;
    try {
      const response = await upstream(input, init);
      if (!response.ok) {
        accounting.failedAttempts += 1;
      } else {
        try {
          const responseBody = await response.clone().json() as {
            usage?: Record<string, unknown>;
          };
          const inputTokens = options.provider === 'openai'
            ? responseBody.usage?.input_tokens
            : responseBody.usage?.prompt_tokens;
          const outputTokens = options.provider === 'openai'
            ? responseBody.usage?.output_tokens
            : responseBody.usage?.completion_tokens;
          if (
            Number.isSafeInteger(inputTokens) && Number(inputTokens) >= 0 &&
            Number.isSafeInteger(outputTokens) && Number(outputTokens) >= 0
          ) {
            accounting.usageResponseCount += 1;
            accounting.inputTokens += Number(inputTokens);
            accounting.outputTokens += Number(outputTokens);
          }
        } catch {
          // Missing/unreadable usage remains explicitly visible as a count mismatch.
        }
      }
      return response;
    } catch (error) {
      accounting.failedAttempts += 1;
      throw error;
    }
  }) as BudgetedProviderFetch;
  budgetedFetch.getBudgetAccounting = () => ({ ...accounting });
  return budgetedFetch;
};
