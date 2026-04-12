import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export type SyncedStation = {
  stationuuid: string;
  name: string;
  url_resolved: string;
  favicon: string;
  country: string;
  state: string;
  tags: string;
  geo_lat: number | null;
  geo_long: number | null;
};

export type SyncedTrackHistoryItem = {
  id: string;
  stationId: string;
  stationName: string;
  track: string;
  timestamp: number;
};

export type SyncedLibrary = {
  favorites: SyncedStation[];
  recent: SyncedStation[];
  trackHistory: SyncedTrackHistoryItem[];
  updatedAt: number;
};

export type ProviderKind = 'telegram' | 'google';
export type LibraryMergeStrategy = 'combine' | 'prefer-current' | 'prefer-incoming';

export type AccountProvider = {
  kind: ProviderKind;
  externalId: string;
  displayName: string;
  username: string | null;
  email: string | null;
  photoUrl: string | null;
  isPremium: boolean;
  linkedAt: number;
};

export type StoredAccount = {
  id: string;
  displayName: string;
  username: string | null;
  email: string | null;
  photoUrl: string | null;
  isPremium: boolean;
  providers: AccountProvider[];
  library: SyncedLibrary;
  createdAt: number;
  updatedAt: number;
};

export type AccountAuditEventType =
  | 'account_created'
  | 'provider_linked'
  | 'provider_unlinked'
  | 'account_merged'
  | 'session_created'
  | 'sign_in'
  | 'library_synced'
  | 'link_request_created';

export type AccountAuditEvent = {
  id: string;
  accountId: string;
  type: AccountAuditEventType;
  providerKind: ProviderKind | null;
  providerExternalId: string | null;
  payload: Record<string, unknown>;
  createdAt: number;
};

export type LibraryCounts = {
  favorites: number;
  recent: number;
  trackHistory: number;
};

export type MergePreviewParty = {
  accountId: string;
  displayName: string;
  providers: ProviderKind[];
  counts: LibraryCounts;
};

export type AccountMergePreview = {
  mode: 'create-profile' | 'attach-new-provider' | 'sign-in-existing' | 'same-profile' | 'merge-conflict';
  providerKind: ProviderKind;
  providerLabel: string;
  strategy: LibraryMergeStrategy;
  requiresConfirmation: boolean;
  current: MergePreviewParty | null;
  incoming: MergePreviewParty | null;
  result: LibraryCounts;
};

type LinkRequest = {
  code: string;
  accountId: string;
  mergeStrategy: LibraryMergeStrategy;
  createdAt: number;
  expiresAt: number;
};

type StoredSession = {
  token: string;
  accountId: string;
  createdAt: number;
  updatedAt: number;
};

type LegacyProfile = {
  id: string;
  provider: 'telegram';
  telegramUserId: number;
  displayName: string;
  username: string | null;
  photoUrl: string | null;
  isPremium: boolean;
  library: SyncedLibrary;
  createdAt: number;
  updatedAt: number;
};

type LegacyStore = {
  profiles?: Record<string, LegacyProfile>;
  sessions?: Record<string, { token: string; profileId: string; createdAt: number; updatedAt: number }>;
  accounts?: Record<string, StoredAccount>;
  linkRequests?: Record<string, LinkRequest>;
};

type DatabaseLike = {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    run: (...params: unknown[]) => unknown;
    get: (...params: unknown[]) => Record<string, unknown> | undefined;
    all: (...params: unknown[]) => Array<Record<string, unknown>>;
  };
};

const DATA_DIR_URL = new URL('../data/', import.meta.url);
const DB_URL = new URL('../data/account-store.sqlite', import.meta.url);
const LEGACY_JSON_URL = new URL('../data/account-store.json', import.meta.url);
const LINK_REQUEST_TTL_MS = 1000 * 60 * 10;
const AUDIT_LIMIT_DEFAULT = 12;

let dbPromise: Promise<DatabaseLike> | null = null;

const safeText = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value.trim().slice(0, 320) || fallback : fallback;

const safeNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const sanitizeStation = (value: unknown): SyncedStation | null => {
  if (!value || typeof value !== 'object') return null;
  const station = value as Record<string, unknown>;
  const stationuuid = safeText(station.stationuuid);
  const name = safeText(station.name);
  const urlResolved = safeText(station.url_resolved);
  if (!stationuuid || !name || !urlResolved) return null;
  return {
    stationuuid,
    name,
    url_resolved: urlResolved,
    favicon: safeText(station.favicon),
    country: safeText(station.country),
    state: safeText(station.state),
    tags: safeText(station.tags),
    geo_lat: safeNumber(station.geo_lat),
    geo_long: safeNumber(station.geo_long)
  };
};

const sanitizeTrackHistoryItem = (value: unknown): SyncedTrackHistoryItem | null => {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const stationId = safeText(item.stationId);
  const track = safeText(item.track);
  const stationName = safeText(item.stationName);
  const timestamp = safeNumber(item.timestamp) ?? Date.now();
  if (!stationId || !track || !stationName) return null;
  return {
    id: safeText(item.id, `${timestamp}-${stationId}`),
    stationId,
    stationName,
    track,
    timestamp
  };
};

const uniqueStations = (items: SyncedStation[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.stationuuid)) return false;
    seen.add(item.stationuuid);
    return true;
  });
};

const uniqueTrackHistory = (items: SyncedTrackHistoryItem[]) => {
  const seen = new Set<string>();
  return items
    .sort((left, right) => right.timestamp - left.timestamp)
    .filter((item) => {
      const key = `${item.stationId}:${item.track.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const sanitizeLibrary = (value: unknown): SyncedLibrary => {
  const payload = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    favorites: uniqueStations(
      Array.isArray(payload.favorites)
        ? (payload.favorites.map(sanitizeStation).filter(Boolean) as SyncedStation[])
        : []
    ).slice(0, 200),
    recent: uniqueStations(
      Array.isArray(payload.recent)
        ? (payload.recent.map(sanitizeStation).filter(Boolean) as SyncedStation[])
        : []
    ).slice(0, 80),
    trackHistory: uniqueTrackHistory(
      Array.isArray(payload.trackHistory)
        ? (payload.trackHistory.map(sanitizeTrackHistoryItem).filter(Boolean) as SyncedTrackHistoryItem[])
        : []
    ).slice(0, 200),
    updatedAt: Date.now()
  };
};

const serializeLibrary = (library: SyncedLibrary) => JSON.stringify(sanitizeLibrary(library));

const deserializeLibrary = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) {
    return sanitizeLibrary(null);
  }
  try {
    return sanitizeLibrary(JSON.parse(value));
  } catch {
    return sanitizeLibrary(null);
  }
};

const mergeLibraries = (
  primary: SyncedLibrary,
  secondary: SyncedLibrary,
  strategy: LibraryMergeStrategy = 'combine'
): SyncedLibrary => {
  if (strategy === 'prefer-current') {
    return {
      ...sanitizeLibrary(primary),
      updatedAt: Date.now()
    };
  }

  if (strategy === 'prefer-incoming') {
    return {
      ...sanitizeLibrary(secondary),
      updatedAt: Date.now()
    };
  }

  return {
    favorites: uniqueStations([...primary.favorites, ...secondary.favorites]).slice(0, 200),
    recent: uniqueStations([...primary.recent, ...secondary.recent]).slice(0, 80),
    trackHistory: uniqueTrackHistory([...primary.trackHistory, ...secondary.trackHistory]).slice(0, 200),
    updatedAt: Date.now()
  };
};

const providerDisplayName = (provider: AccountProvider) =>
  provider.email || provider.username || provider.displayName;

const libraryCounts = (library: SyncedLibrary): LibraryCounts => ({
  favorites: library.favorites.length,
  recent: library.recent.length,
  trackHistory: library.trackHistory.length
});

const previewParty = (account: StoredAccount): MergePreviewParty => ({
  accountId: account.id,
  displayName: account.displayName,
  providers: account.providers.map((provider) => provider.kind),
  counts: libraryCounts(account.library)
});

const deriveAccountIdentity = (
  current: StoredAccount,
  providers: AccountProvider[]
) => {
  const ordered = [...providers].sort((left, right) => left.linkedAt - right.linkedAt);
  const primary = ordered[0] || null;
  return {
    displayName: primary?.displayName || current.displayName || 'RadioAtlas listener',
    username:
      ordered.find((provider) => provider.username)?.username || current.username || null,
    email: ordered.find((provider) => provider.email)?.email || current.email || null,
    photoUrl: ordered.find((provider) => provider.photoUrl)?.photoUrl || current.photoUrl || null,
    isPremium: ordered.some((provider) => provider.isPremium) || current.isPremium
  };
};

const buildAccountSkeleton = (fields: Partial<StoredAccount>): StoredAccount => ({
  id: fields.id || randomUUID(),
  displayName: fields.displayName || 'RadioAtlas listener',
  username: fields.username || null,
  email: fields.email || null,
  photoUrl: fields.photoUrl || null,
  isPremium: Boolean(fields.isPremium),
  providers: fields.providers || [],
  library: fields.library || sanitizeLibrary(null),
  createdAt: fields.createdAt || Date.now(),
  updatedAt: fields.updatedAt || Date.now()
});

const mapProvider = (row: Record<string, unknown>): AccountProvider => ({
  kind: String(row.kind) as ProviderKind,
  externalId: String(row.external_id || ''),
  displayName: safeText(row.display_name),
  username: safeText(row.username) || null,
  email: safeText(row.email) || null,
  photoUrl: safeText(row.photo_url) || null,
  isPremium: Boolean(row.is_premium),
  linkedAt: safeNumber(row.linked_at) ?? Date.now()
});

const mapAccount = (row: Record<string, unknown>, providers: AccountProvider[]): StoredAccount => ({
  id: String(row.id),
  displayName: safeText(row.display_name, 'RadioAtlas listener'),
  username: safeText(row.username) || null,
  email: safeText(row.email) || null,
  photoUrl: safeText(row.photo_url) || null,
  isPremium: Boolean(row.is_premium),
  providers,
  library: deserializeLibrary(row.library_json),
  createdAt: safeNumber(row.created_at) ?? Date.now(),
  updatedAt: safeNumber(row.updated_at) ?? Date.now()
});

const mapAuditEvent = (row: Record<string, unknown>): AccountAuditEvent => ({
  id: String(row.id),
  accountId: String(row.account_id),
  type: String(row.type) as AccountAuditEventType,
  providerKind: row.provider_kind ? (String(row.provider_kind) as ProviderKind) : null,
  providerExternalId: safeText(row.provider_external_id) || null,
  payload: (() => {
    const raw = safeText(row.payload_json);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  })(),
  createdAt: safeNumber(row.created_at) ?? Date.now()
});

const databaseFilePath = fileURLToPath(DB_URL);

const getDb = async () => {
  if (!dbPromise) {
    dbPromise = (async () => {
      await mkdir(DATA_DIR_URL, { recursive: true });
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
      `);
      try {
        db.exec(`ALTER TABLE link_requests ADD COLUMN merge_strategy TEXT NOT NULL DEFAULT 'combine';`);
      } catch {
        // column already exists
      }
      await migrateLegacyJsonIfNeeded(db);
      pruneExpiredLinkRequests(db);
      return db;
    })();
  }
  return dbPromise;
};

const countAccounts = (db: DatabaseLike) => {
  const row = db.prepare('SELECT COUNT(*) AS count FROM accounts').get();
  return safeNumber(row?.count) ?? 0;
};

const upsertAccount = (db: DatabaseLike, account: StoredAccount) => {
  db.prepare(`
    INSERT INTO accounts (
      id, display_name, username, email, photo_url, is_premium, library_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name,
      username = excluded.username,
      email = excluded.email,
      photo_url = excluded.photo_url,
      is_premium = excluded.is_premium,
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
    serializeLibrary(account.library),
    account.createdAt,
    account.updatedAt
  );
};

const upsertProvider = (db: DatabaseLike, accountId: string, provider: AccountProvider) => {
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

const deleteProvidersForAccount = (db: DatabaseLike, accountId: string) => {
  db.prepare('DELETE FROM providers WHERE account_id = ?').run(accountId);
};

const saveAccount = (db: DatabaseLike, account: StoredAccount) => {
  upsertAccount(db, account);
  deleteProvidersForAccount(db, account.id);
  account.providers.forEach((provider) => upsertProvider(db, account.id, provider));
};

const recordAuditEventSync = (
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

const getAccountProviders = (db: DatabaseLike, accountId: string) =>
  db
    .prepare('SELECT * FROM providers WHERE account_id = ? ORDER BY linked_at ASC')
    .all(accountId)
    .map(mapProvider);

const getAccountByIdSync = (db: DatabaseLike, accountId: string) => {
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!row) return null;
  return mapAccount(row, getAccountProviders(db, accountId));
};

const getAccountByProviderSync = (db: DatabaseLike, kind: ProviderKind, externalId: string) => {
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

const buildMergePreview = (
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
      result: { favorites: 0, recent: 0, trackHistory: 0 }
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

const mergeAccountsSync = (
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

const ensureProviderLinkedSync = (
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

const migrateLegacyJsonIfNeeded = async (db: DatabaseLike) => {
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

const pruneExpiredLinkRequests = (db: DatabaseLike) => {
  db.prepare('DELETE FROM link_requests WHERE expires_at <= ?').run(Date.now());
};

export const getAccountAuditTrail = async (accountId: string, limit = AUDIT_LIMIT_DEFAULT) => {
  const db = await getDb();
  const safeLimit = Math.max(1, Math.min(limit, 50));
  return db
    .prepare(`
      SELECT *
      FROM audit_events
      WHERE account_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(accountId, safeLimit)
    .map(mapAuditEvent);
};

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
      isPremium: provider.isPremium
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
      photoUrl: provider.photoUrl
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

export const updateAccountLibrary = async (accountId: string, library: unknown) => {
  const db = await getDb();
  const current = getAccountByIdSync(db, accountId);
  if (!current) return null;
  const nextAccount: StoredAccount = {
    ...current,
    library: sanitizeLibrary(library),
    updatedAt: Date.now()
  };
  saveAccount(db, nextAccount);
  recordAuditEventSync(db, accountId, 'library_synced', {
    favorites: nextAccount.library.favorites.length,
    recent: nextAccount.library.recent.length,
    trackHistory: nextAccount.library.trackHistory.length
  });
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
