import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import {
  createBudgetedProviderFetch,
  createProviderBudgetLedger,
  estimateRequestReservationMicroUsd,
  initializeProviderBudgetLedger,
  LIRA_BUDGET_LIMIT_MICRO_USD,
  LIRA_PILOT_PRODUCTION_BUDGET_PATH,
  openProviderBudgetLedger,
  ProviderBudgetError
} from '../src/ai/providerBudget.js';

const payload = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  model: 'gpt-6-luna',
  input: [{ role: 'user', content: 'Привет, Лира.' }],
  max_output_tokens: 1000,
  reasoning: { effort: 'low', context: 'current_turn' },
  text: { verbosity: 'low' },
  store: false,
  ...overrides
});

test('production pilot budget location is pinned outside versioned releases', () => {
  assert.equal(LIRA_PILOT_PRODUCTION_BUDGET_PATH, '/opt/RadioAtlas/shared/data/lira-luna-budget-20261009.sqlite');
});

test('budget ledger persists fixed independent campaign reservations across reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lira-budget-'));
  const databasePath = join(directory, 'budget.sqlite');
  try {
    const first = await initializeProviderBudgetLedger(databasePath);
    first.reserve('comparison', 1234);
    first.reserve('owner-trial', 5678);
    first.close();

    const reopened = await openProviderBudgetLedger(databasePath);
    assert.deepEqual(reopened.snapshot('comparison'), {
      campaign: 'comparison', reservedMicroUsd: 1234, limitMicroUsd: 1_000_000
    });
    assert.deepEqual(reopened.snapshot('owner-trial'), {
      campaign: 'owner-trial', reservedMicroUsd: 5678, limitMicroUsd: 1_990_000
    });
    reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('runtime open-existing refuses missing databases without creating them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lira-budget-missing-'));
  const databasePath = join(directory, 'missing.sqlite');
  try {
    await assert.rejects(openProviderBudgetLedger(databasePath), ProviderBudgetError);
    await assert.rejects(import('node:fs/promises').then(({ stat }) => stat(databasePath)), { code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('open-existing rejects missing campaign rows and never repopulates them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lira-budget-row-'));
  const databasePath = join(directory, 'budget.sqlite');
  const database = new DatabaseSync(databasePath);
  try {
    createProviderBudgetLedger(database);
    database.prepare('DELETE FROM lira_provider_budget WHERE campaign = ?')
      .run('lira-gpt6-luna-owner-trial-v1');
  } finally {
    database.close();
  }
  try {
    await assert.rejects(openProviderBudgetLedger(databasePath), ProviderBudgetError);
    const check = new DatabaseSync(databasePath);
    try {
      assert.equal(check.prepare('SELECT COUNT(*) AS count FROM lira_provider_budget').get()?.count, 1);
    } finally {
      check.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('one-time initializer creates a fresh budget and refuses an existing filename without reset', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lira-budget-init-'));
  const databasePath = join(directory, 'budget.sqlite');
  try {
    const first = await initializeProviderBudgetLedger(databasePath);
    first.reserve('comparison', 1234);
    first.close();
    await assert.rejects(initializeProviderBudgetLedger(databasePath), ProviderBudgetError);
    const reopened = await openProviderBudgetLedger(databasePath);
    assert.equal(reopened.snapshot('comparison').reservedMicroUsd, 1234);
    reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('budget reservation is atomic at the campaign ceiling and failure does not alter it', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const ledger = createProviderBudgetLedger(database);
    ledger.reserve('comparison', LIRA_BUDGET_LIMIT_MICRO_USD.comparison - 1);
    assert.throws(() => ledger.reserve('comparison', 2), ProviderBudgetError);
    assert.equal(ledger.snapshot('comparison').reservedMicroUsd, 999_999);
    ledger.reserve('owner-trial', 1);
    assert.equal(ledger.snapshot('owner-trial').reservedMicroUsd, 1);
  } finally {
    database.close();
  }
});

test('separate workers cannot reserve beyond one persisted comparison campaign cap', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lira-budget-race-'));
  const databasePath = join(directory, 'budget.sqlite');
  const workerSource = `
    const { parentPort, workerData } = require('node:worker_threads');
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(workerData.databasePath);
    db.exec('PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE');
    try {
      const result = db.prepare('UPDATE lira_provider_budget SET reserved_micro_usd = reserved_micro_usd + 300000 WHERE campaign = ? AND reserved_micro_usd <= limit_micro_usd - 300000')
        .run('lira-gpt6-luna-comparison-v1');
      db.exec('COMMIT');
      parentPort.postMessage(result.changes === 1 ? 'reserved' : 'exhausted');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      parentPort.postMessage('error:' + String(error && error.code || 'unknown'));
    } finally { db.close(); }
  `;
  try {
    const initial = await initializeProviderBudgetLedger(databasePath);
    initial.close();
    const results = await Promise.all(Array.from({ length: 4 }, () => new Promise<string>((resolve, reject) => {
      const worker = new Worker(workerSource, { eval: true, workerData: { databasePath } });
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', (code) => { if (code !== 0) reject(new Error(`budget worker exit ${code}`)); });
    })));
    assert.equal(results.filter((result) => result === 'reserved').length, 3);
    assert.equal(results.filter((result) => result === 'exhausted').length, 1);
    const final = await openProviderBudgetLedger(databasePath);
    assert.equal(final.snapshot('comparison').reservedMicroUsd, 900_000);
    final.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('reservation covers the byte upper-bound, protocol overhead, and output at exact model prices', () => {
  const luna = estimateRequestReservationMicroUsd('gpt-6-luna', 10_000, 4, 1000);
  const flash = estimateRequestReservationMicroUsd('deepseek-v4-flash', 10_000, 4, 1000);
  const pro = estimateRequestReservationMicroUsd('deepseek-v4-pro', 10_000, 4, 1000);
  assert.ok(luna > 0 && luna < 20_000);
  assert.ok(flash > luna && flash < pro);
  assert.ok(estimateRequestReservationMicroUsd('gpt-6-luna', 128 * 1024, 64, 1000) <= 20_000);
  assert.ok(estimateRequestReservationMicroUsd('deepseek-v4-flash', 128 * 1024, 64, 1000) <= 50_000);
  assert.ok(estimateRequestReservationMicroUsd('deepseek-v4-pro', 128 * 1024, 64, 1000) > 180_000);
});

test('budgeted Luna fetch reserves before upstream and rejects invalid or out-of-envelope requests', async () => {
  const database = new DatabaseSync(':memory:');
  let calls = 0;
  const upstream = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ usage: { input_tokens: 3, output_tokens: 2 } }));
  }) as typeof fetch;
  try {
    const ledger = createProviderBudgetLedger(database);
    const fetchImpl = createBudgetedProviderFetch({
      provider: 'openai', campaign: 'comparison',
      baseUrl: 'http://127.0.0.1:8399/openai', ledger, fetch: upstream
    });
    const post = (body: string, url = 'http://127.0.0.1:8399/openai/responses') =>
      fetchImpl(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });

    await post(payload());
    assert.equal(calls, 1);
    const reservedAfterValid = ledger.snapshot('comparison').reservedMicroUsd;
    assert.ok(reservedAfterValid > 0);
    assert.deepEqual(fetchImpl.getBudgetAccounting(), {
      modelCallCount: 1, failedAttempts: 0, usageResponseCount: 1,
      inputTokens: 3, outputTokens: 2, reservedMicroUsd: reservedAfterValid
    });

    await assert.rejects(post('{'), ProviderBudgetError);
    await assert.rejects(post(payload({ model: 'gpt-5.6-luna' })), ProviderBudgetError);
    await assert.rejects(post(payload({ max_output_tokens: 1001 })), ProviderBudgetError);
    await assert.rejects(post(payload({ stream: true })), ProviderBudgetError);
    await assert.rejects(post(payload({ store: true })), ProviderBudgetError);
    await assert.rejects(post(payload({ previous_response_id: 'resp_unsafe' })), ProviderBudgetError);
    await assert.rejects(post(payload({ input: [{ role: 'user', content: [{ type: 'input_image' }] }] })), ProviderBudgetError);
    await assert.rejects(post(payload(), 'https://api.openai.com/v1/responses'), ProviderBudgetError);
    await assert.rejects(post(payload({ input: [{ role: 'user', content: 'x'.repeat(128 * 1024) }] })), ProviderBudgetError);
    assert.equal(calls, 1);
    assert.equal(ledger.snapshot('comparison').reservedMicroUsd, reservedAfterValid);
  } finally {
    database.close();
  }
});

test('relay validation permits only explicit HTTP loopback endpoints', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const ledger = createProviderBudgetLedger(database);
    assert.throws(() => createBudgetedProviderFetch({
      provider: 'openai', campaign: 'owner-trial', baseUrl: 'https://api.openai.com/v1',
      ledger, fetch: globalThis.fetch
    }), ProviderBudgetError);
    assert.throws(() => createBudgetedProviderFetch({
      provider: 'openai', campaign: 'owner-trial', baseUrl: 'http://127.0.0.1:8399/v1',
      ledger, fetch: globalThis.fetch
    }), ProviderBudgetError);
    assert.throws(() => createBudgetedProviderFetch({
      provider: 'openai', campaign: 'owner-trial', baseUrl: 'http://127.0.0.1:8399//openai',
      ledger, fetch: globalThis.fetch
    }), ProviderBudgetError);
    assert.throws(() => createBudgetedProviderFetch({
      provider: 'openai', campaign: 'owner-trial', baseUrl: 'http://127.0.0.1:8398/openai',
      ledger, fetch: globalThis.fetch
    }), ProviderBudgetError);
    assert.throws(() => createBudgetedProviderFetch({
      provider: 'deepseek', campaign: 'comparison', baseUrl: 'http://127.0.0.1:8399',
      ledger, fetch: globalThis.fetch
    }), ProviderBudgetError);
  } finally {
    database.close();
  }
});

test('DeepSeek Pro reserves at its own peak price and does not refund unknown network failure', async () => {
  const database = new DatabaseSync(':memory:');
  try {
    const ledger = createProviderBudgetLedger(database);
    const fetchImpl = createBudgetedProviderFetch({
      provider: 'deepseek', campaign: 'comparison', baseUrl: 'https://api.deepseek.com', ledger,
      fetch: (async () => { throw new Error('network unavailable'); }) as typeof fetch
    });
    const body = JSON.stringify({
      model: 'deepseek-v4-pro',
      messages: [{ role: 'user', content: 'Привет' }],
      max_tokens: 1000,
      thinking: { type: 'disabled' },
      stream: false
    });
    await assert.rejects(fetchImpl('https://api.deepseek.com/chat/completions', { method: 'POST', body }));
    const accounting = fetchImpl.getBudgetAccounting();
    assert.equal(accounting.modelCallCount, 1);
    assert.equal(accounting.failedAttempts, 1);
    assert.equal(accounting.usageResponseCount, 0);
    assert.equal(ledger.snapshot('comparison').reservedMicroUsd, accounting.reservedMicroUsd);
    assert.ok(accounting.reservedMicroUsd > estimateRequestReservationMicroUsd('deepseek-v4-flash', Buffer.byteLength(body), 1, 1000));
  } finally {
    database.close();
  }
});
