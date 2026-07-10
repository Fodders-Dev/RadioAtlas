import type {
  CloudLibrary,
  FollowedRegion,
  FollowedStation,
  ListenerAlert,
  NotificationPreference,
  NowPlayingSnapshot,
  RadioDigest,
  UserCollection
} from '../../domain/contracts';
import type { BehaviorProfile } from '../../lib/homeProfile';
import type { HomeSurfaceFeed } from '../../lib/homeSurface';
import type { StationHealthProfile } from '../../lib/stationHealth';
import type { StationPlayabilityProfile } from '../../lib/stationPlayability';
import type { TasteProfileV2 } from '../../lib/tasteProfile';
import type { RadioSessionEvent } from '../../lib/radioSession';
import type { StationExposureLedger } from '../../lib/stationExposure';
import type { useAudioPlayer } from '../../lib/useAudioPlayer';
import type {
  AppSection,
  LibraryTab,
  PlayerPresentation,
  Station,
  StationLite
} from '../../types';

export type TrackHistoryItem = {
  id: string;
  stationId: string;
  stationName: string;
  track: string;
  timestamp: number;
};

export type StoredSkin = {
  source: 'preset' | 'museum' | 'uploaded';
  id?: string;
  md5?: string;
  name?: string;
};

export type CompactMode = 'strip' | 'panel';
export type ExpandedWindowId = 'main-window' | 'equalizer-window' | 'playlist-window';

export type QueueSnapshot = {
  items: StationLite[];
  currentIndex: number;
  sourceId: string | null;
  sourceLabel: string | null;
};

export type LayoutWindowVisibility = {
  'equalizer-window': boolean;
  'playlist-window': boolean;
};

export type WindowPositions = Partial<Record<ExpandedWindowId, { x: number; y: number }>>;

export type StoredWinampLayout = {
  version: 3;
  windowPositions: WindowPositions;
  windowVisibility: LayoutWindowVisibility;
};

export type StoredShellState = {
  version: 3;
  activeSection: AppSection;
  playerPresentation: PlayerPresentation;
  libraryTab: LibraryTab;
  detailsOpen: boolean;
  home: {
    sessionSeed: number;
    lastBuiltAt: number | null;
    snapshot: HomeSurfaceFeed | null;
  };
  searchDraft: string;
};

export type StoredAppState = {
  version: 2;
  shell: StoredShellState;
  behaviorProfile: BehaviorProfile;
  playabilityProfile: StationPlayabilityProfile;
  tasteProfile: TasteProfileV2;
  stationHealthProfile: StationHealthProfile;
  radioSessionEvents: RadioSessionEvent[];
  // Cross-session "shown/played" ledger driving soft demotion of just-seen
  // stations across discovery surfaces (optional; read with `?? {}` so existing
  // stored blobs opt in). See lib/stationExposure.ts.
  stationExposure?: StationExposureLedger;
  // Pause playback when headphones / the audio output device are unplugged
  // (default on; read with `?? true` so existing stored blobs opt in).
  pauseOnHeadphoneUnplug?: boolean;
};

export type StoredLibraryState = {
  version: 2;
  favorites: StationLite[];
  recent: StationLite[];
  collections: UserCollection[];
  followedStations: FollowedStation[];
  followedRegions: FollowedRegion[];
  alerts: ListenerAlert[];
  digests: RadioDigest[];
  notificationPreference: NotificationPreference;
  trackHistory: TrackHistoryItem[];
  playbackHistory: StationLite[];
  stationCache: Record<string, StationLite>;
};

export type StoredPlayerState = {
  version: 2;
  queue: QueueSnapshot;
  skin: StoredSkin;
  layout: StoredWinampLayout;
};

export type QueueState = QueueSnapshot & {
  playAtIndex: (index: number) => void;
  removeAtIndex: (index: number) => void;
  moveAtIndex: (index: number, direction: -1 | 1) => void;
  // Drag-reorder: move an item from one index to another. The playing item is
  // never moved and keeps playing (currentIndex is recomputed to track it).
  reorderQueue: (from: number, to: number) => void;
  shuffleQueue: () => void;
  clearUpcoming: () => void;
  clearQueue: () => void;
  // Append-only: add a station to the END of the queue without touching the
  // playing station or currentIndex (the Discovery Feed «в очередь» action).
  // Returns true when it was newly added, false when already queued.
  enqueue: (station: Station | StationLite) => boolean;
};

export type WinampState = {
  expanded: boolean;
  setExpanded: (value: boolean) => void;
  compactMode: CompactMode;
  setCompactMode: (mode: CompactMode) => void;
  windowPositions: WindowPositions;
  setWindowPosition: (id: ExpandedWindowId, position: { x: number; y: number }) => void;
  windowVisibility: LayoutWindowVisibility;
  setWindowVisibility: (id: keyof LayoutWindowVisibility, visible: boolean) => void;
  resetLayout: () => void;
};

export type PlayStationOptions = {
  playlist?: Array<Station | StationLite>;
  sourceId?: string;
  sourceLabel?: string;
};

export type PlayStationInternalOptions = PlayStationOptions & {
  recordHistory?: boolean;
  addToRecent?: boolean;
  queueSnapshot?: QueueSnapshot;
  historyCursorTarget?: number;
  suppressErrorToast?: boolean;
};

export type PlaybackContextValue = {
  nowPlaying: string | null;
  nowPlayingStatus: 'idle' | 'loading' | 'ready' | 'unavailable';
  nowPlayingState: NowPlayingSnapshot;
  player: ReturnType<typeof useAudioPlayer>;
  queue: QueueState;
  playStation: (station: Station | StationLite, options?: PlayStationOptions) => void;
  playStationQueue: (
    stations: Array<Station | StationLite>,
    options?: Pick<PlayStationOptions, 'sourceId' | 'sourceLabel'>
  ) => void;
  playPrevious: () => void;
  playNext: () => void;
  playLast: () => void;
  copyTrack: () => void;
  openExternal: (station: Station | StationLite) => void;
  shareStation: (station: Station | StationLite) => void;
  sleepTimer: { active: boolean; minutes: number | null; remainingMs: number };
  startSleepTimer: (minutes: number) => void;
  cancelSleepTimer: () => void;
  pauseOnHeadphoneUnplug: boolean;
  setPauseOnHeadphoneUnplug: (value: boolean) => void;
};

export type LibraryContextValue = {
  knownStations: StationLite[];
  favorites: StationLite[];
  recent: StationLite[];
  collections: UserCollection[];
  followedStations: FollowedStation[];
  followedRegions: FollowedRegion[];
  alerts: ListenerAlert[];
  digests: RadioDigest[];
  notificationPreference: NotificationPreference;
  trackHistory: TrackHistoryItem[];
  playbackHistory: StationLite[];
  behaviorProfile: BehaviorProfile;
  playabilityProfile: StationPlayabilityProfile;
  tasteProfile: TasteProfileV2;
  stationHealthProfile: StationHealthProfile;
  radioSessionEvents: RadioSessionEvent[];
  stationExposure: StationExposureLedger;
  // Record that these stations were surfaced to the user (discovery impressions),
  // so future discovery ranking can softly demote them. See lib/stationExposure.ts.
  recordStationsShown: (stationIds: string[]) => void;
  toggleFavorite: (station: Station | StationLite) => void;
  isFavorite: (stationId: string) => boolean;
  hideStationFromRecommendations: (station: Station | StationLite) => void;
  unhideStationFromRecommendations: (station: Station | StationLite) => void;
  isStationHiddenFromRecommendations: (stationId: string) => boolean;
  reportStationBroken: (station: Station | StationLite) => void;
  clearFavorites: () => void;
  clearRecent: () => void;
  clearTrackHistory: () => void;
  removeTrackHistoryItem: (trackId: string) => void;
  createCollection: (name: string) => void;
  saveQueueAsCollection: (name: string) => void;
  addStationToNewCollection: (name: string, station: Station | StationLite) => void;
  deleteCollection: (collectionId: string) => void;
  toggleCollectionPinned: (collectionId: string) => void;
  renameCollection: (collectionId: string, name: string) => void;
  moveStationInCollection: (collectionId: string, stationId: string, direction: -1 | 1) => void;
  addStationToCollection: (collectionId: string, station: Station | StationLite) => void;
  removeStationFromCollection: (collectionId: string, stationId: string) => void;
  toggleFollowStation: (station: Station | StationLite) => void;
  toggleFollowRegion: (region: { id: string; label: string; scope: 'country' | 'area' }) => void;
  markAlertRead: (alertId: string) => void;
  markDigestRead: (digestId: string) => void;
  updateNotificationPreference: (next: Partial<NotificationPreference>) => void;
  rememberStations: (stations: Array<Station | StationLite | null | undefined>) => void;
};

export type ShellContextValue = {
  toast: string | null;
  debugLogs: string[];
  winamp: WinampState;
  activeSection: AppSection;
  setActiveSection: (section: AppSection) => void;
  playerPresentation: PlayerPresentation;
  setPlayerPresentation: (presentation: PlayerPresentation) => void;
  libraryTab: LibraryTab;
  setLibraryTab: (tab: LibraryTab) => void;
  detailsOpen: boolean;
  setDetailsOpen: (value: boolean) => void;
  homeState: StoredShellState['home'];
  setHomeSnapshot: (snapshot: HomeSurfaceFeed) => void;
  refreshHomeSurface: (seed?: number) => void;
  // Discovery «Лента» open-seed — re-rolled on every feed open (see RadioContext)
  // so the feed mix is fresh each time, independent of the frozen Home seed.
  feedSeed: number;
  rerollFeedSeed: () => void;
  searchDraft: string;
  setSearchDraft: (value: string) => void;
  clearSearchDraft: () => void;
  globeFocusRegionId: string | null;
  setGlobeFocusRegionId: (regionId: string | null) => void;
  skinLabOpen: boolean;
  setSkinLabOpen: (value: boolean) => void;
  openWebAppExternally: () => void;
  clearCache: () => void;
};
