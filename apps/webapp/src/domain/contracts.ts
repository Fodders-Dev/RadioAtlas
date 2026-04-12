import type { StationLite } from '../types';

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

export type CloudLibrary = {
  favorites: StationLite[];
  recent: StationLite[];
  trackHistory: SyncedTrackHistoryItem[];
  updatedAt: number;
};

export type ProviderKind = 'telegram' | 'google';

export type LibraryMergeStrategy = 'combine' | 'prefer-current' | 'prefer-incoming';

export type SessionAuditEventType =
  | 'account_created'
  | 'provider_linked'
  | 'provider_unlinked'
  | 'account_merged'
  | 'session_created'
  | 'sign_in'
  | 'library_synced'
  | 'link_request_created';

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
  | 'icecast'
  | 'shoutcast'
  | 'azuracast'
  | 'icy-stream'
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
  | 'catalog-pulse';

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
  genreSpotlight: DiscoveryStationModule | null;
  tagRadar: DiscoveryTagMetric[];
  metrics: DiscoveryMetrics;
};
