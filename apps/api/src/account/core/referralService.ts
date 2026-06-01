import {
  countReferralsForAccountSync,
  getAccountByIdSync,
  getDb,
  recordAuditEventSync,
  setInvitedByIfAbsentSync,
  upsertAccount
} from './repository.js';
import type { SessionEntitlement } from './types.js';

// T_share_4: one qualified referral unlocks the reward (the exclusive theme,
// gated in PR-B on this entitlement). Kept as named constants so the threshold
// and reward are tunable in one place (future tiers / product tweaks).
export const REFERRAL_REWARD_THRESHOLD = 1;
export const REFERRAL_REWARD_ENTITLEMENT: SessionEntitlement = 'referral-theme';

const REFERRAL_PREFIX = 'ref_';

// Extract `ref_<inviterAccountId>` from a Telegram start param. Returns null for
// anything that is not a referral param (station_/link_/empty/garbage).
export const parseReferralParam = (startParam: string | null | undefined): string | null => {
  if (typeof startParam !== 'string' || !startParam.startsWith(REFERRAL_PREFIX)) return null;
  const inviterAccountId = startParam.slice(REFERRAL_PREFIX.length).trim();
  return inviterAccountId || null;
};

// Attribute a newly-created invitee to their inviter and grant the inviter their
// reward once they cross the threshold.
//
// PURE SIDE-EFFECT. The caller MUST invoke this only for a genuinely new invitee
// and MUST wrap it in try/catch — a throw here must never reach the auth
// response (see authRoutes `/auth/telegram`). Attribution is best-effort
// telemetry-grade bookkeeping, not an auth gate.
//
// Guards (all enforced here, independent of the caller):
//   - referral param must parse to a non-empty inviter id
//   - no self-refer (inviter !== invitee)
//   - inviter must be a real, existing account
//   - one inviter per user: invited_by is written ONCE via an `IS NULL`-guarded
//     UPDATE, so a re-entry (or a race) changes 0 rows and bails
//   - reward entitlement granted at most once (deduped on the entitlement array)
export const attributeReferral = async (params: {
  startParam: string | null | undefined;
  inviteeAccountId: string;
}): Promise<void> => {
  const inviterAccountId = parseReferralParam(params.startParam);
  if (!inviterAccountId) return;
  if (inviterAccountId === params.inviteeAccountId) return; // self-refer

  const db = await getDb();

  const inviter = getAccountByIdSync(db, inviterAccountId);
  if (!inviter) return; // inviter must be a real account

  const invitee = getAccountByIdSync(db, params.inviteeAccountId);
  if (!invitee || invitee.invitedByAccountId) return; // already attributed → never re-attribute

  // Atomic, idempotent write — only succeeds when invited_by was still NULL.
  const wrote = setInvitedByIfAbsentSync(db, params.inviteeAccountId, inviterAccountId);
  if (!wrote) return; // lost the race; another attribution already won
  recordAuditEventSync(db, params.inviteeAccountId, 'referral_attributed', { inviterAccountId });

  // Grant the reward once the inviter reaches the threshold (idempotent: the
  // entitlement is only appended if absent, and entitlements are a de-duped set
  // on read, so repeat referrals never double-grant).
  const referralCount = countReferralsForAccountSync(db, inviterAccountId);
  if (
    referralCount >= REFERRAL_REWARD_THRESHOLD &&
    !inviter.entitlements.includes(REFERRAL_REWARD_ENTITLEMENT)
  ) {
    upsertAccount(db, {
      ...inviter,
      entitlements: [...inviter.entitlements, REFERRAL_REWARD_ENTITLEMENT],
      updatedAt: Date.now()
    });
    recordAuditEventSync(db, inviterAccountId, 'referral_reward_granted', {
      entitlement: REFERRAL_REWARD_ENTITLEMENT,
      referralCount
    });
  }
};

// Count how many accounts this account has referred (used to surface
// "N joined" in the session envelope).
export const getReferralCount = async (accountId: string): Promise<number> => {
  const db = await getDb();
  return countReferralsForAccountSync(db, accountId);
};
