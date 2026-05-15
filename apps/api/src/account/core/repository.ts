import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AccountAuditEventType,
  AccountMergePreview,
  AccountProvider,
  BillingProductId,
  BillingProvider,
  DatabaseLike,
  LegacyStore,
  LibraryMergeStrategy,
  PremiumStatus,
  ProviderKind,
  SessionEntitlement,
  StationProfileRecord,
  StoredAccount,
  SupporterTier
} from './types.js';
import * as helpers from './helpers.js';

const {
  AUDIT_LIMIT_DEFAULT,
  BILLING_PRODUCTS,
  EMPTY_LIBRARY_COUNTS,
  SESSION_TTL_MS,
  SUPPORTER_ENTITLEMENTS,
  buildAccountSkeleton,
  deriveAccountIdentity,
  deserializeLibrary,
  libraryCounts,
  mapAccount,
  mapAuditEvent,
  mapProvider,
  mergeLibraries,
  normalizeEntitlements,
  parseSocialLinks,
  previewParty,
  providerDisplayName,
  safeNumber,
  safeText,
  sanitizeLibrary,
  serializeLibrary
} = helpers;

const DB_URL = new URL('../../../data/account-store.sqlite', import.meta.url);
const LEGACY_JSON_URL = new URL('../../../data/account-store.json', import.meta.url);
let dbPromise: Promise<DatabaseLike> | null = null;

export const defaultDatabaseFilePath = fileURLToPath(DB_URL);
export const configuredDatabaseFilePath = (() => {
  const configured = String(process.env.ACCOUNT_STORE_PATH || '').trim();
  if (!configured) return defaultDatabaseFilePath;
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
})();
export const databaseFilePath = configuredDatabaseFilePath;
export const databaseDirPath = dirname(databaseFilePath);

export const getDb = async () => {
  if (!dbPromise) {
    dbPromise = (async () => {
      await mkdir(databaseDirPath, { recursive: true });
      const sqliteModuleName = 'node:sqlite';
      const sqlite = await import(sqliteModuleName);
      const db = new sqlite.DatabaseSync(databaseFilePath) as DatabaseLike;
      db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          username TEXT,
          email TEXT,
          photo_url TEXT,
          is_premium INTEGER NOT NULL DEFAULT 0,
          premium_status TEXT NOT NULL DEFAULT 'free',
          supporter_tier TEXT NOT NULL DEFAULT 'none',
          entitlements_json TEXT NOT NULL DEFAULT '[]',
          billing_provider TEXT,
          library_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS providers (
          kind TEXT NOT NULL,
          external_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          username TEXT,
          email TEXT,
          photo_url TEXT,
          is_premium INTEGER NOT NULL DEFAULT 0,
          linked_at INTEGER NOT NULL,
          PRIMARY KEY (kind, external_id),
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS link_requests (
          code TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          merge_strategy TEXT NOT NULL DEFAULT 'combine',
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS audit_events (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          type TEXT NOT NULL,
          provider_kind TEXT,
          provider_external_id TEXT,
          payload_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_providers_account_id ON providers(account_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_account_id ON sessions(account_id);
        CREATE INDEX IF NOT EXISTS idx_link_requests_account_id ON link_requests(account_id);
        CREATE INDEX IF NOT EXISTS idx_audit_events_account_id_created_at ON audit_events(account_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS billing_purchases (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          recipient_account_id TEXT,
          product_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          amount INTEGER NOT NULL,
          currency TEXT NOT NULL,
          status TEXT NOT NULL,
          provider TEXT NOT NULL,
          payload TEXT NOT NULL,
          telegram_charge_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS station_profiles (
          stationuuid TEXT PRIMARY KEY,
          owner_account_id TEXT,
          display_name TEXT NOT NULL,
          description TEXT,
          artwork_url TEXT,
          website_url TEXT,
          social_links_json TEXT NOT NULL DEFAULT '[]',
          schedule_note TEXT,
          editorial_pitch TEXT,
          is_verified INTEGER NOT NULL DEFAULT 0,
          is_promoted INTEGER NOT NULL DEFAULT 0,
          promoted_until INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (owner_account_id) REFERENCES accounts(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS promotion_events (
          id TEXT PRIMARY KEY,
          stationuuid TEXT NOT NULL,
          event_type TEXT NOT NULL,
          source_id TEXT,
          account_id TEXT,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_billing_purchases_account_id ON billing_purchases(account_id);
        CREATE INDEX IF NOT EXISTS idx_station_profiles_owner ON station_profiles(owner_account_id);
        CREATE INDEX IF NOT EXISTS idx_promotion_events_station_created_at ON promotion_events(stationuuid, created_at DESC);
      `);
      try {
        db.exec(`ALTER TABLE link_requests ADD COLUMN merge_strategy TEXT NOT NULL DEFAULT 'combine';`);
      } catch {
        // column already exists
      }
      try {
        db.exec(`ALTER TABLE accounts ADD COLUMN premium_status TEXT NOT NULL DEFAULT 'free';`);
      } catch {}
      try {
        db.exec(`ALTER TABLE accounts ADD COLUMN supporter_tier TEXT NOT NULL DEFAULT 'none';`);
      } catch {}
      try {
        db.exec(`ALTER TABLE accounts ADD COLUMN entitlements_json TEXT NOT NULL DEFAULT '[]';`);
      } catch {}
      try {
        db.exec(`ALTER TABLE accounts ADD COLUMN billing_provider TEXT;`);
      } catch {}
      ensureSessionExpiresAtColumn(db);
      await migrateLegacyJsonIfNeeded(db);
      pruneExpiredLinkRequests(db);
      pruneExpiredSessions(db);
      return db;
    })();
  }
  return dbPromise;
};

export const countAccounts = (db: DatabaseLike) => {
  const row = db.prepare('SELECT COUNT(*) AS count FROM accounts').get();
  return safeNumber(row?.count) ?? 0;
};

export const upsertAccount = (db: DatabaseLike, account: StoredAccount) => {
  db.prepare(`
    INSERT INTO accounts (
      id, display_name, username, email, photo_url, is_premium, premium_status, supporter_tier,
      entitlements_json, billing_provider, library_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name,
      username = excluded.username,
      email = excluded.email,
      photo_url = excluded.photo_url,
      is_premium = excluded.is_premium,
      premium_status = excluded.premium_status,
      supporter_tier = excluded.supporter_tier,
      entitlements_json = excluded.entitlements_json,
      billing_provider = excluded.billing_provider,
      library_json = excluded.library_json,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `).run(
    account.id,
    account.displayName,
    account.username,
    account.email,
    account.photoUrl,
    account.isPremium ? 1 : 0,
    account.premiumStatus,
    account.supporterTier,
    JSON.stringify(account.entitlements),
    account.billingProvider,
    serializeLibrary(account.library),
    account.createdAt,
    account.updatedAt
  );
};

export const upsertProvider = (db: DatabaseLike, accountId: string, provider: AccountProvider) => {
  db.prepare(`
    INSERT INTO providers (
      kind, external_id, account_id, display_name, username, email, photo_url, is_premium, linked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(kind, external_id) DO UPDATE SET
      account_id = excluded.account_id,
      display_name = excluded.display_name,
      username = excluded.username,
      email = excluded.email,
      photo_url = excluded.photo_url,
      is_premium = excluded.is_premium,
      linked_at = excluded.linked_at
  `).run(
    provider.kind,
    provider.externalId,
    accountId,
    provider.displayName,
    provider.username,
    provider.email,
    provider.photoUrl,
    provider.isPremium ? 1 : 0,
    provider.linkedAt
  );
};

export const deleteProvidersForAccount = (db: DatabaseLike, accountId: string) => {
  db.prepare('DELETE FROM providers WHERE account_id = ?').run(accountId);
};

export const saveAccount = (db: DatabaseLike, account: StoredAccount) => {
  upsertAccount(db, account);
  deleteProvidersForAccount(db, account.id);
  account.providers.forEach((provider) => upsertProvider(db, account.id, provider));
};

export const recordAuditEventSync = (
  db: DatabaseLike,
  accountId: string,
  type: AccountAuditEventType,
  payload: Record<string, unknown> = {},
  provider?: Pick<AccountProvider, 'kind' | 'externalId'>
) => {
  db.prepare(`
    INSERT INTO audit_events (
      id, account_id, type, provider_kind, provider_external_id, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    accountId,
    type,
    provider?.kind || null,
    provider?.externalId || null,
    JSON.stringify(payload),
    Date.now()
  );
};

export const recordAccountEvent = async (
  accountId: string,
  type: AccountAuditEventType,
  payload: Record<string, unknown> = {},
  provider?: Pick<AccountProvider, 'kind' | 'externalId'>
) => {
  const db = await getDb();
  recordAuditEventSync(db, accountId, type, payload, provider);
};

export const getAccountProviders = (db: DatabaseLike, accountId: string) =>
  db
    .prepare('SELECT * FROM providers WHERE account_id = ? ORDER BY linked_at ASC')
    .all(accountId)
    .map(mapProvider);

export const getAccountByIdSync = (db: DatabaseLike, accountId: string) => {
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!row) return null;
  return mapAccount(row, getAccountProviders(db, accountId));
};

export const getAccountByProviderSync = (db: DatabaseLike, kind: ProviderKind, externalId: string) => {
  const row = db
    .prepare(`
      SELECT a.*
      FROM providers p
      JOIN accounts a ON a.id = p.account_id
      WHERE p.kind = ? AND p.external_id = ?
      LIMIT 1
    `)
    .get(kind, externalId);
  if (!row) return null;
  return mapAccount(row, getAccountProviders(db, String(row.id)));
};

export const mapStationProfile = (row: Record<string, unknown>): StationProfileRecord => ({
  stationuuid: safeText(row.stationuuid),
  ownerAccountId: safeText(row.owner_account_id) || null,
  displayName: safeText(row.display_name, 'Claimed station'),
  description: safeText(row.description) || null,
  artworkUrl: safeText(row.artwork_url) || null,
  websiteUrl: safeText(row.website_url) || null,
  socialLinks: parseSocialLinks(row.social_links_json),
  scheduleNote: safeText(row.schedule_note) || null,
  editorialPitch: safeText(row.editorial_pitch) || null,
  isVerified: Boolean(row.is_verified),
  isPromoted: Boolean(row.is_promoted),
  promotedUntil: safeNumber(row.promoted_until),
  createdAt: safeNumber(row.created_at) ?? Date.now(),
  updatedAt: safeNumber(row.updated_at) ?? Date.now()
});

export const getStationProfileSync = (db: DatabaseLike, stationuuid: string) => {
  const row = db.prepare('SELECT * FROM station_profiles WHERE stationuuid = ?').get(stationuuid);
  return row ? mapStationProfile(row) : null;
};

export const upsertStationProfileSync = (db: DatabaseLike, profile: StationProfileRecord) => {
  db.prepare(`
    INSERT INTO station_profiles (
      stationuuid, owner_account_id, display_name, description, artwork_url, website_url, social_links_json,
      schedule_note, editorial_pitch, is_verified, is_promoted, promoted_until, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(stationuuid) DO UPDATE SET
      owner_account_id = excluded.owner_account_id,
      display_name = excluded.display_name,
      description = excluded.description,
      artwork_url = excluded.artwork_url,
      website_url = excluded.website_url,
      social_links_json = excluded.social_links_json,
      schedule_note = excluded.schedule_note,
      editorial_pitch = excluded.editorial_pitch,
      is_verified = excluded.is_verified,
      is_promoted = excluded.is_promoted,
      promoted_until = excluded.promoted_until,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `).run(
    profile.stationuuid,
    profile.ownerAccountId,
    profile.displayName,
    profile.description,
    profile.artworkUrl,
    profile.websiteUrl,
    JSON.stringify(profile.socialLinks),
    profile.scheduleNote,
    profile.editorialPitch,
    profile.isVerified ? 1 : 0,
    profile.isPromoted ? 1 : 0,
    profile.promotedUntil,
    profile.createdAt,
    profile.updatedAt
  );
};

export const getBillingProductById = (productId: BillingProductId) =>
  BILLING_PRODUCTS.find((product) => product.id === productId) || null;

export const applyEntitlementPreset = (
  account: StoredAccount,
  status: PremiumStatus,
  tier: SupporterTier,
  entitlements: SessionEntitlement[],
  billingProvider: BillingProvider
): StoredAccount => ({
  ...account,
  isPremium: status === 'premium',
  premiumStatus: status,
  supporterTier: tier,
  entitlements: normalizeEntitlements(entitlements),
  billingProvider,
  updatedAt: Date.now()
});

export const recordPromotionEventSync = (
  db: DatabaseLike,
  stationuuid: string,
  eventType: 'impression' | 'click' | 'play-start' | 'favorite-after-click',
  sourceId?: string | null,
  accountId?: string | null
) => {
  db.prepare(`
    INSERT INTO promotion_events (id, stationuuid, event_type, source_id, account_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), stationuuid, eventType, sourceId || null, accountId || null, Date.now());
};

export const buildMergePreview = (
  providerKind: ProviderKind,
  providerLabel: string,
  strategy: LibraryMergeStrategy,
  currentAccount: StoredAccount | null,
  incomingAccount: StoredAccount | null
): AccountMergePreview => {
  if (!currentAccount && !incomingAccount) {
    return {
      mode: 'create-profile',
      providerKind,
      providerLabel,
      strategy,
      requiresConfirmation: false,
      current: null,
      incoming: null,
      result: EMPTY_LIBRARY_COUNTS
    };
  }

  if (!currentAccount && incomingAccount) {
    return {
      mode: 'sign-in-existing',
      providerKind,
      providerLabel,
      strategy,
      requiresConfirmation: false,
      current: null,
      incoming: previewParty(incomingAccount),
      result: libraryCounts(incomingAccount.library)
    };
  }

  if (currentAccount && !incomingAccount) {
    return {
      mode: 'attach-new-provider',
      providerKind,
      providerLabel,
      strategy,
      requiresConfirmation: false,
      current: previewParty(currentAccount),
      incoming: null,
      result: libraryCounts(currentAccount.library)
    };
  }

  if (currentAccount && incomingAccount && currentAccount.id === incomingAccount.id) {
    return {
      mode: 'same-profile',
      providerKind,
      providerLabel,
      strategy,
      requiresConfirmation: false,
      current: previewParty(currentAccount),
      incoming: previewParty(incomingAccount),
      result: libraryCounts(currentAccount.library)
    };
  }

  const nextLibrary = mergeLibraries(currentAccount!.library, incomingAccount!.library, strategy);
  return {
    mode: 'merge-conflict',
    providerKind,
    providerLabel,
    strategy,
    requiresConfirmation: true,
    current: previewParty(currentAccount!),
    incoming: previewParty(incomingAccount!),
    result: libraryCounts(nextLibrary)
  };
};

export const mergeAccountsSync = (
  db: DatabaseLike,
  targetAccountId: string,
  sourceAccountId: string,
  strategy: LibraryMergeStrategy = 'combine'
) => {
  if (targetAccountId === sourceAccountId) {
    return getAccountByIdSync(db, targetAccountId);
  }

  const target = getAccountByIdSync(db, targetAccountId);
  const source = getAccountByIdSync(db, sourceAccountId);
  if (!target || !source) {
    return target || source || null;
  }

  const mergedProviders = [...target.providers];
  source.providers.forEach((provider) => {
    if (
      !mergedProviders.some(
        (item) => item.kind === provider.kind && item.externalId === provider.externalId
      )
    ) {
      mergedProviders.push(provider);
    }
  });

  const mergedAccount: StoredAccount = {
    ...target,
    providers: mergedProviders,
    library: mergeLibraries(target.library, source.library, strategy),
    displayName: target.displayName || source.displayName,
    username: target.username || source.username,
    email: target.email || source.email,
    photoUrl: target.photoUrl || source.photoUrl,
    isPremium: target.isPremium || source.isPremium,
    premiumStatus:
      target.premiumStatus === 'premium' || source.premiumStatus === 'premium'
        ? 'premium'
        : target.premiumStatus === 'supporter' || source.premiumStatus === 'supporter'
          ? 'supporter'
          : 'free',
    supporterTier:
      target.supporterTier === 'patron' || source.supporterTier === 'patron'
        ? 'patron'
        : target.supporterTier === 'supporter' || source.supporterTier === 'supporter'
          ? 'supporter'
          : 'none',
    entitlements: normalizeEntitlements([...target.entitlements, ...source.entitlements]),
    billingProvider: target.billingProvider || source.billingProvider,
    updatedAt: Date.now()
  };

  saveAccount(db, mergedAccount);
  db.prepare('UPDATE sessions SET account_id = ?, updated_at = ? WHERE account_id = ?').run(
    targetAccountId,
    Date.now(),
    sourceAccountId
  );
  db.prepare('UPDATE link_requests SET account_id = ? WHERE account_id = ?').run(
    targetAccountId,
    sourceAccountId
  );
  recordAuditEventSync(db, targetAccountId, 'account_merged', {
    sourceAccountId,
    sourceProviders: source.providers.map((provider) => provider.kind),
    mergeStrategy: strategy
  });
  db.prepare('DELETE FROM audit_events WHERE account_id = ?').run(sourceAccountId);
  db.prepare('DELETE FROM providers WHERE account_id = ?').run(sourceAccountId);
  db.prepare('DELETE FROM accounts WHERE id = ?').run(sourceAccountId);
  return getAccountByIdSync(db, targetAccountId);
};

export const ensureProviderLinkedSync = (
  db: DatabaseLike,
  accountId: string,
  provider: AccountProvider
) => {
  const current = getAccountByIdSync(db, accountId);
  if (!current) return null;

  const existing = current.providers.find(
    (item) => item.kind === provider.kind && item.externalId === provider.externalId
  );
  const nextProviders = existing
    ? current.providers.map((item) =>
        item.kind === provider.kind && item.externalId === provider.externalId ? provider : item
      )
    : [...current.providers, provider];

  const nextAccount: StoredAccount = {
    ...current,
    providers: nextProviders,
    ...deriveAccountIdentity(current, nextProviders),
    premiumStatus: provider.isPremium
      ? current.premiumStatus === 'premium'
        ? 'premium'
        : 'supporter'
      : current.premiumStatus,
    supporterTier: provider.isPremium
      ? current.supporterTier === 'patron'
        ? 'patron'
        : 'supporter'
      : current.supporterTier,
    entitlements: normalizeEntitlements(
      provider.isPremium ? [...current.entitlements, ...SUPPORTER_ENTITLEMENTS] : current.entitlements
    ),
    billingProvider: provider.isPremium ? current.billingProvider || 'telegram-stars' : current.billingProvider,
    updatedAt: Date.now()
  };

  saveAccount(db, nextAccount);

  if (!existing) {
    recordAuditEventSync(
      db,
      accountId,
      'provider_linked',
      { label: providerDisplayName(provider) },
      provider
    );
  }

  return getAccountByIdSync(db, accountId);
};

export const migrateLegacyJsonIfNeeded = async (db: DatabaseLike) => {
  if (countAccounts(db) > 0) {
    return;
  }

  try {
    const raw = await readFile(LEGACY_JSON_URL, 'utf8');
    const parsed = JSON.parse(raw) as LegacyStore;

    const migratedAccounts: StoredAccount[] = [];
    if (parsed.accounts) {
      migratedAccounts.push(
        ...Object.values(parsed.accounts).map((account) =>
          buildAccountSkeleton({
            ...account,
            library: sanitizeLibrary(account.library),
            providers: Array.isArray(account.providers)
              ? account.providers.map((provider) => ({
                  ...provider,
                  kind: provider.kind,
                  externalId: safeText(provider.externalId),
                  displayName: safeText(provider.displayName),
                  username: safeText(provider.username) || null,
                  email: safeText(provider.email) || null,
                  photoUrl: safeText(provider.photoUrl) || null,
                  isPremium: Boolean(provider.isPremium),
                  linkedAt: safeNumber(provider.linkedAt) ?? Date.now()
                }))
              : []
          })
        )
      );
    } else if (parsed.profiles) {
      migratedAccounts.push(
        ...Object.values(parsed.profiles).map((profile) =>
          buildAccountSkeleton({
            id: profile.id,
            displayName: profile.displayName,
            username: profile.username,
            photoUrl: profile.photoUrl,
            isPremium: profile.isPremium,
            library: sanitizeLibrary(profile.library),
            createdAt: profile.createdAt,
            updatedAt: profile.updatedAt,
            providers: [
              {
                kind: 'telegram',
                externalId: String(profile.telegramUserId),
                displayName: profile.displayName,
                username: profile.username,
                email: null,
                photoUrl: profile.photoUrl,
                isPremium: profile.isPremium,
                linkedAt: profile.createdAt
              }
            ]
          })
        )
      );
    }

    migratedAccounts.forEach((account) => saveAccount(db, account));

    if (parsed.sessions) {
      Object.values(parsed.sessions).forEach((session) => {
        const accountId =
          'accountId' in session && typeof session.accountId === 'string'
            ? session.accountId
            : 'profileId' in session && typeof session.profileId === 'string'
              ? session.profileId
              : '';
        if (!accountId) return;
        db.prepare(`
          INSERT OR REPLACE INTO sessions (token, account_id, created_at, updated_at)
          VALUES (?, ?, ?, ?)
        `).run(session.token, accountId, session.createdAt, session.updatedAt);
      });
    }

    Object.values(parsed.linkRequests || {}).forEach((request) => {
      db.prepare(`
        INSERT OR REPLACE INTO link_requests (code, account_id, merge_strategy, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        request.code,
        request.accountId,
        request.mergeStrategy || 'combine',
        request.createdAt,
        request.expiresAt
      );
    });
  } catch {
    // ignore missing or malformed legacy store
  }
};

export const pruneExpiredLinkRequests = (db: DatabaseLike) => {
  db.prepare('DELETE FROM link_requests WHERE expires_at <= ?').run(Date.now());
};

// T3.4 will fold this into the numbered migration list. Until then it is
// intentionally NOT inside the silent try/catch ALTER chain above: a real
// failure here aborts boot loudly. The column is added with DEFAULT 0 so
// existing rows survive the ALTER, then back-filled to a fresh window so
// the new sliding-renewal logic does not immediately invalidate live
// sessions on the upgrade boot.
export const ensureSessionExpiresAtColumn = (db: DatabaseLike) => {
  const columns = db.prepare('PRAGMA table_info(sessions)').all() as Array<
    Record<string, unknown>
  >;
  const hasColumn = columns.some((column) => safeText(column.name) === 'expires_at');
  if (!hasColumn) {
    db.exec(`ALTER TABLE sessions ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)`);
  db.prepare('UPDATE sessions SET expires_at = ? WHERE expires_at = 0').run(
    Date.now() + SESSION_TTL_MS
  );
};

export const pruneExpiredSessions = (db: DatabaseLike) => {
  db.prepare('DELETE FROM sessions WHERE expires_at > 0 AND expires_at <= ?').run(Date.now());
};
