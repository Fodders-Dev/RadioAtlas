import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// T0.2c contract tests: the periodic reconcile sweep matches recent
// Stars transactions against pending billing_purchases rows and
// re-runs the webhook path in-process to grant entitlements when
// the bot's original forward dropped.
//
// All sweep ticks here go through POST /test/billing/trigger-reconcile
// with a canned `transactions` array and (where the backoff schedule
// matters) an overridden `now` epoch. The production setInterval is
// disabled via BILLING_RECONCILE_ENABLED=0 so the in-process timer
// doesn't fire spurious real-Telegram calls during the test run.

const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const port = 35600 + Math.floor(Math.random() * 400);
const baseUrl = `http://127.0.0.1:${port}`;
const internalToken = 'billing-reconcile-test-token';

let apiProcess: ChildProcessWithoutNullStreams | null = null;
let storeDir = '';
let stderrCapture = '';
let stdoutCapture = '';

type SeedConflictPayload = {
  token: string;
  currentAccountId: string;
};

type SeedPurchasePayload = { purchaseId: string };

type ReconcileResult = {
  processedCount: number;
  grantedCount: number;
  deadLetteredCount: number;
};

type InspectPayload = {
  row: {
    id: string;
    status: string;
    reconcileAttempts: number;
    lastReconcileAt: number | null;
    createdAt: number;
  } | null;
};

type MePayload = {
  profile: {
    id: string;
    isPremium: boolean;
    premiumStatus: string;
    entitlements: string[];
  };
  auditTrail: Array<{
    id: string;
    type: string;
    payload?: { purchaseId?: string };
  }>;
};

type ErrorPayload = { error: string };

const waitForServer = async () => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // not ready yet
    }
    await delay(200);
  }
  throw new Error('API server did not start in time');
};

test.before(async () => {
  storeDir = await mkdtemp(join(tmpdir(), 'radioatlas-reconcile-test-'));
  apiProcess = spawn(process.execPath, ['--import', 'tsx/esm', './src/index.ts'], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(port),
      ENABLE_TEST_AUTH_FIXTURES: '1',
      EXTRACTOR_URL: '',
      // Disable the production setInterval — tests trigger sweeps
      // explicitly via /test/billing/trigger-reconcile so the cadence
      // and the Telegram-side response stay deterministic.
      BILLING_RECONCILE_ENABLED: '0',
      TELEGRAM_BOT_TOKEN: 'fake-bot-token-for-reconcile-tests',
      BOT_TOKEN: 'fake-bot-token-for-reconcile-tests',
      GOOGLE_CLIENT_ID: '',
      VK_CLIENT_ID: '',
      VK_CLIENT_SECRET: '',
      VK_REDIRECT_URI: '',
      WEBAPP_URL: 'https://radioatlas.test',
      ACCOUNT_STORE_PATH: join(storeDir, 'account-store.sqlite'),
      INTERNAL_WEBHOOK_TOKEN: internalToken,
      ALLOWED_ORIGINS: 'http://127.0.0.1,http://localhost'
    }
  });

  apiProcess.stderr.on('data', (chunk) => {
    stderrCapture += chunk.toString();
  });
  apiProcess.stdout.on('data', (chunk) => {
    stdoutCapture += chunk.toString();
  });
  apiProcess.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(stderrCapture);
    }
  });

  await waitForServer();
});

test.after(async () => {
  if (!apiProcess || apiProcess.killed) return;
  apiProcess.kill('SIGTERM');
  await delay(300);
  if (!apiProcess.killed) {
    apiProcess.kill('SIGKILL');
  }
});

const postJson = async <T,>(
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  const payload = (await response.json()) as T;
  return { response, body: payload };
};

const getJson = async <T,>(path: string) => {
  const response = await fetch(`${baseUrl}${path}`);
  const payload = (await response.json()) as T;
  return { response, body: payload };
};

const seedAccount = async () => {
  const { body } = await postJson<SeedConflictPayload>('/test/auth/seed-conflict', {
    mergeStrategy: 'combine'
  });
  return body;
};

const seedPurchase = async (accountId: string, productId = 'premium-month') => {
  const { body } = await postJson<SeedPurchasePayload>('/test/billing/seed-purchase', {
    accountId,
    productId
  });
  return body.purchaseId;
};

const inspectPurchase = async (purchaseId: string) => {
  const { body } = await getJson<InspectPayload>(
    `/test/billing/inspect/${encodeURIComponent(purchaseId)}`
  );
  return body.row;
};

const fetchMe = async (token: string) => {
  const response = await fetch(`${baseUrl}/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return (await response.json()) as MePayload;
};

const matchingTransaction = (purchaseId: string, chargeId = 'charge-abc') => ({
  id: chargeId,
  amount: 100,
  date: Math.floor(Date.now() / 1000),
  source: {
    type: 'user',
    transaction_type: 'invoice_payment',
    invoice_payload: purchaseId
  }
});

const triggerReconcile = async (body: {
  transactions: unknown[];
  now?: number;
  horizonMs?: number;
}) => {
  const { body: result } = await postJson<ReconcileResult>(
    '/test/billing/trigger-reconcile',
    body
  );
  return result;
};

test('(1) schema migration adds reconcile_attempts + last_reconcile_at to billing_purchases', async () => {
  const seed = await seedAccount();
  const purchaseId = await seedPurchase(seed.currentAccountId);
  const row = await inspectPurchase(purchaseId);
  assert.ok(row, 'seed-purchase must produce an inspectable row');
  if (!row) return;
  // Both columns exist (default values from the migration) — the
  // PRAGMA-detect ALTER ran cleanly on a fresh DB.
  assert.equal(row.reconcileAttempts, 0);
  assert.equal(row.lastReconcileAt, null);
  assert.equal(row.status, 'pending');
});

test('(2) pending row + matching transaction → status flips to paid, entitlement granted, audit event recorded', async () => {
  const seed = await seedAccount();
  const purchaseId = await seedPurchase(seed.currentAccountId, 'premium-month');

  // Per-row assertions only — the test process is shared so prior
  // tests' pending rows may also be eligible in this sweep; aggregate
  // counts would conflate them. The specific purchaseId either
  // flipped to paid + got an audit event, or it didn't.
  await triggerReconcile({
    transactions: [matchingTransaction(purchaseId, 'charge-grant')]
  });

  const row = await inspectPurchase(purchaseId);
  assert.equal(row?.status, 'paid');

  const me = await fetchMe(seed.token);
  assert.equal(me.profile.premiumStatus, 'premium');
  const confirmed = me.auditTrail.filter(
    (event) =>
      event.type === 'billing_purchase_confirmed' &&
      event.payload?.purchaseId === purchaseId
  );
  assert.equal(confirmed.length, 1, 'sweep grants exactly one audit event');
});

test('(3) pending row + NO matching transaction → status stays pending, attempts=1, last_reconcile_at set', async () => {
  const seed = await seedAccount();
  const purchaseId = await seedPurchase(seed.currentAccountId);

  await triggerReconcile({ transactions: [] });

  const row = await inspectPurchase(purchaseId);
  assert.ok(row);
  if (!row) return;
  assert.equal(row.status, 'pending');
  assert.equal(row.reconcileAttempts, 1);
  assert.ok(
    row.lastReconcileAt && row.lastReconcileAt > 0,
    'last_reconcile_at is set to the sweep tick timestamp'
  );
});

test('(4) backoff schedule lock-in: VI-3 — exactly 3 attempts in the first 10 minutes (T=2, T=4, T=8)', async () => {
  const seed = await seedAccount();
  const purchaseId = await seedPurchase(seed.currentAccountId);

  // Virtual time anchored at row creation = t=0. Sweep ticks at
  // every 2-minute mark; per the docstring on RECONCILE_BACKOFF_MS,
  // attempts fire at t=2min, 4min, 8min (NOT at t=6min — backoff[2]
  // = 4m forces the gap, 4+4=8>6). At t=10min, attempts is still
  // gated by backoff[3]=8m (8+8=16>10) so no fire.
  const MIN = 60_000;
  const horizonMs = 48 * 60 * MIN; // very wide so created_at isn't filtered

  // Per-row state assertions only — aggregate counts would conflate
  // pending rows seeded by other tests in the shared process.

  // T=2min — first sweep tick, last_reconcile_at IS NULL → eligible.
  await triggerReconcile({ transactions: [], now: 2 * MIN, horizonMs });
  let row = await inspectPurchase(purchaseId);
  assert.equal(row?.reconcileAttempts, 1, 'fire at t=2min');
  assert.equal(row?.lastReconcileAt, 2 * MIN);

  // T=4min — eligible (2 + backoff[1]=2 ≤ 4).
  await triggerReconcile({ transactions: [], now: 4 * MIN, horizonMs });
  row = await inspectPurchase(purchaseId);
  assert.equal(row?.reconcileAttempts, 2, 'fire at t=4min');
  assert.equal(row?.lastReconcileAt, 4 * MIN);

  // T=6min — NOT eligible (4 + backoff[2]=4 > 6).
  await triggerReconcile({ transactions: [], now: 6 * MIN, horizonMs });
  row = await inspectPurchase(purchaseId);
  assert.equal(row?.reconcileAttempts, 2, 'skip at t=6min — backoff[2]=4m keeps row gated');
  assert.equal(row?.lastReconcileAt, 4 * MIN, 'last_reconcile_at unchanged on skip');

  // T=8min — eligible (4 + 4 ≤ 8).
  await triggerReconcile({ transactions: [], now: 8 * MIN, horizonMs });
  row = await inspectPurchase(purchaseId);
  assert.equal(row?.reconcileAttempts, 3, 'fire at t=8min');
  assert.equal(row?.lastReconcileAt, 8 * MIN);

  // T=10min — NOT eligible (8 + backoff[3]=8 > 10).
  await triggerReconcile({ transactions: [], now: 10 * MIN, horizonMs });
  row = await inspectPurchase(purchaseId);
  assert.equal(
    row?.reconcileAttempts,
    3,
    'EXACTLY 3 attempts in the first 10 minutes — VI-3 lock-in'
  );
  assert.equal(row?.lastReconcileAt, 8 * MIN);
});

test('(5) dead-letter on 5th attempt: log fires exactly once, subsequent ticks skip the row', async () => {
  const seed = await seedAccount();
  const purchaseId = await seedPurchase(seed.currentAccountId);

  const MIN = 60_000;
  const horizonMs = 48 * 60 * MIN;

  // Run the full backoff schedule until attempts crosses 4→5.
  // Schedule (full): T=2, T=4, T=8, T=16, T=32 → attempts 1, 2, 3, 4, 5.
  // The 5th attempt at T=32min produces the dead-letter log.
  const stderrLengthBefore = stderrCapture.length;

  for (const t of [2, 4, 8, 16, 32]) {
    await triggerReconcile({
      transactions: [],
      now: t * MIN,
      horizonMs
    });
  }

  let row = await inspectPurchase(purchaseId);
  assert.equal(row?.reconcileAttempts, 5, 'attempts reaches the max');
  assert.equal(row?.status, 'pending', 'row stays pending — we never confirm a non-payment');

  // Dead-letter log line was written exactly once (in the 5th tick).
  const stderrSlice = stderrCapture.slice(stderrLengthBefore);
  const deadLetterLines = stderrSlice
    .split('\n')
    .filter((line) => line.includes('billing_reconcile_dead_letter'))
    .filter((line) => line.includes(purchaseId));
  assert.equal(deadLetterLines.length, 1, 'dead-letter log line written exactly once');
  const deadLetterLine = deadLetterLines[0];
  assert.ok(deadLetterLine, 'dead-letter log line present');
  const parsed = JSON.parse(deadLetterLine) as Record<string, unknown>;
  assert.equal(parsed.event, 'billing_reconcile_dead_letter');
  assert.equal(parsed.purchaseId, purchaseId);
  assert.equal(parsed.attempts, 5);
  assert.equal(parsed.lastError, 'no-matching-telegram-transaction');

  // Subsequent sweep ticks skip the row (filtered by attempts<5 in the
  // SELECT) AND do NOT re-emit the dead-letter line. Run a 6th tick
  // well past the backoff window and verify the specific purchase's
  // attempts counter stays at 5 AND no new dead-letter log line was
  // written for THIS purchaseId.
  const stderrLengthAfterDeadLetter = stderrCapture.length;
  await triggerReconcile({ transactions: [], now: 64 * MIN, horizonMs });
  const followupSlice = stderrCapture.slice(stderrLengthAfterDeadLetter);
  const followupDeadLetters = followupSlice
    .split('\n')
    .filter((line) => line.includes('billing_reconcile_dead_letter'))
    .filter((line) => line.includes(purchaseId));
  assert.equal(followupDeadLetters.length, 0, 'no repeat dead-letter on subsequent ticks');

  row = await inspectPurchase(purchaseId);
  assert.equal(row?.reconcileAttempts, 5, 'attempts NOT incremented on dead-letter skip');
});

test('(6) idempotency (VI-1 + T0.2 contract): two consecutive ticks both matching → single audit event', async () => {
  const seed = await seedAccount();
  const purchaseId = await seedPurchase(seed.currentAccountId, 'premium-month');
  const transaction = matchingTransaction(purchaseId, 'charge-idem');

  // Tick 1 — row is pending, matched → confirmBillingPurchase fires,
  // audit event written, row flips to paid.
  await triggerReconcile({ transactions: [transaction] });
  let row = await inspectPurchase(purchaseId);
  assert.equal(row?.status, 'paid', 'tick 1 flipped to paid');

  // Tick 2 — same matching transaction. The row is now status='paid'
  // so the SELECT filter `status = 'pending'` excludes it; sweep
  // never reaches the in-process confirmBillingPurchase call. Even
  // if it did, the atomic conditional UPDATE in billingService.ts
  // would protect against double-grant. Test the OBSERVABLE
  // invariant: audit trail has exactly ONE billing_purchase_confirmed
  // for this purchaseId after both ticks.
  await triggerReconcile({ transactions: [transaction] });
  row = await inspectPurchase(purchaseId);
  assert.equal(row?.status, 'paid', 'tick 2 leaves the paid row untouched');

  const me = await fetchMe(seed.token);
  const confirmed = me.auditTrail.filter(
    (event) =>
      event.type === 'billing_purchase_confirmed' &&
      event.payload?.purchaseId === purchaseId
  );
  assert.equal(
    confirmed.length,
    1,
    'exactly one billing_purchase_confirmed audit event across both sweep ticks'
  );
});

test('(7) 24h horizon: pending row 25h old → sweep skips it regardless of matching transaction', async () => {
  const seed = await seedAccount();
  const purchaseId = await seedPurchase(seed.currentAccountId);
  const row = await inspectPurchase(purchaseId);
  assert.ok(row);
  if (!row) return;
  const HOUR = 60 * 60 * 1000;
  // Override `now` to 26h after the real created_at; horizon stays
  // at default 24h. cutoff = now - 24h = createdAt + 2h → row's
  // created_at < cutoff → filtered out of the SELECT. Even with a
  // matching transaction in the canned response, the sweep never
  // sees this row.
  await triggerReconcile({
    transactions: [matchingTransaction(purchaseId)],
    now: row.createdAt + 26 * HOUR
  });
  const after = await inspectPurchase(purchaseId);
  assert.equal(after?.status, 'pending', 'unchanged — beyond horizon, not processed');
  assert.equal(after?.reconcileAttempts, 0, 'attempts NOT incremented for filtered row');
});

test('(8) BILLING_RECONCILE_ENABLED=0 boot: setInterval does not start, "sweep started" log absent', async () => {
  // The harness boots the API with BILLING_RECONCILE_ENABLED=0 (see
  // test.before above), so the production setInterval never started.
  // Assert the boot log line "Billing reconciliation sweep started"
  // is absent in this run's stdout. (The fixture endpoint at
  // /test/billing/trigger-reconcile still works — proven by tests 2-7
  // running successfully above.)
  assert.ok(
    !stdoutCapture.includes('Billing reconciliation sweep started'),
    'sweep boot-log line must NOT appear when BILLING_RECONCILE_ENABLED=0'
  );
});
