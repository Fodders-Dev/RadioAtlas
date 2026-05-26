import type { StationLite } from '../types';

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

export type PlaybackFailureKind =
  | 'mixed-content'
  | 'api-unavailable'
  | 'unsupported-transport'
  | 'extract-failed'
  | 'attach-failed'
  | 'play-failed'
  | 'runtime-failed'
  | 'stream-unavailable'
  | 'no-playable-candidate'
  | 'superseded'
  | 'unknown';

export type PlaybackFailurePhase = 'attach' | 'play' | 'runtime';

export type PlaybackFailure = {
  kind: PlaybackFailureKind;
  message: string;
  url?: string;
  phase?: PlaybackFailurePhase;
  recoverable: boolean;
};

export type PlaybackCandidateMode = 'direct' | 'proxy' | 'hls' | 'extracted';

export type PlaybackCandidate = {
  url: string;
  sourceUrl: string;
  mode: PlaybackCandidateMode;
  label: string;
  isFallback: boolean;
};

export type PlaybackState = {
  current: StationLite | null;
  status: 'idle' | 'buffering' | 'playing' | 'paused' | 'error';
  error: PlaybackFailure | null;
  activeCandidate: PlaybackCandidate | null;
  recentFailures: PlaybackFailure[];
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

export type RadioDigestKind = 'continue-yesterday' | 'morning-mix' | 'evening-mix';

export type RadioDigest = {
  id: string;
  kind: RadioDigestKind;
  title: string;
  body: string;
  stationIds: string[];
  createdAt: number;
  readAt: number | null;
};

export type NotificationPreference = {
  version: 1;
  inAppAlerts: boolean;
  telegramBotOptIn: boolean;
  stationBackOnline: boolean;
  trackAlerts: boolean;
  regionActivity: boolean;
  morningMix: boolean;
  eveningMix: boolean;
  updatedAt: number | null;
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

export type CloudLibrary = {
  favorites: StationLite[];
  recent: StationLite[];
  trackHistory: SyncedTrackHistoryItem[];
  collections: UserCollection[];
  followedStations: FollowedStation[];
  followedRegions: FollowedRegion[];
  alerts: ListenerAlert[];
  tasteProfile?: SyncedTasteProfile | null;
  updatedAt: number;
};

export type ProviderKind = 'telegram' | 'google' | 'vk';

export type ProviderAvailabilityStatus = 'available' | 'requires-client' | 'server-only' | 'unavailable';

export type ProviderAvailability = {
  kind: ProviderKind;
  status: ProviderAvailabilityStatus;
  configured: boolean;
  label: string;
  reason: string | null;
};

export type LibraryMergeStrategy = 'combine' | 'prefer-current' | 'prefer-incoming';

export type SessionAuditEventType =
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

export type SessionProviderInfo = {
  kind: ProviderKind;
  externalId: string;
  displayName: string;
  username: string | null;
  email: string | null;
  photoUrl: string | null;
  isPremium: boolean;
  linkedAt: number;
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

export type MergePreview = {
  mode: 'create-profile' | 'attach-new-provider' | 'sign-in-existing' | 'same-profile' | 'merge-conflict';
  providerKind: ProviderKind;
  providerLabel: string;
  strategy: LibraryMergeStrategy;
  requiresConfirmation: boolean;
  current: MergePreviewParty | null;
  incoming: MergePreviewParty | null;
  result: LibraryCounts;
};

export type SessionProfile = {
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
  linkedProviders: ProviderKind[];
  providers: SessionProviderInfo[];
};

export type AuditEvent = {
  id: string;
  accountId: string;
  type: SessionAuditEventType;
  providerKind: ProviderKind | null;
  providerExternalId: string | null;
  payload: Record<string, unknown>;
  createdAt: number;
};

export type NowPlayingFailureKind =
  | 'metadata-unavailable'
  | 'api-unavailable'
  | 'timeout'
  | 'low-impact-skipped'
  | 'stream-probe-failed'
  | 'unknown';

export type NowPlayingStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

export type NowPlayingSource =
  | 'nightride-sse'
  | 'channel-api'
  | 'radioplayer-events'
  | 'metacast'
  | 'icecast'
  | 'shoutcast'
  | 'azuracast'
  | 'icy-stream'
  | 'cache'
  | 'server-proxy'
  | 'none';

export type NowPlayingSnapshot = {
  track: string | null;
  status: NowPlayingStatus;
  source: NowPlayingSource;
  failureKind: NowPlayingFailureKind | null;
  recommendedPollMs: number;
  updatedAt: number | null;
};

export type DiscoveryModuleKind =
  | 'search-preview'
  | 'fresh-signals'
  | 'country-spotlight'
  | 'resume'
  | 'genre-spotlight'
  | 'catalog-pulse'
  | 'revived-stations'
  | 'session-delta'
  | 'sponsored'
  | 'trending'
  | 'top-voted'
  | 'around-the-world'
  | 'mood';

export type DiscoveryStationModule = {
  kind: DiscoveryModuleKind;
  titleKey: string;
  copyKey: string;
  sourceId: string;
  stations: StationLite[];
  accent?: 'primary' | 'secondary' | 'accent';
  label?: string;
};

export type DiscoveryTagMetric = {
  label: string;
  count: number;
};

export type DiscoveryMetrics = {
  countries: number;
  languages: number;
  genres: number;
};

export type DiscoveryFeed = {
  quickResults: StationLite[];
  freshSignals: DiscoveryStationModule;
  countrySpotlight: DiscoveryStationModule | null;
  resumeStations: StationLite[];
  resumeModules: DiscoveryStationModule[];
  genreSpotlight: DiscoveryStationModule | null;
  revivedStations: DiscoveryStationModule | null;
  sessionDelta: DiscoveryStationModule | null;
  // T2.21 server-signal rails (non-personalised discovery).
  trending: DiscoveryStationModule | null;
  topVoted: DiscoveryStationModule | null;
  aroundTheWorld: DiscoveryStationModule | null;
  // T2.22 mood rails (server-bucketed by listening context; 0–4 shelves).
  moodRails: DiscoveryStationModule[];
  sponsoredModules: DiscoveryStationModule[];
  primaryDiscoveryModule: DiscoveryStationModule;
  rankedDiscoveryModules: DiscoveryStationModule[];
  promoteDiscoveryAbove: 'resume' | 'quick-search';
  tagRadar: DiscoveryTagMetric[];
  metrics: DiscoveryMetrics;
  freshnessStamp: number;
};

export type BillingProductId =
  | 'support-small'
  | 'support-big'
  | 'premium-month'
  | 'premium-year'
  | 'premium-gift';

export type BillingProduct = {
  id: BillingProductId;
  title: string;
  description: string;
  amount: number;
  currency: 'XTR';
  kind: 'donation' | 'premium' | 'gift-premium';
};

export type BillingInvoice = {
  id: string;
  productId: BillingProductId;
  title: string;
  amount: number;
  currency: 'XTR';
  invoiceLink: string;
  createdAt: number;
};

export type StationProfileSummary = {
  stationuuid: string;
  displayName: string;
  description: string | null;
  artworkUrl: string | null;
  websiteUrl: string | null;
  socialLinks: Array<{ label: string; url: string }>;
  scheduleNote: string | null;
  editorialPitch: string | null;
  ownerAccountId: string | null;
  isVerified: boolean;
  isPromoted: boolean;
  claimedAt: number | null;
  promotedUntil: number | null;
  createdAt: number;
  updatedAt: number;
};

export type CatalogSpotlight = {
  label: string;
  stations: StationLite[];
};

// T2.22: a server-bucketed mood shelf. `id` (e.g. "mood-late-night") maps to
// the rail's locale title/copy on the client.
export type CatalogMoodRail = {
  id: string;
  stations: StationLite[];
};

export type CatalogSummary = {
  generatedAt: number;
  counts: {
    stations: number;
    countries: number;
    languages: number;
    genres: number;
  };
  catalogPool: StationLite[];
  freshSignals: StationLite[];
  searchLaunch: StationLite[];
  sponsored: StationLite[];
  countrySpotlight: CatalogSpotlight | null;
  genreSpotlight: CatalogSpotlight | null;
  // T2.21 discovery rails — server-side popularity signals (Radio Browser).
  // Pre-ranked station lists; the country pool rotates daily. Optional so a
  // cached/older summary without these fields degrades to hidden rails.
  trending?: StationLite[];
  topVoted?: StationLite[];
  aroundTheWorld?: CatalogSpotlight | null;
  // T2.22 mood shelves (server-bucketed by listening context).
  moodRails?: CatalogMoodRail[];
};

export type CatalogCountryBucket = {
  key: string;
  country: string;
  continent: string;
  count: number;
};

export type CatalogSearchFacets = {
  countries: string[];
  tags: string[];
  languages: string[];
  continentCounts: Array<{ id: string; count: number }>;
  featuredCountries: CatalogCountryBucket[];
};

export type CatalogSearchResponse = {
  items: StationLite[];
  total: number;
  nextCursor: string | null;
  facets: CatalogSearchFacets;
};

export type CatalogArea = {
  id: string;
  lat: number;
  lon: number;
  label: string;
  subtitle: string;
  count: number;
};

export type CatalogAreaListResponse = {
  items: CatalogArea[];
  mappedStations: number;
  totalStations: number;
};

export type CatalogAreaStationsResponse = {
  area: CatalogArea | null;
  items: StationLite[];
  nextCursor: string | null;
};

export type CatalogStationPoint = {
  id: string;
  // Set whenever Radio Browser has explicit geo_lat/geo_long (~11k of
  // 55k stations). Entries without these still ship through so the
  // client can drop them inside the country's borders via geoResolver.
  lat?: number;
  lon?: number;
  country: string;
  // Free-text region from Radio Browser — usually a state, oblast or
  // city, sometimes blank. Surfaced in the context pill near the
  // reticle so the user can tell at a glance where they're aiming.
  state?: string;
  // Display name. Lets the reticle preview which station it would
  // tune without round-tripping fetchStationById on every hover.
  name?: string;
};

export type CatalogPointsResponse = {
  items: CatalogStationPoint[];
  mappedStations: number;
  totalStations: number;
};
