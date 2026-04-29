import type {
  CloudLibrary,
  FollowedRegion,
  FollowedStation,
  ListenerAlert,
  NowPlayingSnapshot,
  UserCollection
} from '../../domain/contracts';
import type { BehaviorProfile } from '../../lib/homeProfile';
import type { HomeSurfaceFeed } from '../../lib/homeSurface';
import type { useAudioPlayer } from '../../lib/useAudioPlayer';
import type {
  ActiveWinampSkin,
  AppSection,
  LibraryTab,
  PlayerPresentation,
  Station,
  StationLite,
  WinampMuseumSkin,
  WinampUploadedSkin,
  WinampSkinPreset,
  WinampSkinSource
} from '../../types';

export type TrackHistoryItem = {
  id: string;
  stationId: string;
  stationName: string;
  track: string;
  timestamp: number;
};

export type StoredSkin = {
  source: WinampSkinSource;
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
};

export type StoredLibraryState = {
  version: 2;
  favorites: StationLite[];
  recent: StationLite[];
  collections: UserCollection[];
  followedStations: FollowedStation[];
  followedRegions: FollowedRegion[];
  alerts: ListenerAlert[];
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
  clearQueue: () => void;
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
  availableSkins: WinampSkinPreset[];
  activeSkin: ActiveWinampSkin;
  setSkin: (skinId: string) => void;
  selectSkin: (skin: WinampMuseumSkin) => void;
  selectUploadedSkin: (skin: WinampUploadedSkin) => void;
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
  playPrevious: () => void;
  playNext: () => void;
  playLast: () => void;
  copyTrack: () => void;
  openExternal: (station: Station | StationLite) => void;
  shareStation: (station: Station | StationLite) => void;
};

export type LibraryContextValue = {
  knownStations: StationLite[];
  favorites: StationLite[];
  recent: StationLite[];
  collections: UserCollection[];
  followedStations: FollowedStation[];
  followedRegions: FollowedRegion[];
  alerts: ListenerAlert[];
  trackHistory: TrackHistoryItem[];
  playbackHistory: StationLite[];
  behaviorProfile: BehaviorProfile;
  toggleFavorite: (station: Station | StationLite) => void;
  isFavorite: (stationId: string) => boolean;
  clearFavorites: () => void;
  clearRecent: () => void;
  clearTrackHistory: () => void;
  createCollection: (name: string) => void;
  toggleCollectionPinned: (collectionId: string) => void;
  addStationToCollection: (collectionId: string, station: Station | StationLite) => void;
  removeStationFromCollection: (collectionId: string, stationId: string) => void;
  toggleFollowStation: (station: Station | StationLite) => void;
  toggleFollowRegion: (region: { id: string; label: string; scope: 'country' | 'area' }) => void;
  markAlertRead: (alertId: string) => void;
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
