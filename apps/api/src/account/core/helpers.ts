import { randomUUID } from 'node:crypto';
import type {
  AccountAuditEvent,
  AccountAuditEventType,
  AccountMergePreview,
  AccountProvider,
  BillingProduct,
  BillingProvider,
  DatabaseLike,
  FollowedRegion,
  FollowedStation,
  LibraryCounts,
  LibraryMergeStrategy,
  ListenerAlert,
  MergePreviewParty,
  PremiumStatus,
  ProviderKind,
  SessionEntitlement,
  StoredAccount,
  SupporterTier,
  SyncedLibrary,
  SyncedStation,
  SyncedTasteProfile,
  SyncedTasteSessionMode,
  SyncedTasteSignal,
  SyncedTasteSignalAction,
  SyncedTrackHistoryItem,
  UserCollection
} from './types.js';

// One-time provider-link authorization codes. Tightened from 10 min to
// 5 min as part of T0.5 - the only legitimate flow mints a code in the
// webapp and uses it on the very next provider callback.
export const LINK_REQUEST_TTL_MS = 1000 * 60 * 5;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, sliding
export const AUDIT_LIMIT_DEFAULT = 12;
export const PREMIUM_ENTITLEMENTS: SessionEntitlement[] = [
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
export const SUPPORTER_ENTITLEMENTS: SessionEntitlement[] = ['cloud-sync', 'collections'];
export const BILLING_PRODUCTS: BillingProduct[] = [
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

export const safeText = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value.trim().slice(0, 320) || fallback : fallback;

export const safeNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const sanitizeStation = (value: unknown): SyncedStation | null => {
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

export const sanitizeTrackHistoryItem = (value: unknown): SyncedTrackHistoryItem | null => {
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

export const sanitizeCollection = (value: unknown): UserCollection | null => {
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

export const sanitizeFollowedStation = (value: unknown): FollowedStation | null => {
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

export const sanitizeFollowedRegion = (value: unknown): FollowedRegion | null => {
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

export const sanitizeAlert = (value: unknown): ListenerAlert | null => {
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

const TASTE_SIGNAL_ACTIONS = new Set<SyncedTasteSignalAction>([
  'play-started',
  'listened-30s',
  'sustained-listen',
  'skip-before-10s',
  'liked',
  'unliked',
  'saved-to-collection',
  'replayed-later',
  'station-failed'
]);

const TASTE_SESSION_MODES = new Set<SyncedTasteSessionMode>([
  'personal',
  'resume',
  'search',
  'globe',
  'collection'
]);

const DEFAULT_TASTE_PROFILE: SyncedTasteProfile = {
  version: 2,
  lastUpdatedAt: null,
  signals: [],
  hiddenStationIds: [],
  stationScores: {},
  tagScores: {},
  countryScores: {},
  languageScores: {},
  modeScores: {}
};

const sanitizeTasteSignal = (value: unknown): SyncedTasteSignal | null => {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const stationId = safeText(item.stationId);
  const action = safeText(item.action) as SyncedTasteSignalAction;
  const mode = safeText(item.mode) as SyncedTasteSessionMode;
  const timestamp = safeNumber(item.timestamp);
  const weight = safeNumber(item.weight);
  if (
    !stationId ||
    !TASTE_SIGNAL_ACTIONS.has(action) ||
    !TASTE_SESSION_MODES.has(mode) ||
    timestamp === null ||
    weight === null
  ) {
    return null;
  }
  return {
    stationId,
    action,
    mode,
    timestamp,
    weight: Math.max(-40, Math.min(40, weight))
  };
};

const sanitizeScoreMap = (value: unknown, limit: number) => {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([key, score]) => [safeText(key), safeNumber(score)] as const)
      .filter((entry): entry is readonly [string, number] => Boolean(entry[0]) && entry[1] !== null)
      .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]) || left[0].localeCompare(right[0]))
      .slice(0, limit)
  );
};

export const sanitizeTasteProfile = (value: unknown): SyncedTasteProfile => {
  if (!value || typeof value !== 'object') return DEFAULT_TASTE_PROFILE;
  const payload = value as Record<string, unknown>;
  if (safeNumber(payload.version) !== 2) return DEFAULT_TASTE_PROFILE;
  const signals = Array.isArray(payload.signals)
    ? (payload.signals.map(sanitizeTasteSignal).filter(Boolean) as SyncedTasteSignal[])
    : [];
  const uniqueSignals = signals
    .sort((left, right) => right.timestamp - left.timestamp)
    .filter((signal, index, source) => {
      const key = `${signal.stationId}:${signal.action}:${signal.mode}:${signal.timestamp}`;
      return source.findIndex((candidate) => `${candidate.stationId}:${candidate.action}:${candidate.mode}:${candidate.timestamp}` === key) === index;
    })
    .slice(0, 240);

  return {
    version: 2,
    lastUpdatedAt: safeNumber(payload.lastUpdatedAt),
    signals: uniqueSignals,
    hiddenStationIds: Array.isArray(payload.hiddenStationIds)
      ? Array.from(new Set(payload.hiddenStationIds.map((value) => safeText(value)).filter(Boolean))).slice(0, 160)
      : [],
    stationScores: sanitizeScoreMap(payload.stationScores, 140),
    tagScores: sanitizeScoreMap(payload.tagScores, 36),
    countryScores: sanitizeScoreMap(payload.countryScores, 30),
    languageScores: sanitizeScoreMap(payload.languageScores, 24),
    modeScores: sanitizeScoreMap(payload.modeScores, 8) as Partial<Record<SyncedTasteSessionMode, number>>
  };
};

const mergeScoreMaps = (limit: number, ...maps: Array<Record<string, number>>) =>
  sanitizeScoreMap(
    maps.reduce<Record<string, number>>((merged, map) => {
      Object.entries(map).forEach(([key, value]) => {
        merged[key] = Number(((merged[key] || 0) + value).toFixed(4));
      });
      return merged;
    }, {}),
    limit
  );

export const mergeTasteProfiles = (
  primary: SyncedTasteProfile,
  secondary: SyncedTasteProfile
): SyncedTasteProfile => {
  const left = sanitizeTasteProfile(primary);
  const right = sanitizeTasteProfile(secondary);
  const signalMap = new Map<string, SyncedTasteSignal>();
  [...left.signals, ...right.signals].forEach((signal) => {
    const key = `${signal.stationId}:${signal.action}:${signal.mode}:${signal.timestamp}`;
    const previous = signalMap.get(key);
    if (!previous || Math.abs(signal.weight) > Math.abs(previous.weight)) {
      signalMap.set(key, signal);
    }
  });
  return {
    version: 2,
    lastUpdatedAt: Math.max(left.lastUpdatedAt || 0, right.lastUpdatedAt || 0) || null,
    signals: Array.from(signalMap.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 240),
    hiddenStationIds: Array.from(new Set([...left.hiddenStationIds, ...right.hiddenStationIds])).slice(0, 160),
    stationScores: mergeScoreMaps(140, left.stationScores, right.stationScores),
    tagScores: mergeScoreMaps(36, left.tagScores, right.tagScores),
    countryScores: mergeScoreMaps(30, left.countryScores, right.countryScores),
    languageScores: mergeScoreMaps(24, left.languageScores, right.languageScores),
    modeScores: mergeScoreMaps(8, left.modeScores, right.modeScores) as Partial<Record<SyncedTasteSessionMode, number>>
  };
};

export const uniqueStations = (items: SyncedStation[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.stationuuid)) return false;
    seen.add(item.stationuuid);
    return true;
  });
};

export const uniqueTrackHistory = (items: SyncedTrackHistoryItem[]) => {
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

export const uniqueCollections = (items: UserCollection[]) => {
  const seen = new Set<string>();
  return items
    .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt - left.updatedAt)
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
};

export const uniqueFollowedStations = (items: FollowedStation[]) => {
  const seen = new Set<string>();
  return items
    .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.createdAt - left.createdAt)
    .filter((item) => {
      if (seen.has(item.stationId)) return false;
      seen.add(item.stationId);
      return true;
    });
};

export const uniqueFollowedRegions = (items: FollowedRegion[]) => {
  const seen = new Set<string>();
  return items
    .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.createdAt - left.createdAt)
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
};

export const uniqueAlerts = (items: ListenerAlert[]) => {
  const seen = new Set<string>();
  return items
    .sort((left, right) => right.createdAt - left.createdAt)
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
};

export const sanitizeLibrary = (value: unknown): SyncedLibrary => {
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
    tasteProfile: sanitizeTasteProfile(payload.tasteProfile),
    updatedAt: Date.now()
  };
};

export const serializeLibrary = (library: SyncedLibrary) => {
  const { updatedAt: _updatedAt, ...nextLibrary } = sanitizeLibrary(library);
  return JSON.stringify(nextLibrary);
};

export const deserializeLibrary = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) {
    return sanitizeLibrary(null);
  }
  try {
    return sanitizeLibrary(JSON.parse(value));
  } catch {
    return sanitizeLibrary(null);
  }
};

export const mergeLibraries = (
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
    // ⚠ NO cap on finds, and the missing `.slice(0, 200)` is the point.
    // This is the account merge — two devices, or a sign-in — and the cut here
    // was the worst of the four: it threw away the older half of somebody's
    // saved finds at the exact moment they expected the two halves to come
    // together. Measured 2026-09-03: the merge costs 5.7ms at ten thousand
    // finds, so the number was protecting nothing.
    // Favourites, recents and collections keep their caps for now — same broken
    // promise, different object, recorded as its own defect in PLAN.md.
    trackHistory: uniqueTrackHistory([...primary.trackHistory, ...secondary.trackHistory]),
    collections: uniqueCollections([...primary.collections, ...secondary.collections]).slice(0, 24),
    followedStations: uniqueFollowedStations([...primary.followedStations, ...secondary.followedStations]).slice(
      0,
      80
    ),
    followedRegions: uniqueFollowedRegions([...primary.followedRegions, ...secondary.followedRegions]).slice(0, 40),
    alerts: uniqueAlerts([...primary.alerts, ...secondary.alerts]).slice(0, 160),
    tasteProfile: mergeTasteProfiles(primary.tasteProfile, secondary.tasteProfile),
    updatedAt: Date.now()
  };
};

export const providerDisplayName = (provider: AccountProvider) =>
  provider.email || provider.username || provider.displayName;

export const libraryCounts = (library: SyncedLibrary): LibraryCounts => ({
  favorites: library.favorites.length,
  recent: library.recent.length,
  trackHistory: library.trackHistory.length,
  collections: library.collections.length,
  followedStations: library.followedStations.length,
  followedRegions: library.followedRegions.length,
  alerts: library.alerts.length,
  tasteSignals: library.tasteProfile.signals.length
});

export const EMPTY_LIBRARY_COUNTS: LibraryCounts = {
  favorites: 0,
  recent: 0,
  trackHistory: 0,
  collections: 0,
  followedStations: 0,
  followedRegions: 0,
  alerts: 0,
  tasteSignals: 0
};

export const normalizeEntitlements = (
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
            'sponsor-free',
            'referral-theme'
          ].includes(entry)
        )
    )
  );
};

export const parseSocialLinks = (value: unknown): Array<{ label: string; url: string }> => {
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

export const previewParty = (account: StoredAccount): MergePreviewParty => ({
  accountId: account.id,
  displayName: account.displayName,
  providers: account.providers.map((provider) => provider.kind),
  counts: libraryCounts(account.library)
});

export const deriveAccountIdentity = (
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

export const buildAccountSkeleton = (fields: Partial<StoredAccount>): StoredAccount => ({
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
  invitedByAccountId: fields.invitedByAccountId ?? null,
  providers: fields.providers || [],
  library: fields.library || sanitizeLibrary(null),
  createdAt: fields.createdAt || Date.now(),
  updatedAt: fields.updatedAt || Date.now()
});

export const mapProvider = (row: Record<string, unknown>): AccountProvider => ({
  kind: String(row.kind) as ProviderKind,
  externalId: String(row.external_id || ''),
  displayName: safeText(row.display_name),
  username: safeText(row.username) || null,
  email: safeText(row.email) || null,
  photoUrl: safeText(row.photo_url) || null,
  isPremium: Boolean(row.is_premium),
  linkedAt: safeNumber(row.linked_at) ?? Date.now()
});

export const mapAccount = (row: Record<string, unknown>, providers: AccountProvider[]): StoredAccount => ({
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
  invitedByAccountId: safeText(row.invited_by_account_id) || null,
  providers,
  library: deserializeLibrary(row.library_json),
  createdAt: safeNumber(row.created_at) ?? Date.now(),
  updatedAt: safeNumber(row.updated_at) ?? Date.now()
});

export const mapAuditEvent = (row: Record<string, unknown>): AccountAuditEvent => ({
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
