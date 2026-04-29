import { DEFAULT_BEHAVIOR_PROFILE } from '../../lib/homeProfile';
import { DEFAULT_PLAYABILITY_PROFILE } from '../../lib/stationPlayability';
import { DEFAULT_STATION_HEALTH_PROFILE } from '../../lib/stationHealth';
import { DEFAULT_TASTE_PROFILE_V2 } from '../../lib/tasteProfile';
import {
  DEFAULT_WINAMP_SKIN_ID,
  WINAMP_CLASSIC_PALETTE,
  findPresetSkin
} from '../../lib/winampSkins';
import type {
  QueueSnapshot,
  StoredAppState,
  StoredLibraryState,
  StoredPlayerState,
  StoredShellState,
  StoredSkin,
  StoredWinampLayout
} from './types';
import type { ActiveWinampSkin, WinampMuseumSkin } from '../../types';

export const MAX_RECENT = 20;
export const MAX_TRACK_HISTORY = 200;
export const MAX_PLAYBACK_HISTORY = 80;
export const MAX_QUEUE_ITEMS = 120;

export const DEFAULT_STORED_SKIN: StoredSkin = {
  source: 'preset',
  id: DEFAULT_WINAMP_SKIN_ID
};

export const DEFAULT_QUEUE: QueueSnapshot = {
  items: [],
  currentIndex: -1,
  sourceId: null,
  sourceLabel: null
};

export const DEFAULT_LAYOUT: StoredWinampLayout = {
  version: 3,
  windowPositions: {},
  windowVisibility: {
    'equalizer-window': true,
    'playlist-window': true
  }
};

export const DEFAULT_SHELL_STATE: StoredShellState = {
  version: 3,
  activeSection: 'home',
  playerPresentation: 'peek',
  libraryTab: 'favorites',
  detailsOpen: false,
  home: {
    sessionSeed: Date.now(),
    lastBuiltAt: null,
    snapshot: null
  },
  searchDraft: ''
};

export const DEFAULT_APP_STATE: StoredAppState = {
  version: 2,
  shell: DEFAULT_SHELL_STATE,
  behaviorProfile: DEFAULT_BEHAVIOR_PROFILE,
  playabilityProfile: DEFAULT_PLAYABILITY_PROFILE,
  tasteProfile: DEFAULT_TASTE_PROFILE_V2,
  stationHealthProfile: DEFAULT_STATION_HEALTH_PROFILE
};

export const DEFAULT_LIBRARY_STATE: StoredLibraryState = {
  version: 2,
  favorites: [],
  recent: [],
  collections: [],
  followedStations: [],
  followedRegions: [],
  alerts: [],
  trackHistory: [],
  playbackHistory: [],
  stationCache: {}
};

export const DEFAULT_PLAYER_STATE: StoredPlayerState = {
  version: 2,
  queue: DEFAULT_QUEUE,
  skin: DEFAULT_STORED_SKIN,
  layout: DEFAULT_LAYOUT
};

export const toActiveSkin = (presetId: string | undefined): ActiveWinampSkin => {
  const preset = findPresetSkin(presetId);
  return {
    ...preset,
    source: 'preset'
  };
};

export const toMuseumActiveSkin = (skin: WinampMuseumSkin): ActiveWinampSkin => ({
  ...skin,
  source: 'museum'
});

export { DEFAULT_WINAMP_SKIN_ID, WINAMP_CLASSIC_PALETTE };
