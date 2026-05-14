import { randomUUID } from 'node:crypto';
import type { AccountProvider, LibraryMergeStrategy, LinkRequest, ProviderKind, StoredAccount } from './types.js';
import * as helpers from './helpers.js';
import * as repository from './repository.js';

const {
  LINK_REQUEST_TTL_MS,
  SESSION_TTL_MS,
  SUPPORTER_ENTITLEMENTS,
  buildAccountSkeleton,
  buildMergePreview,
  deriveAccountIdentity,
  providerDisplayName,
  safeNumber,
  safeText
} = { ...helpers, ...repository };
const {
  ensureProviderLinkedSync,
  getAccountByIdSync,
  getAccountByProviderSync,
  getDb,
  mergeAccountsSync,
  pruneExpiredLinkRequests,
  recordAuditEventSync,
  saveAccount
} = repository;

export const previewTelegramLink = async (
  user: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    photo_url?: string;
    is_premium?: boolean;
  },
  targetAccountId?: string | null,
  strategy: LibraryMergeStrategy = 'combine'
) => {
  const db = await getDb();
  const providerLabel =
    user.username?.trim() ||
    [user.first_name, user.last_name].filter(Boolean).join(' ').trim() ||
    `telegram_${user.id}`;
  const currentAccount = targetAccountId ? getAccountByIdSync(db, targetAccountId) : null;
  const incomingAccount = getAccountByProviderSync(db, 'telegram', String(user.id));
  return buildMergePreview('telegram', providerLabel, strategy, currentAccount, incomingAccount);
};

export const previewGoogleLink = async (
  identity: {
    sub: string;
    name?: string;
    email?: string;
    picture?: string;
    email_verified?: boolean;
  },
  targetAccountId?: string | null,
  strategy: LibraryMergeStrategy = 'combine'
) => {
  const db = await getDb();
  const providerLabel = identity.email?.trim() || identity.name?.trim() || `google_${identity.sub}`;
  const currentAccount = targetAccountId ? getAccountByIdSync(db, targetAccountId) : null;
  const incomingAccount = getAccountByProviderSync(db, 'google', identity.sub);
  return buildMergePreview('google', providerLabel, strategy, currentAccount, incomingAccount);
};

export const previewVkLink = async (
  identity: {
    id: number | string;
    first_name?: string;
    last_name?: string;
    screen_name?: string;
    photo_200?: string;
    email?: string;
  },
  targetAccountId?: string | null,
  strategy: LibraryMergeStrategy = 'combine'
) => {
  const db = await getDb();
  const fullName = [identity.first_name, identity.last_name].filter(Boolean).join(' ').trim();
  const providerLabel =
    identity.email?.trim() ||
    fullName ||
    identity.screen_name?.trim() ||
    `vk_${String(identity.id)}`;
  const currentAccount = targetAccountId ? getAccountByIdSync(db, targetAccountId) : null;
  const incomingAccount = getAccountByProviderSync(db, 'vk', String(identity.id));
  return buildMergePreview('vk', providerLabel, strategy, currentAccount, incomingAccount);
};

export const unlinkProvider = async (accountId: string, kind: ProviderKind) => {
  const db = await getDb();
  const account = getAccountByIdSync(db, accountId);
  if (!account) return null;

  const provider = account.providers.find((item) => item.kind === kind) || null;
  if (!provider) {
    throw new Error('provider is not linked');
  }

  if (account.providers.length <= 1) {
    throw new Error('cannot unlink the last sign-in method');
  }

  const nextProviders = account.providers.filter((item) => item.kind !== kind);
  const nextIdentity = deriveAccountIdentity(account, nextProviders);
  const nextAccount: StoredAccount = {
    ...account,
    ...nextIdentity,
    providers: nextProviders,
    updatedAt: Date.now()
  };

  saveAccount(db, nextAccount);
  db.prepare('DELETE FROM providers WHERE account_id = ? AND kind = ?').run(accountId, kind);
  recordAuditEventSync(
    db,
    accountId,
    'provider_unlinked',
    { label: providerDisplayName(provider) },
    provider
  );
  return getAccountByIdSync(db, accountId);
};

export const linkTelegramIdentity = async (
  user: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    photo_url?: string;
    is_premium?: boolean;
  },
  targetAccountId?: string | null,
  mergeStrategy: LibraryMergeStrategy = 'combine'
) => {
  const db = await getDb();
  const provider: AccountProvider = {
    kind: 'telegram',
    externalId: String(user.id),
    displayName:
      [user.first_name, user.last_name].filter(Boolean).join(' ').trim() ||
      user.username ||
      `telegram_${user.id}`,
    username: user.username || null,
    email: null,
    photoUrl: user.photo_url || null,
    isPremium: Boolean(user.is_premium),
    linkedAt: Date.now()
  };

  const currentProviderAccount = getAccountByProviderSync(db, 'telegram', provider.externalId);
  let accountId = targetAccountId || currentProviderAccount?.id || randomUUID();

  if (!getAccountByIdSync(db, accountId)) {
    const nextAccount = buildAccountSkeleton({
      id: accountId,
      displayName: provider.displayName,
      username: provider.username,
      photoUrl: provider.photoUrl,
      isPremium: provider.isPremium,
      premiumStatus: provider.isPremium ? 'supporter' : 'free',
      supporterTier: provider.isPremium ? 'supporter' : 'none',
      entitlements: provider.isPremium ? SUPPORTER_ENTITLEMENTS : []
    });
    saveAccount(db, nextAccount);
    recordAuditEventSync(db, accountId, 'account_created', { source: 'telegram' }, provider);
  }

  if (currentProviderAccount && currentProviderAccount.id !== accountId) {
    const merged = mergeAccountsSync(db, accountId, currentProviderAccount.id, mergeStrategy);
    accountId = merged?.id || accountId;
  }

  return ensureProviderLinkedSync(db, accountId, provider);
};

export const linkGoogleIdentity = async (
  identity: {
    sub: string;
    name?: string;
    email?: string;
    picture?: string;
    email_verified?: boolean;
  },
  targetAccountId?: string | null,
  mergeStrategy: LibraryMergeStrategy = 'combine'
) => {
  const db = await getDb();
  const provider: AccountProvider = {
    kind: 'google',
    externalId: identity.sub,
    displayName:
      identity.name?.trim() || identity.email?.trim() || `google_${identity.sub}`,
    username: null,
    email: identity.email?.trim() || null,
    photoUrl: identity.picture?.trim() || null,
    isPremium: false,
    linkedAt: Date.now()
  };

  const currentProviderAccount = getAccountByProviderSync(db, 'google', provider.externalId);
  let accountId = targetAccountId || currentProviderAccount?.id || randomUUID();

  if (!getAccountByIdSync(db, accountId)) {
    const nextAccount = buildAccountSkeleton({
      id: accountId,
      displayName: provider.displayName,
      email: provider.email,
      photoUrl: provider.photoUrl,
      entitlements: []
    });
    saveAccount(db, nextAccount);
    recordAuditEventSync(db, accountId, 'account_created', { source: 'google' }, provider);
  }

  if (currentProviderAccount && currentProviderAccount.id !== accountId) {
    const merged = mergeAccountsSync(db, accountId, currentProviderAccount.id, mergeStrategy);
    accountId = merged?.id || accountId;
  }

  return ensureProviderLinkedSync(db, accountId, provider);
};

export const linkVkIdentity = async (
  identity: {
    id: number | string;
    first_name?: string;
    last_name?: string;
    screen_name?: string;
    photo_200?: string;
    email?: string;
  },
  targetAccountId?: string | null,
  mergeStrategy: LibraryMergeStrategy = 'combine'
) => {
  const db = await getDb();
  const fullName = [identity.first_name, identity.last_name].filter(Boolean).join(' ').trim();
  const provider: AccountProvider = {
    kind: 'vk',
    externalId: String(identity.id),
    displayName:
      fullName || identity.email?.trim() || identity.screen_name?.trim() || `vk_${String(identity.id)}`,
    username: identity.screen_name?.trim() || null,
    email: identity.email?.trim() || null,
    photoUrl: identity.photo_200?.trim() || null,
    isPremium: false,
    linkedAt: Date.now()
  };

  const currentProviderAccount = getAccountByProviderSync(db, 'vk', provider.externalId);
  let accountId = targetAccountId || currentProviderAccount?.id || randomUUID();

  if (!getAccountByIdSync(db, accountId)) {
    const nextAccount = buildAccountSkeleton({
      id: accountId,
      displayName: provider.displayName,
      username: provider.username,
      email: provider.email,
      photoUrl: provider.photoUrl,
      entitlements: []
    });
    saveAccount(db, nextAccount);
    recordAuditEventSync(db, accountId, 'account_created', { source: 'vk' }, provider);
  }

  if (currentProviderAccount && currentProviderAccount.id !== accountId) {
    const merged = mergeAccountsSync(db, accountId, currentProviderAccount.id, mergeStrategy);
    accountId = merged?.id || accountId;
  }

  return ensureProviderLinkedSync(db, accountId, provider);
};

export const createSessionForAccount = async (accountId: string) => {
  const db = await getDb();
  const token = randomUUID();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  db.prepare(`
    INSERT INTO sessions (token, account_id, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, accountId, now, now, expiresAt);
  recordAuditEventSync(db, accountId, 'session_created', { expiresAt });
  return token;
};

// Looks the bearer token up by primary key, rejects expired sessions
// (deleting them as a side-effect), and slides the 30-day window forward
// on each successful hit. The DB does an exact B-tree match on the token,
// and we never compare tokens in JS, so there is no JS-level timing leak
// to worry about - the only signal is index depth, which is negligible
// for cryptographically random 36-character UUIDs.
export const getAccountByToken = async (token: string) => {
  const db = await getDb();
  const session = db.prepare('SELECT * FROM sessions WHERE token = ? LIMIT 1').get(token);
  if (!session) return null;
  const accountId = safeText(session.account_id);
  if (!accountId) return null;
  const expiresAt = safeNumber(session.expires_at) ?? 0;
  const now = Date.now();
  if (expiresAt > 0 && expiresAt <= now) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  const nextExpiresAt = now + SESSION_TTL_MS;
  db.prepare(
    'UPDATE sessions SET updated_at = ?, expires_at = ? WHERE token = ?'
  ).run(now, nextExpiresAt, token);
  return getAccountByIdSync(db, accountId);
};

export const revokeSession = async (token: string) => {
  const db = await getDb();
  const session = db.prepare('SELECT account_id FROM sessions WHERE token = ? LIMIT 1').get(token);
  const result = db.prepare('DELETE FROM sessions WHERE token = ?').run(token) as
    | { changes?: number | bigint }
    | undefined;
  const revoked = Number(result?.changes ?? 0) > 0;
  if (revoked && session) {
    const accountId = safeText(session.account_id);
    if (accountId) {
      recordAuditEventSync(db, accountId, 'session_revoked', {});
    }
  }
  return revoked;
};

export const revokeOtherSessions = async (accountId: string, currentToken: string) => {
  const db = await getDb();
  const result = db
    .prepare('DELETE FROM sessions WHERE account_id = ? AND token != ?')
    .run(accountId, currentToken) as { changes?: number | bigint } | undefined;
  const revokedCount = Number(result?.changes ?? 0);
  if (revokedCount > 0) {
    recordAuditEventSync(db, accountId, 'sessions_revoked_other', { revokedCount });
  }
  return revokedCount;
};

// Test-only helpers exposed via the ENABLE_TEST_AUTH_FIXTURES gated routes
// in authRoutes.ts. They MUST stay behind that flag so production deploys
// cannot reach them.
export const __forceSessionExpiryForTesting = async (token: string) => {
  const db = await getDb();
  const result = db
    .prepare('UPDATE sessions SET expires_at = ? WHERE token = ?')
    .run(1, token) as { changes?: number | bigint } | undefined;
  return Number(result?.changes ?? 0) > 0;
};

export const __inspectSessionForTesting = async (token: string) => {
  const db = await getDb();
  const session = db
    .prepare('SELECT account_id, expires_at FROM sessions WHERE token = ? LIMIT 1')
    .get(token);
  if (!session) return null;
  return {
    accountId: safeText(session.account_id),
    expiresAt: safeNumber(session.expires_at) ?? 0
  };
};

export const createLinkRequest = async (
  accountId: string,
  mergeStrategy: LibraryMergeStrategy = 'combine'
) => {
  const db = await getDb();
  pruneExpiredLinkRequests(db);
  const code = randomUUID().replace(/-/g, '').slice(0, 24);
  const now = Date.now();
  const request: LinkRequest = {
    code,
    accountId,
    mergeStrategy,
    createdAt: now,
    expiresAt: now + LINK_REQUEST_TTL_MS
  };
  db.prepare(`
    INSERT INTO link_requests (code, account_id, merge_strategy, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(request.code, request.accountId, request.mergeStrategy, request.createdAt, request.expiresAt);
  recordAuditEventSync(db, accountId, 'link_request_created', {
    expiresAt: request.expiresAt,
    mergeStrategy: request.mergeStrategy
  });
  return request;
};

const mapLinkRequestRow = (row: Record<string, unknown>): LinkRequest => ({
  code: String(row.code),
  accountId: String(row.account_id),
  mergeStrategy: (safeText(row.merge_strategy) as LibraryMergeStrategy) || 'combine',
  createdAt: safeNumber(row.created_at) ?? Date.now(),
  expiresAt: safeNumber(row.expires_at) ?? Date.now()
});

// Atomic one-time consume: the DELETE ... RETURNING runs as a single
// SQLite statement so two concurrent provider callbacks racing on the
// same linkCode can never both win - exactly one gets the row back, the
// other gets undefined and the route turns that into 409.
export const consumeLinkRequest = async (code: string) => {
  const db = await getDb();
  pruneExpiredLinkRequests(db);
  if (!code) return null;
  const row = db
    .prepare('DELETE FROM link_requests WHERE code = ? RETURNING *')
    .get(code);
  if (!row) return null;
  const result = mapLinkRequestRow(row);
  return result.expiresAt > Date.now() ? result : null;
};

// Read-only lookup for preview routes. Does NOT delete - the actual
// link still has to run through consumeLinkRequest, which atomically
// burns the row. The preview is allowed to lie if the row expired
// between peek and consume; the consume call will then 409.
export const peekLinkRequest = async (code: string) => {
  const db = await getDb();
  pruneExpiredLinkRequests(db);
  if (!code) return null;
  const row = db
    .prepare('SELECT * FROM link_requests WHERE code = ? LIMIT 1')
    .get(code);
  if (!row) return null;
  const result = mapLinkRequestRow(row);
  return result.expiresAt > Date.now() ? result : null;
};
