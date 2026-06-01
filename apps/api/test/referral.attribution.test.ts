import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// The store path is resolved at module load, so it MUST be set before importing
// any account module. Point it at a throwaway temp DB.
const storeDir = await mkdtemp(join(tmpdir(), 'radioatlas-referral-test-'));
process.env.ACCOUNT_STORE_PATH = join(storeDir, 'account-store.sqlite');

const {
  attributeReferral,
  getReferralCount,
  linkTelegramIdentity,
  parseReferralParam,
  REFERRAL_REWARD_ENTITLEMENT,
  REFERRAL_REWARD_THRESHOLD
} = await import('../src/accountStore.js');
const { ensureInvitedByAccountIdColumn, getAccountByIdSync, getDb } = await import(
  '../src/account/core/repository.js'
);

// Distinct telegram id per call so each test gets a fresh account without a reset.
let nextTelegramId = 700000;
const createUser = async () => {
  const id = nextTelegramId++;
  const account = await linkTelegramIdentity({ id, first_name: `User${id}` });
  assert.ok(account, 'linkTelegramIdentity should create an account');
  return account!;
};

const reload = async (accountId: string) => {
  const db = await getDb();
  return getAccountByIdSync(db, accountId);
};

test('parseReferralParam extracts ref_ ids and rejects everything else', () => {
  assert.equal(parseReferralParam('ref_abc-123'), 'abc-123');
  assert.equal(parseReferralParam('ref_'), null);
  assert.equal(parseReferralParam('ref_   '), null);
  assert.equal(parseReferralParam('station_xyz'), null);
  assert.equal(parseReferralParam('link_code'), null);
  assert.equal(parseReferralParam(''), null);
  assert.equal(parseReferralParam(null), null);
  assert.equal(parseReferralParam(undefined), null);
});

test('happy path: a new invitee is attributed and the inviter is rewarded', async () => {
  const inviter = await createUser();
  const invitee = await createUser();

  await attributeReferral({ startParam: `ref_${inviter.id}`, inviteeAccountId: invitee.id });

  assert.equal((await reload(invitee.id))?.invitedByAccountId, inviter.id);
  assert.equal(await getReferralCount(inviter.id), 1);
  // Threshold is 1, so the single referral unlocks the reward entitlement.
  assert.equal(REFERRAL_REWARD_THRESHOLD, 1);
  assert.ok((await reload(inviter.id))?.entitlements.includes(REFERRAL_REWARD_ENTITLEMENT));
});

test('guard: no self-refer (inviter === invitee is ignored)', async () => {
  const user = await createUser();
  await attributeReferral({ startParam: `ref_${user.id}`, inviteeAccountId: user.id });

  const reloaded = await reload(user.id);
  assert.equal(reloaded?.invitedByAccountId, null);
  assert.equal(reloaded?.entitlements.includes(REFERRAL_REWARD_ENTITLEMENT), false);
});

test('guard: inviter must be a real existing account', async () => {
  const invitee = await createUser();
  await attributeReferral({
    startParam: 'ref_does-not-exist-0000',
    inviteeAccountId: invitee.id
  });
  assert.equal((await reload(invitee.id))?.invitedByAccountId, null);
});

test('guard: one inviter per user — never re-attributed', async () => {
  const inviterA = await createUser();
  const inviterB = await createUser();
  const invitee = await createUser();

  await attributeReferral({ startParam: `ref_${inviterA.id}`, inviteeAccountId: invitee.id });
  // A second attribution with a different inviter must be a no-op.
  await attributeReferral({ startParam: `ref_${inviterB.id}`, inviteeAccountId: invitee.id });

  assert.equal((await reload(invitee.id))?.invitedByAccountId, inviterA.id);
  assert.equal(await getReferralCount(inviterB.id), 0);
  assert.equal((await reload(inviterB.id))?.entitlements.includes(REFERRAL_REWARD_ENTITLEMENT), false);
});

test('idempotent grant: multiple referrals never double-add the entitlement', async () => {
  const inviter = await createUser();
  const inviteeOne = await createUser();
  const inviteeTwo = await createUser();

  await attributeReferral({ startParam: `ref_${inviter.id}`, inviteeAccountId: inviteeOne.id });
  await attributeReferral({ startParam: `ref_${inviter.id}`, inviteeAccountId: inviteeTwo.id });

  assert.equal(await getReferralCount(inviter.id), 2);
  const grants = (await reload(inviter.id))?.entitlements.filter(
    (entitlement) => entitlement === REFERRAL_REWARD_ENTITLEMENT
  );
  assert.equal(grants?.length, 1, 'entitlement must appear exactly once');
});

test('fail-safe: malformed / non-referral input never throws and is a no-op', async () => {
  const invitee = await createUser();
  // None of these should throw — the route relies on this to keep sign-in alive.
  await assert.doesNotReject(
    attributeReferral({ startParam: '', inviteeAccountId: invitee.id })
  );
  await assert.doesNotReject(
    attributeReferral({ startParam: null, inviteeAccountId: invitee.id })
  );
  await assert.doesNotReject(
    attributeReferral({ startParam: 'station_abc', inviteeAccountId: invitee.id })
  );
  await assert.doesNotReject(
    attributeReferral({ startParam: 'ref_', inviteeAccountId: invitee.id })
  );
  // Even a non-existent invitee id must not throw.
  await assert.doesNotReject(
    attributeReferral({ startParam: 'ref_someone', inviteeAccountId: 'ghost-account' })
  );
  assert.equal((await reload(invitee.id))?.invitedByAccountId, null);
});

test('migration is additive + idempotent and defaults legacy rows to null', async () => {
  const db = await getDb();
  // Idempotent: running the migration again on an already-migrated DB is a no-op.
  assert.doesNotThrow(() => ensureInvitedByAccountIdColumn(db));

  const columns = db.prepare('PRAGMA table_info(accounts)').all() as Array<Record<string, unknown>>;
  assert.ok(
    columns.some((column) => column.name === 'invited_by_account_id'),
    'accounts.invited_by_account_id column must exist'
  );

  // An account created without a ref param reads back as "never referred" (null),
  // i.e. backward-compatible with every pre-existing row.
  const plain = await createUser();
  assert.equal((await reload(plain.id))?.invitedByAccountId, null);
});
