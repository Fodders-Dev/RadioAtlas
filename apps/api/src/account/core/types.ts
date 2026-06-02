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

export type SyncedTasteSignalAction =
  | 'play-started'
  | 'listened-30s'
  | 'skip-before-10s'
  | 'liked'
  | 'unliked'
  | 'saved-to-collection'
  | 'replayed-later'
  | 'station-failed';

export type SyncedTasteSessionMode = 'personal' | 'resume' | 'search' | 'globe' | 'collection';

export type SyncedTasteSignal = {
  stationId: string;
  action: SyncedTasteSignalAction;
  mode: SyncedTasteSessionMode;
  timestamp: number;
  weight: number;
};

export type SyncedTasteProfile = {
  version: 2;
  lastUpdatedAt: number | null;
  signals: SyncedTasteSignal[];
  hiddenStationIds: string[];
  stationScores: Record<string, number>;
  tagScores: Record<string, number>;
  countryScores: Record<string, number>;
  languageScores: Record<string, number>;
  modeScores: Partial<Record<SyncedTasteSessionMode, number>>;
};

export type SyncedLibrary = {
  favorites: SyncedStation[];
  recent: SyncedStation[];
  trackHistory: SyncedTrackHistoryItem[];
  collections: UserCollection[];
  followedStations: FollowedStation[];
  followedRegions: FollowedRegion[];
  alerts: ListenerAlert[];
  tasteProfile: SyncedTasteProfile;
  updatedAt: number;
};

export type ProviderKind = 'telegram' | 'google' | 'vk';
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
  | 'sponsor-free'
  | 'referral-theme';

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
  // T_share_4: the inviter's account id, written ONCE on the invitee's first
  // session (null for everyone who arrived without a ref_ deep link). One
  // inviter per user — never overwritten after it is first set.
  invitedByAccountId: string | null;
  providers: AccountProvider[];
  library: SyncedLibrary;
  createdAt: number;
  updatedAt: number;
};

// R1 bot retention (PR-A): one row per Telegram user that has either opted in
// (via the authed webapp) and/or started the bot (DM-reachability).
export type BotSubscription = {
  telegramId: string;
  accountId: string | null;
  optedIn: boolean;
  startedAt: number | null;
  lastSentAt: number | null;
  unreachable: boolean;
};

// A nudge recipient = opted-in AND reachable AND not recently sent. Only what
// the sender needs (PR-B); never exposed publicly (chat_id is PII).
export type NudgeRecipient = {
  telegramId: string;
  accountId: string | null;
  lastSentAt: number | null;
};

export type AccountAuditEventType =
  | 'account_created'
  | 'provider_linked'
  | 'provider_unlinked'
  | 'account_merged'
  | 'session_created'
  | 'session_revoked'
  | 'sessions_revoked_other'
  | 'sign_in'
  | 'library_synced'
  | 'link_request_created'
  | 'entitlements_updated'
  | 'billing_purchase_created'
  | 'billing_purchase_confirmed'
  | 'station_claimed'
  | 'station_profile_updated'
  | 'referral_attributed'
  | 'referral_reward_granted';

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
  tasteSignals: number;
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

export type LinkRequest = {
  code: string;
  accountId: string;
  mergeStrategy: LibraryMergeStrategy;
  createdAt: number;
  expiresAt: number;
};

export type StoredSession = {
  token: string;
  accountId: string;
  createdAt: number;
  updatedAt: number;
};

export type LegacyProfile = {
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

export type LegacyStore = {
  profiles?: Record<string, LegacyProfile>;
  sessions?: Record<string, { token: string; profileId: string; createdAt: number; updatedAt: number }>;
  accounts?: Record<string, StoredAccount>;
  linkRequests?: Record<string, LinkRequest>;
};

export type DatabaseLike = {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    run: (...params: unknown[]) => unknown;
    get: (...params: unknown[]) => Record<string, unknown> | undefined;
    all: (...params: unknown[]) => Array<Record<string, unknown>>;
  };
};
