import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
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

export type UserCollection = {
  id: string;
  name: string;
  description: string | null;
  stationIds: string[];
  isPublic: boolean;
  updatedAt: number;
  createdAt: number;
  pinned: boolean;
};

export type FollowedStation = {
  stationId: string;
  stationName: string;
  country: string;
  createdAt: number;
  pinned: boolean;
  alerts: Array<'back-online' | 'track' | 'live-show'>;
};

export type FollowedRegion = {
  id: string;
  label: string;
  scope: 'country' | 'area';
  createdAt: number;
  pinned: boolean;
};

export type ListenerAlert = {
  id: string;
  kind: 'station-back-online' | 'track-available' | 'live-show' | 'region-activity';
  stationId: string | null;
  regionId: string | null;
  title: string;
  body: string;
  createdAt: number;
  readAt: number | null;
};

export type SyncedLibrary = {
  favorites: SyncedStation[];
  recent: SyncedStation[];
  trackHistory: SyncedTrackHistoryItem[];
  collections: UserCollection[];
  followedStations: FollowedStation[];
  followedRegions: FollowedRegion[];
  alerts: ListenerAlert[];
  updatedAt: number;
};

export type ProviderKind = 'telegram' | 'google';
export type LibraryMergeStrategy = 'combine' | 'prefer-current' | 'prefer-incoming';
export type PremiumStatus = 'free' | 'supporter' | 'premium';
export type SupporterTier = 'none' | 'supporter' | 'patron';
export type BillingProvider = 'telegram-stars' | 'manual' | null;
export type SessionEntitlement =
  | 'cloud-sync'
  | 'collections'
  | 'collection-folders'
  | 'advanced-history'
  | 'pinned-stations'
  | 'pinned-regions'
  | 'station-alerts'
  | 'cosmetic-pack'
  | 'sponsor-free';

export type BillingProductId =
  | 'support-small'
  | 'support-big'
  | 'premium-month'
  | 'premium-year'
  | 'premium-gift';

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
  premiumStatus: PremiumStatus;
  supporterTier: SupporterTier;
  entitlements: SessionEntitlement[];
  billingProvider: BillingProvider;
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
  | 'link_request_created'
  | 'entitlements_updated'
  | 'billing_purchase_created'
  | 'billing_purchase_confirmed'
  | 'station_claimed'
  | 'station_profile_updated';

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
  collections: number;
  followedStations: number;
  followedRegions: number;
  alerts: number;
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

export type BillingProduct = {
  id: BillingProductId;
  title: string;
  description: string;
  amount: number;
  currency: 'XTR';
  kind: 'donation' | 'premium' | 'gift-premium';
};

export type BillingPurchase = {
  id: string;
  accountId: string;
  recipientAccountId: string | null;
  productId: BillingProductId;
  kind: BillingProduct['kind'];
  amount: number;
  currency: 'XTR';
  status: 'pending' | 'paid' | 'failed';
  provider: 'telegram-stars';
  payload: string;
  telegramChargeId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type StationProfileRecord = {
  stationuuid: string;
  ownerAccountId: string | null;
  displayName: string;
  description: string | null;
  artworkUrl: string | null;
  websiteUrl: string | null;
  socialLinks: Array<{ label: string; url: string }>;
  scheduleNote: string | null;
  editorialPitch: string | null;
  isVerified: boolean;
  isPromoted: boolean;
  promotedUntil: number | null;
  createdAt: number;
  updatedAt: number;
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
const PREMIUM_ENTITLEMENTS: SessionEntitlement[] = [
  'cloud-sync',
  'collections',
  'collection-folders',
  'advanced-history',
  'pinned-stations',
  'pinned-regions',
  'station-alerts',
  'cosmetic-pack',
  'sponsor-free'
];
const SUPPORTER_ENTITLEMENTS: SessionEntitlement[] = ['cloud-sync', 'collections'];
const BILLING_PRODUCTS: BillingProduct[] = [
  {
    id: 'support-small',
    title: 'Support RadioAtlas',
    description: 'A small Telegram Stars donation to keep the radio atlas alive.',
    amount: 120,
    currency: 'XTR',
    kind: 'donation'
  },
  {
    id: 'support-big',
    title: 'Support RadioAtlas More',
    description: 'A larger Telegram Stars donation for the project.',
    amount: 360,
    currency: 'XTR',
    kind: 'donation'
  },
  {
    id: 'premium-month',
    title: 'RadioAtlas Premium',
    description: 'Premium listening tools, collections, alerts, and supporter cosmetics for one month.',
    amount: 250,
    currency: 'XTR',
    kind: 'premium'
  },
  {
    id: 'premium-year',
    title: 'RadioAtlas Premium Year',
    description: 'Annual Premium access with all listener features unlocked.',
    amount: 1800,
    currency: 'XTR',
    kind: 'premium'
  },
  {
    id: 'premium-gift',
    title: 'Gift RadioAtlas Premium',
    description: 'Gift a month of Premium to another listener.',
    amount: 300,
    currency: 'XTR',
    kind: 'gift-premium'
  }
];

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

const sanitizeCollection = (value: unknown): UserCollection | null => {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const name = safeText(item.name);
  if (!name) return null;
  const stationIds = Array.isArray(item.stationIds)
    ? item.stationIds.map((entry) => safeText(entry)).filter(Boolean).slice(0, 128)
    : [];
  const updatedAt = safeNumber(item.updatedAt) ?? Date.now();
  return {
    id: safeText(item.id, randomUUID()),
    name,
    description: safeText(item.description) || null,
    stationIds: Array.from(new Set(stationIds)),
    isPublic: Boolean(item.isPublic),
    updatedAt,
    createdAt: safeNumber(item.createdAt) ?? updatedAt,
    pinned: Boolean(item.pinned)
  };
};

const sanitizeFollowedStation = (value: unknown): FollowedStation | null => {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const stationId = safeText(item.stationId);
  const stationName = safeText(item.stationName);
  if (!stationId || !stationName) return null;
  const alerts = Array.isArray(item.alerts)
    ? item.alerts
        .map((entry) => safeText(entry))
        .filter((entry): entry is FollowedStation['alerts'][number] =>
          ['back-online', 'track', 'live-show'].includes(entry)
        )
    : [];
  return {
    stationId,
    stationName,
    country: safeText(item.country),
    createdAt: safeNumber(item.createdAt) ?? Date.now(),
    pinned: Boolean(item.pinned),
    alerts: Array.from(new Set(alerts))
  };
};

const sanitizeFollowedRegion = (value: unknown): FollowedRegion | null => {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const id = safeText(item.id);
  const label = safeText(item.label);
  if (!id || !label) return null;
  return {
    id,
    label,
    scope: safeText(item.scope) === 'area' ? 'area' : 'country',
    createdAt: safeNumber(item.createdAt) ?? Date.now(),
    pinned: Boolean(item.pinned)
  };
};

const sanitizeAlert = (value: unknown): ListenerAlert | null => {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const kind = safeText(item.kind) as ListenerAlert['kind'];
  if (!['station-back-online', 'track-available', 'live-show', 'region-activity'].includes(kind)) {
    return null;
  }
  const title = safeText(item.title);
  const body = safeText(item.body);
  if (!title || !body) return null;
  return {
    id: safeText(item.id, randomUUID()),
    kind,
    stationId: safeText(item.stationId) || null,
    regionId: safeText(item.regionId) || null,
    title,
    body,
    createdAt: safeNumber(item.createdAt) ?? Date.now(),
    readAt: safeNumber(item.readAt)
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

const uniqueCollections = (items: UserCollection[]) => {
  const seen = new Set<string>();
  return items
    .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt - left.updatedAt)
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
};

const uniqueFollowedStations = (items: FollowedStation[]) => {
  const seen = new Set<string>();
  return items
    .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.createdAt - left.createdAt)
    .filter((item) => {
      if (seen.has(item.stationId)) return false;
      seen.add(item.stationId);
      return true;
    });
};

const uniqueFollowedRegions = (items: FollowedRegion[]) => {
  const seen = new Set<string>();
  return items
    .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.createdAt - left.createdAt)
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
};

const uniqueAlerts = (items: ListenerAlert[]) => {
  const seen = new Set<string>();
  return items
    .sort((left, right) => right.createdAt - left.createdAt)
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
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
    collections: uniqueCollections(
      Array.isArray(payload.collections)
        ? (payload.collections.map(sanitizeCollection).filter(Boolean) as UserCollection[])
        : []
    ).slice(0, 24),
    followedStations: uniqueFollowedStations(
      Array.isArray(payload.followedStations)
        ? (payload.followedStations.map(sanitizeFollowedStation).filter(Boolean) as FollowedStation[])
        : []
    ).slice(0, 80),
    followedRegions: uniqueFollowedRegions(
      Array.isArray(payload.followedRegions)
        ? (payload.followedRegions.map(sanitizeFollowedRegion).filter(Boolean) as FollowedRegion[])
        : []
    ).slice(0, 40),
    alerts: uniqueAlerts(
      Array.isArray(payload.alerts)
        ? (payload.alerts.map(sanitizeAlert).filter(Boolean) as ListenerAlert[])
        : []
    ).slice(0, 160),
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
    collections: uniqueCollections([...primary.collections, ...secondary.collections]).slice(0, 24),
    followedStations: uniqueFollowedStations([...primary.followedStations, ...secondary.followedStations]).slice(
      0,
      80
    ),
    followedRegions: uniqueFollowedRegions([...primary.followedRegions, ...secondary.followedRegions]).slice(0, 40),
    alerts: uniqueAlerts([...primary.alerts, ...secondary.alerts]).slice(0, 160),
    updatedAt: Date.now()
  };
};

const providerDisplayName = (provider: AccountProvider) =>
  provider.email || provider.username || provider.displayName;

const libraryCounts = (library: SyncedLibrary): LibraryCounts => ({
  favorites: library.favorites.length,
  recent: library.recent.length,
  trackHistory: library.trackHistory.length,
  collections: library.collections.length,
  followedStations: library.followedStations.length,
  followedRegions: library.followedRegions.length,
  alerts: library.alerts.length
});

const EMPTY_LIBRARY_COUNTS: LibraryCounts = {
  favorites: 0,
  recent: 0,
  trackHistory: 0,
  collections: 0,
  followedStations: 0,
  followedRegions: 0,
  alerts: 0
};

const normalizeEntitlements = (
  value: unknown,
  fallback: SessionEntitlement[] = []
): SessionEntitlement[] => {
  const source = Array.isArray(value) ? value : fallback;
  return Array.from(
    new Set(
      source
        .map((entry) => safeText(entry))
        .filter((entry): entry is SessionEntitlement =>
          [
            'cloud-sync',
            'collections',
            'collection-folders',
            'advanced-history',
            'pinned-stations',
            'pinned-regions',
            'station-alerts',
            'cosmetic-pack',
            'sponsor-free'
          ].includes(entry)
        )
    )
  );
};

const parseSocialLinks = (value: unknown): Array<{ label: string; url: string }> => {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const item = entry as Record<string, unknown>;
        const label = safeText(item.label);
        const url = safeText(item.url);
        if (!label || !url) return null;
        return { label, url };
      })
      .filter(Boolean) as Array<{ label: string; url: string }>;
  } catch {
    return [];
  }
};

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
  premiumStatus: fields.premiumStatus || (fields.isPremium ? 'premium' : 'free'),
  supporterTier: fields.supporterTier || 'none',
  entitlements: fields.entitlements || [],
  billingProvider: fields.billingProvider ?? null,
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
  premiumStatus: (safeText(row.premium_status) as PremiumStatus) || (Boolean(row.is_premium) ? 'premium' : 'free'),
  supporterTier: (safeText(row.supporter_tier) as SupporterTier) || 'none',
  entitlements: (() => {
    const raw = safeText(row.entitlements_json);
    if (!raw) return [];
    try {
      return Array.isArray(JSON.parse(raw))
        ? (JSON.parse(raw) as unknown[])
            .map((entry) => safeText(entry))
            .filter(Boolean) as SessionEntitlement[]
        : [];
    } catch {
      return [];
    }
  })(),
  billingProvider: (safeText(row.billing_provider) as BillingProvider) || null,
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

const defaultDatabaseFilePath = fileURLToPath(DB_URL);
const configuredDatabaseFilePath = (() => {
  const configured = String(process.env.ACCOUNT_STORE_PATH || '').trim();
  if (!configured) return defaultDatabaseFilePath;
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
})();
const databaseFilePath = configuredDatabaseFilePath;
const databaseDirPath = dirname(databaseFilePath);

const getDb = async () => {
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

const mapStationProfile = (row: Record<string, unknown>): StationProfileRecord => ({
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

const getStationProfileSync = (db: DatabaseLike, stationuuid: string) => {
  const row = db.prepare('SELECT * FROM station_profiles WHERE stationuuid = ?').get(stationuuid);
  return row ? mapStationProfile(row) : null;
};

const upsertStationProfileSync = (db: DatabaseLike, profile: StationProfileRecord) => {
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

const getBillingProductById = (productId: BillingProductId) =>
  BILLING_PRODUCTS.find((product) => product.id === productId) || null;

const applyEntitlementPreset = (
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

const recordPromotionEventSync = (
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
    trackHistory: nextAccount.library.trackHistory.length,
    collections: nextAccount.library.collections.length,
    followedStations: nextAccount.library.followedStations.length,
    followedRegions: nextAccount.library.followedRegions.length,
    alerts: nextAccount.library.alerts.length
  });
  return getAccountByIdSync(db, accountId);
};

const patchAccountLibrary = async (
  accountId: string,
  patch: Partial<Pick<SyncedLibrary, 'collections' | 'followedStations' | 'followedRegions' | 'alerts'>>
) => {
  const db = await getDb();
  const current = getAccountByIdSync(db, accountId);
  if (!current) return null;
  const nextAccount: StoredAccount = {
    ...current,
    library: sanitizeLibrary({
      ...current.library,
      ...patch,
      updatedAt: Date.now()
    }),
    updatedAt: Date.now()
  };
  saveAccount(db, nextAccount);
  recordAuditEventSync(db, accountId, 'library_synced', {
    favorites: nextAccount.library.favorites.length,
    recent: nextAccount.library.recent.length,
    trackHistory: nextAccount.library.trackHistory.length,
    collections: nextAccount.library.collections.length,
    followedStations: nextAccount.library.followedStations.length,
    followedRegions: nextAccount.library.followedRegions.length,
    alerts: nextAccount.library.alerts.length
  });
  return getAccountByIdSync(db, accountId);
};

export const updateAccountCollections = async (accountId: string, collections: unknown) =>
  patchAccountLibrary(accountId, {
    collections: sanitizeLibrary({ collections }).collections
  });

export const updateAccountFollows = async (
  accountId: string,
  follows: { followedStations?: unknown; followedRegions?: unknown }
) =>
  patchAccountLibrary(accountId, {
    followedStations: sanitizeLibrary({ followedStations: follows.followedStations }).followedStations,
    followedRegions: sanitizeLibrary({ followedRegions: follows.followedRegions }).followedRegions
  });

export const updateAccountAlerts = async (accountId: string, alerts: unknown) =>
  patchAccountLibrary(accountId, {
    alerts: sanitizeLibrary({ alerts }).alerts
  });

export const updateAccountEntitlements = async (
  accountId: string,
  input: {
    premiumStatus: PremiumStatus;
    supporterTier: SupporterTier;
    entitlements: SessionEntitlement[];
    billingProvider: BillingProvider;
  }
) => {
  const db = await getDb();
  const current = getAccountByIdSync(db, accountId);
  if (!current) return null;
  const nextAccount = applyEntitlementPreset(
    current,
    input.premiumStatus,
    input.supporterTier,
    input.entitlements,
    input.billingProvider
  );
  saveAccount(db, nextAccount);
  recordAuditEventSync(db, accountId, 'entitlements_updated', {
    premiumStatus: nextAccount.premiumStatus,
    supporterTier: nextAccount.supporterTier,
    entitlements: nextAccount.entitlements
  });
  return getAccountByIdSync(db, accountId);
};

export const listBillingProducts = async () => BILLING_PRODUCTS;

export const createBillingPurchase = async (
  accountId: string,
  productId: BillingProductId,
  recipientAccountId?: string | null
) => {
  const db = await getDb();
  const account = getAccountByIdSync(db, accountId);
  const product = getBillingProductById(productId);
  if (!account || !product) return null;
  const purchaseId = randomUUID();
  const payload = JSON.stringify({
    purchaseId,
    accountId,
    recipientAccountId: recipientAccountId || null,
    productId
  });
  const now = Date.now();
  db.prepare(`
    INSERT INTO billing_purchases (
      id, account_id, recipient_account_id, product_id, kind, amount, currency, status, provider,
      payload, telegram_charge_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    purchaseId,
    accountId,
    recipientAccountId || null,
    product.id,
    product.kind,
    product.amount,
    product.currency,
    'pending',
    'telegram-stars',
    payload,
    null,
    now,
    now
  );
  recordAuditEventSync(db, accountId, 'billing_purchase_created', {
    purchaseId,
    productId: product.id,
    amount: product.amount,
    kind: product.kind
  });
  return {
    id: purchaseId,
    accountId,
    recipientAccountId: recipientAccountId || null,
    product
  };
};

export const confirmBillingPurchase = async (
  purchaseId: string,
  telegramChargeId?: string | null
) => {
  const db = await getDb();
  const row = db.prepare('SELECT * FROM billing_purchases WHERE id = ? LIMIT 1').get(purchaseId);
  if (!row) return null;
  const purchase: BillingPurchase = {
    id: String(row.id),
    accountId: String(row.account_id),
    recipientAccountId: safeText(row.recipient_account_id) || null,
    productId: safeText(row.product_id) as BillingProductId,
    kind: safeText(row.kind) as BillingProduct['kind'],
    amount: safeNumber(row.amount) ?? 0,
    currency: 'XTR',
    status: safeText(row.status) as BillingPurchase['status'],
    provider: 'telegram-stars',
    payload: safeText(row.payload),
    telegramChargeId: safeText(row.telegram_charge_id) || null,
    createdAt: safeNumber(row.created_at) ?? Date.now(),
    updatedAt: safeNumber(row.updated_at) ?? Date.now()
  };
  if (purchase.status === 'paid') {
    return getAccountByIdSync(db, purchase.recipientAccountId || purchase.accountId);
  }

  db.prepare(`
    UPDATE billing_purchases
    SET status = 'paid', telegram_charge_id = ?, updated_at = ?
    WHERE id = ?
  `).run(telegramChargeId || null, Date.now(), purchaseId);

  const targetAccountId = purchase.recipientAccountId || purchase.accountId;
  const targetAccount = getAccountByIdSync(db, targetAccountId);
  if (!targetAccount) return null;

  let nextAccount = targetAccount;
  if (purchase.productId === 'premium-month' || purchase.productId === 'premium-year' || purchase.productId === 'premium-gift') {
    nextAccount = applyEntitlementPreset(
      targetAccount,
      'premium',
      targetAccount.supporterTier === 'patron' ? 'patron' : 'supporter',
      [...targetAccount.entitlements, ...PREMIUM_ENTITLEMENTS],
      'telegram-stars'
    );
  } else {
    nextAccount = applyEntitlementPreset(
      targetAccount,
      targetAccount.premiumStatus === 'premium' ? 'premium' : 'supporter',
      purchase.productId === 'support-big' ? 'patron' : 'supporter',
      [...targetAccount.entitlements, ...SUPPORTER_ENTITLEMENTS],
      'telegram-stars'
    );
  }

  saveAccount(db, nextAccount);
  recordAuditEventSync(db, targetAccountId, 'billing_purchase_confirmed', {
    purchaseId,
    productId: purchase.productId,
    amount: purchase.amount
  });
  return getAccountByIdSync(db, targetAccountId);
};

export const claimStationForAccount = async (
  accountId: string,
  stationuuid: string,
  defaults: { displayName: string; websiteUrl?: string | null; description?: string | null; artworkUrl?: string | null }
) => {
  const db = await getDb();
  const current = getStationProfileSync(db, stationuuid);
  if (current?.ownerAccountId && current.ownerAccountId !== accountId) {
    throw new Error('station is already claimed');
  }
  const nextProfile: StationProfileRecord = {
    stationuuid,
    ownerAccountId: accountId,
    displayName: safeText(defaults.displayName, current?.displayName || 'Claimed station'),
    description: safeText(defaults.description) || current?.description || null,
    artworkUrl: safeText(defaults.artworkUrl) || current?.artworkUrl || null,
    websiteUrl: safeText(defaults.websiteUrl) || current?.websiteUrl || null,
    socialLinks: current?.socialLinks || [],
    scheduleNote: current?.scheduleNote || null,
    editorialPitch: current?.editorialPitch || null,
    isVerified: current?.isVerified || false,
    isPromoted: current?.isPromoted || false,
    promotedUntil: current?.promotedUntil || null,
    createdAt: current?.createdAt || Date.now(),
    updatedAt: Date.now()
  };
  upsertStationProfileSync(db, nextProfile);
  recordAuditEventSync(db, accountId, 'station_claimed', { stationuuid, displayName: nextProfile.displayName });
  return getStationProfileSync(db, stationuuid);
};

export const getStationProfile = async (stationuuid: string) => {
  const db = await getDb();
  return getStationProfileSync(db, stationuuid);
};

export const updateStationProfile = async (
  accountId: string,
  stationuuid: string,
  patch: Partial<Pick<StationProfileRecord, 'displayName' | 'description' | 'artworkUrl' | 'websiteUrl' | 'scheduleNote' | 'editorialPitch' | 'isPromoted' | 'promotedUntil'>> & {
    socialLinks?: Array<{ label: string; url: string }>;
  }
) => {
  const db = await getDb();
  const current = getStationProfileSync(db, stationuuid);
  if (!current || current.ownerAccountId !== accountId) {
    throw new Error('station profile is not owned by this account');
  }
  const nextProfile: StationProfileRecord = {
    ...current,
    displayName: safeText(patch.displayName) || current.displayName,
    description: safeText(patch.description) || current.description,
    artworkUrl: safeText(patch.artworkUrl) || current.artworkUrl,
    websiteUrl: safeText(patch.websiteUrl) || current.websiteUrl,
    scheduleNote: safeText(patch.scheduleNote) || current.scheduleNote,
    editorialPitch: safeText(patch.editorialPitch) || current.editorialPitch,
    socialLinks: Array.isArray(patch.socialLinks)
      ? patch.socialLinks
          .map((entry) => ({ label: safeText(entry.label), url: safeText(entry.url) }))
          .filter((entry) => entry.label && entry.url)
      : current.socialLinks,
    isPromoted: patch.isPromoted ?? current.isPromoted,
    promotedUntil: patch.promotedUntil ?? current.promotedUntil,
    updatedAt: Date.now()
  };
  upsertStationProfileSync(db, nextProfile);
  recordAuditEventSync(db, accountId, 'station_profile_updated', { stationuuid });
  return getStationProfileSync(db, stationuuid);
};

export const listCatalogProfileOverrides = async () => {
  const db = await getDb();
  return db.prepare('SELECT * FROM station_profiles').all().map(mapStationProfile);
};

export const recordPromotionEvent = async (
  stationuuid: string,
  eventType: 'impression' | 'click' | 'play-start' | 'favorite-after-click',
  sourceId?: string | null,
  accountId?: string | null
) => {
  const db = await getDb();
  recordPromotionEventSync(db, stationuuid, eventType, sourceId, accountId);
};

export const getStationAnalytics = async (accountId: string, stationuuid: string) => {
  const db = await getDb();
  const profile = getStationProfileSync(db, stationuuid);
  if (!profile || profile.ownerAccountId !== accountId) {
    throw new Error('station profile is not owned by this account');
  }
  const rows = db
    .prepare(`
      SELECT event_type, COUNT(*) as count
      FROM promotion_events
      WHERE stationuuid = ?
      GROUP BY event_type
    `)
    .all(stationuuid);
  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[safeText(row.event_type)] = safeNumber(row.count) ?? 0;
    return acc;
  }, {});
  return {
    stationuuid,
    impressions: counts.impression || 0,
    clicks: counts.click || 0,
    playStarts: counts['play-start'] || 0,
    favoriteAfterClick: counts['favorite-after-click'] || 0
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
