// T0.2c — billing reconciliation sweep.
//
// Why this exists:
// Telegram delivers `successful_payment` once over the bot's long-poll
// connection. If the bot's webhook forward to /billing/telegram/webhook
// fails (env drift, network, API down), the update is dropped forever
// and the user's money is gone with the row stuck in `pending`. T0.2b
// added an apology reply promising "до 10 минут"; T0.2c is what makes
// that promise real.
//
// Architecture:
// Periodic in-process setInterval (wired in apps/api/src/index.ts boot,
// disable via BILLING_RECONCILE_ENABLED=0). Each tick:
//   1. ONE fetch to Telegram getStarTransactions (recent 100 Stars
//      transactions). Pagination is T0.2d backlog when billing volume
//      exceeds 100/24h.
//   2. Build a Map<payload, chargeId> filtered strictly to
//      transactions of type=user, transaction_type=invoice_payment, and
//      with a string invoice_payload. The filter precision matters:
//      gift_purchase / premium_purchase share the StarTransaction shape
//      but their invoice_payload is undefined, which would otherwise
//      false-match a pending row whose payload happens to be empty.
//   3. SELECT eligible pending rows (status=pending, within 24h horizon,
//      reconcile_attempts < 5, eligible per the backoff schedule).
//   4. For each row: if Telegram has a matching transaction, call the
//      existing confirmBillingPurchase service function in-process
//      (idempotent via atomic conditional UPDATE in billingService.ts).
//      Otherwise increment reconcile_attempts and persist
//      last_reconcile_at. When attempts crosses 4→5, emit a single
//      structured dead-letter log line.
//
// Assumes single API instance. If PM2 cluster mode is ever enabled,
// swap to a DB-side lease (e.g. INSERT INTO billing_reconcile_lock
// ON CONFLICT IGNORE pattern). Two sweepers racing today:
//   - Atomic UPDATE in confirmBillingPurchase protects against
//     double-grant (T0.2 invariant).
//   - Both independently call getStarTransactions → 2× Telegram API
//     rate per tick.
//   - Both write per-row attempt log lines → duplicate stderr noise.
// None of that is corruption, just waste. Single-instance is the
// current deploy reality (RUNBOOK).

import { confirmBillingPurchase } from './accountStore.js';
import { getDb } from './account/core/repository.js';
import {
  fetchTelegramStarTransactions,
  type TelegramStarTransactionsResponse
} from './routeSupport.js';

// Backoff per row, indexed by `reconcile_attempts` (number of
// completed sweep attempts on this row). Element at index N is the
// minimum wait between "we just made attempt N" and "we're about to
// make attempt N+1". 5 entries → up to 5 sweep attempts before dead-
// letter. backoff[0]=1m gates the very first attempt only if
// last_reconcile_at was somehow set with attempts still 0 (defensive;
// normal flow has last_reconcile_at NULL when attempts=0 and the SQL
// NULL branch makes the row immediately eligible on the first sweep
// tick after creation).
//
// EXACT ATTEMPT SCHEDULE in the first 10 minutes (VI-3 lock-in for
// the "до 10 минут" promise in the T0.2b apology copy):
//   t=0    user pays, bot's webhook forward fails, row written with
//          attempts=0, last_reconcile_at=NULL
//   T=2min sweep tick. attempts=0, last=NULL → SQL NULL branch hits,
//          eligible. Fire. attempts=1, last=2min.
//   T=4min sweep tick. attempts=1, last=2min, backoff[1]=2m → eligible
//          (2 + 2 ≤ 4). Fire. attempts=2, last=4min.
//   T=6min sweep tick. attempts=2, last=4min, backoff[2]=4m → NOT
//          eligible (4 + 4 > 6).
//   T=8min sweep tick. attempts=2, last=4min → eligible (4 + 4 ≤ 8).
//          Fire. attempts=3, last=8min.
//   T=10min sweep tick. attempts=3, last=8min, backoff[3]=8m → NOT
//          eligible (8 + 8 > 10).
// THREE attempts at T=2, T=4, T=8 in the first 10 minutes. The
// apology copy says "до 10 минут" (not "ровно"); 3 attempts in that
// window is the honest contract.
//
// Full schedule across the 5-attempt budget: T=2, T=4, T=8, T=16,
// T=32. Dead-letter at attempt 6 (skipped by `reconcile_attempts < 5`
// filter, dead-letter log line written once when attempts crosses
// 4→5 inside the sweep).
export const RECONCILE_BACKOFF_MS = [
  1 * 60_000,
  2 * 60_000,
  4 * 60_000,
  8 * 60_000,
  16 * 60_000
];

export const RECONCILE_MAX_ATTEMPTS = 5;
export const RECONCILE_HORIZON_MS = 24 * 60 * 60_000;
export const RECONCILE_DEFAULT_INTERVAL_MS = 2 * 60_000;
export const RECONCILE_DEFAULT_TELEGRAM_LIMIT = 100;

type PendingRow = {
  id: string;
  payload: string | null;
  created_at: number;
  reconcile_attempts: number;
  last_reconcile_at: number | null;
};

export type ReconcileSweepDeps = {
  // Pre-built; lets the test inject an in-memory DB instance.
  db: Awaited<ReturnType<typeof getDb>>;
  // Returns recent Star transactions. Real impl wraps
  // fetchTelegramStarTransactions; tests inject a stub that returns a
  // fixed response so the sweep's matching path runs deterministically.
  fetchStarTransactions: () => Promise<TelegramStarTransactionsResponse>;
  // Returns the resolved account or null. Real impl is
  // confirmBillingPurchase; tests can inject to assert call counts.
  confirmPurchase: typeof confirmBillingPurchase;
  // Single-line JSON to stderr. Real impl is console.error; tests
  // capture into an array.
  log: (line: string) => void;
  now: () => number;
  horizonMs?: number;
};

export type ReconcileSweepResult = {
  processedCount: number;
  grantedCount: number;
  deadLetteredCount: number;
};

const writeLogLine = (
  log: (line: string) => void,
  payload: Record<string, unknown>
) => {
  log(JSON.stringify(payload));
};

const isInvoicePaymentTransaction = (
  source: { type: string; transaction_type?: string; invoice_payload?: string } | undefined
): source is { type: 'user'; transaction_type: 'invoice_payment'; invoice_payload: string } => {
  if (!source) return false;
  if (source.type !== 'user') return false;
  if (source.transaction_type !== 'invoice_payment') return false;
  if (typeof source.invoice_payload !== 'string') return false;
  if (!source.invoice_payload) return false;
  return true;
};

export const runReconcileSweep = async (
  deps: ReconcileSweepDeps
): Promise<ReconcileSweepResult> => {
  const now = deps.now();
  const horizon = deps.horizonMs ?? RECONCILE_HORIZON_MS;

  let response: TelegramStarTransactionsResponse;
  try {
    response = await deps.fetchStarTransactions();
  } catch (error) {
    // Telegram-API outage: skip this tick entirely. Do NOT increment
    // reconcile_attempts — punishing rows for our infra problem
    // would burn through the 5-attempt budget without giving any
    // pending purchase a real chance to be matched. Next tick retries.
    writeLogLine(deps.log, {
      event: 'billing_reconcile_telegram_fetch_failed',
      error: error instanceof Error ? error.message : String(error)
    });
    return { processedCount: 0, grantedCount: 0, deadLetteredCount: 0 };
  }

  // Build the payload→chargeId map with strict filtering. PB-2:
  // gift_purchase / premium_purchase share the StarTransaction shape
  // but their invoice_payload is undefined; a loose filter would let
  // them false-match a pending row whose payload happens to be empty
  // string. Hard filter on the three discriminators.
  const txnByPayload = new Map<string, string>();
  for (const transaction of response.transactions) {
    if (!isInvoicePaymentTransaction(transaction.source)) continue;
    txnByPayload.set(transaction.source.invoice_payload, transaction.id);
  }

  // SELECT eligible pending rows. The backoff predicate is enforced
  // in JS (per-row arithmetic against the per-attempt-count
  // RECONCILE_BACKOFF_MS array would be a multi-CASE SQL expression
  // for marginal benefit at <100-row scale).
  const horizonCutoff = now - horizon;
  const rows = deps.db
    .prepare(
      `SELECT id, payload, created_at, reconcile_attempts, last_reconcile_at
       FROM billing_purchases
       WHERE status = 'pending'
         AND created_at >= ?
         AND reconcile_attempts < ?
       ORDER BY created_at ASC`
    )
    .all(horizonCutoff, RECONCILE_MAX_ATTEMPTS) as PendingRow[];

  let processedCount = 0;
  let grantedCount = 0;
  let deadLetteredCount = 0;

  const updateRowState = deps.db.prepare(
    `UPDATE billing_purchases
     SET reconcile_attempts = ?, last_reconcile_at = ?
     WHERE id = ?`
  );

  for (const row of rows) {
    const attempts = row.reconcile_attempts;
    const eligible =
      row.last_reconcile_at === null ||
      row.last_reconcile_at + (RECONCILE_BACKOFF_MS[attempts] ?? 0) <= now;
    if (!eligible) continue;
    processedCount += 1;

    const chargeId = txnByPayload.get(row.id);
    if (chargeId) {
      // Match → forward in-process. confirmBillingPurchase is
      // idempotent (T0.2 atomic UPDATE) so re-forwarding the same
      // purchaseId across consecutive ticks is safe.
      try {
        await deps.confirmPurchase(row.id, chargeId);
        grantedCount += 1;
      } catch (error) {
        writeLogLine(deps.log, {
          event: 'billing_reconcile_grant_failed',
          purchaseId: row.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      updateRowState.run(attempts + 1, now, row.id);
      continue;
    }

    // No match — bump attempts + schedule next retry via
    // last_reconcile_at. If this attempt crosses 4→5, emit the
    // dead-letter log exactly once. Row stays `pending` in DB; we
    // don't know definitively that the user did NOT pay (the
    // transaction could be older than our 100-row Telegram window),
    // only that we cannot verify within the budget.
    const nextAttempts = attempts + 1;
    updateRowState.run(nextAttempts, now, row.id);
    if (nextAttempts >= RECONCILE_MAX_ATTEMPTS) {
      writeLogLine(deps.log, {
        event: 'billing_reconcile_dead_letter',
        purchaseId: row.id,
        attempts: nextAttempts,
        lastError: 'no-matching-telegram-transaction'
      });
      deadLetteredCount += 1;
    }
  }

  return { processedCount, grantedCount, deadLetteredCount };
};

type StartSweepOptions = {
  intervalMs?: number;
  botToken: string;
  telegramLimit?: number;
};

// Boot wrapper. setInterval keeps a strong reference to the timer so
// the API process won't exit on it; pair with PM2 supervision and the
// callback's try/catch keeps a sweep error from killing the process.
// Returns the timer handle so tests / shutdown hooks can clearInterval.
export const startBillingReconcileSweep = (
  options: StartSweepOptions
): NodeJS.Timeout => {
  const interval = options.intervalMs ?? RECONCILE_DEFAULT_INTERVAL_MS;
  const limit = options.telegramLimit ?? RECONCILE_DEFAULT_TELEGRAM_LIMIT;
  const log = (line: string) => console.error(line);

  const tick = async () => {
    try {
      const db = await getDb();
      await runReconcileSweep({
        db,
        fetchStarTransactions: () =>
          fetchTelegramStarTransactions(options.botToken, { limit }),
        confirmPurchase: confirmBillingPurchase,
        log,
        now: () => Date.now()
      });
    } catch (error) {
      // Defensive: any throw inside the tick MUST NOT crash the
      // process. The sweep already catches Telegram-fetch errors;
      // this catches DB errors and any other surprise.
      writeLogLine(log, {
        event: 'billing_reconcile_tick_crashed',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };

  return setInterval(() => {
    void tick();
  }, interval);
};
