import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// Store path is read at module load — set before importing the account modules.
const storeDir = await mkdtemp(join(tmpdir(), 'radioatlas-botsub-test-'));
process.env.ACCOUNT_STORE_PATH = join(storeDir, 'account-store.sqlite');

const {
  getBotOptInForAccount,
  linkTelegramIdentity,
  listNudgeRecipients,
  recordBotReachability,
  setBotOptIn
} = await import('../src/accountStore.js');
const { getDb } = await import('../src/account/core/repository.js');

let nextTelegramId = 900000;
const createUser = async () => {
  const id = nextTelegramId++;
  const account = await linkTelegramIdentity({ id, first_name: `User${id}` });
  assert.ok(account);
  return { account: account!, telegramId: String(id) };
};

test('migration is additive: bot_subscriptions exists + legacy accounts default OFF', async () => {
  const db = await getDb();
  const columns = db.prepare('PRAGMA table_info(bot_subscriptions)').all() as Array<
    Record<string, unknown>
  >;
  const names = columns.map((c) => c.name);
  for (const col of ['telegram_id', 'account_id', 'opted_in', 'started_at', 'last_sent_at', 'unreachable']) {
    assert.ok(names.includes(col), `bot_subscriptions.${col} must exist`);
  }
  // An account created with no bot interaction reads back opted-out (default OFF)
  // and is otherwise untouched.
  const { account } = await createUser();
  assert.equal(await getBotOptInForAccount(account.id), false);
});

test('recordBotReachability creates a row and links the account by telegram id', async () => {
  const { account, telegramId } = await createUser();
  await recordBotReachability(telegramId);
  const db = await getDb();
  const row = db
    .prepare('SELECT * FROM bot_subscriptions WHERE telegram_id = ?')
    .get(telegramId) as Record<string, unknown>;
  assert.ok(row, 'reachability row created');
  assert.equal(row.account_id, account.id);
  assert.ok(Number(row.started_at) > 0, 'started_at set');
  assert.equal(Number(row.unreachable), 0);
  // Still opted-out — reachability is not consent.
  assert.equal(await getBotOptInForAccount(account.id), false);
});

test('setBotOptIn flips the server-authoritative flag; requires a telegram link', async () => {
  const { account } = await createUser();
  const on = await setBotOptIn(account.id, true);
  assert.deepEqual(on, { optedIn: true, hasTelegram: true, reachable: false });
  assert.equal(await getBotOptInForAccount(account.id), true);

  const off = await setBotOptIn(account.id, false);
  assert.equal(off.optedIn, false);
  assert.equal(await getBotOptInForAccount(account.id), false);
});

test('listNudgeRecipients returns ONLY opted-in AND reachable users', async () => {
  // A: opted-in + reachable → included.
  const a = await createUser();
  await recordBotReachability(a.telegramId);
  await setBotOptIn(a.account.id, true);

  // B: opted-in but NOT reachable (never started the bot) → excluded.
  const b = await createUser();
  await setBotOptIn(b.account.id, true);

  // C: reachable but NOT opted-in → excluded.
  const c = await createUser();
  await recordBotReachability(c.telegramId);

  const recipients = await listNudgeRecipients();
  const ids = recipients.map((r) => r.telegramId);
  assert.ok(ids.includes(a.telegramId), 'opted-in + reachable included');
  assert.ok(!ids.includes(b.telegramId), 'opted-in but unreachable excluded');
  assert.ok(!ids.includes(c.telegramId), 'reachable but not opted-in excluded');
});

test('recordBotReachability is a safe no-op on a blank id', async () => {
  await assert.doesNotReject(recordBotReachability(''));
  await assert.doesNotReject(recordBotReachability('   '));
});
