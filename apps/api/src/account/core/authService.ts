import { randomUUID } from 'node:crypto';
import type { AccountProvider, LibraryMergeStrategy, LinkRequest, ProviderKind, StoredAccount } from './types.js';
import * as helpers from './helpers.js';
import * as repository from './repository.js';

const {
  LINK_REQUEST_TTL_MS,
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
  db.prepare(`
    INSERT INTO sessions (token, account_id, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(token, accountId, now, now);
  recordAuditEventSync(db, accountId, 'session_created', {});
  return token;
};

export const getAccountByToken = async (token: string) => {
  const db = await getDb();
  const session = db.prepare('SELECT * FROM sessions WHERE token = ? LIMIT 1').get(token);
  if (!session) return null;
  const accountId = safeText(session.account_id);
  if (!accountId) return null;
  db.prepare('UPDATE sessions SET updated_at = ? WHERE token = ?').run(Date.now(), token);
  return getAccountByIdSync(db, accountId);
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

export const consumeLinkRequest = async (code: string) => {
  const db = await getDb();
  pruneExpiredLinkRequests(db);
  const request = db.prepare('SELECT * FROM link_requests WHERE code = ? LIMIT 1').get(code);
  if (!request) {
    return null;
  }
  const result: LinkRequest = {
    code: String(request.code),
    accountId: String(request.account_id),
    mergeStrategy: (safeText(request.merge_strategy) as LibraryMergeStrategy) || 'combine',
    createdAt: safeNumber(request.created_at) ?? Date.now(),
    expiresAt: safeNumber(request.expires_at) ?? Date.now()
  };
  db.prepare('DELETE FROM link_requests WHERE code = ?').run(code);
  return result.expiresAt > Date.now() ? result : null;
};
