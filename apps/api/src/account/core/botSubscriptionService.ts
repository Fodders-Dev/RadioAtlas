import {
  getAccountByIdSync,
  getAccountByProviderSync,
  getBotSubscriptionByAccountSync,
  getDb,
  listNudgeRecipientsSync,
  recordBotReachabilitySync,
  setBotOptInSync
} from './repository.js';
import type { NudgeRecipient } from './types.js';

// R1: the weekly taste-pick cap — at most one nudge per recipient per 7 days.
export const NUDGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

// Bot /start → record DM-reachability for this Telegram user. Resolves the
// account if the telegram identity already maps to one (else null, back-filled
// when they link). No-op on a missing/blank id.
export const recordBotReachability = async (telegramId: string): Promise<void> => {
  const id = String(telegramId ?? '').trim();
  if (!id) return;
  const db = await getDb();
  const account = getAccountByProviderSync(db, 'telegram', id);
  recordBotReachabilitySync(db, id, account?.id ?? null);
};

export type BotOptInResult = {
  optedIn: boolean;
  hasTelegram: boolean;
  reachable: boolean;
};

// Authed webapp → set the account's opt-in. Server-authoritative. Requires a
// linked telegram identity (the chat we'd DM); otherwise reports hasTelegram:false
// so the UI can prompt the user to link/start the bot.
export const setBotOptIn = async (
  accountId: string,
  optedIn: boolean
): Promise<BotOptInResult> => {
  const db = await getDb();
  const account = getAccountByIdSync(db, accountId);
  const telegram = account?.providers.find((provider) => provider.kind === 'telegram');
  if (!telegram) {
    return { optedIn: false, hasTelegram: false, reachable: false };
  }
  setBotOptInSync(db, telegram.externalId, accountId, optedIn);
  const subscription = getBotSubscriptionByAccountSync(db, accountId);
  return {
    optedIn: Boolean(subscription?.optedIn),
    hasTelegram: true,
    reachable: Boolean(subscription?.startedAt)
  };
};

// Current opt-in state for the session envelope so the webapp toggle reflects
// the server (not localStorage). Defaults false (off) when no row exists.
export const getBotOptInForAccount = async (accountId: string): Promise<boolean> => {
  const db = await getDb();
  const subscription = getBotSubscriptionByAccountSync(db, accountId);
  return Boolean(subscription?.optedIn);
};

// Internal-only (PR-B sender): the recipient set for the next sweep.
export const listNudgeRecipients = async (): Promise<NudgeRecipient[]> => {
  const db = await getDb();
  return listNudgeRecipientsSync(db, NUDGE_COOLDOWN_MS, Date.now());
};
