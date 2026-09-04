import { DEFAULT_BEHAVIOR_PROFILE } from '../../lib/homeProfile';
import { DEFAULT_PLAYABILITY_PROFILE } from '../../lib/stationPlayability';
import { DEFAULT_STATION_HEALTH_PROFILE } from '../../lib/stationHealth';
import { DEFAULT_TASTE_PROFILE_V2 } from '../../lib/tasteProfile';
import { DEFAULT_NOTIFICATION_PREFERENCE } from '../../lib/retention';
import type {
  QueueSnapshot,
  StoredAppState,
  StoredLibraryState,
  StoredPlayerState,
  StoredShellState,
  StoredSkin,
  StoredWinampLayout
} from './types';

export const MAX_RECENT = 20;
/* MAX_TRACK_HISTORY is deliberately GONE.
   It capped finds at 200 and the 201st silently evicted the oldest — including
   at account merge, where 150 finds on one device plus 150 on another became
   200. Once the button says «Сохранить находку», a cap that quietly deletes is
   a broken promise, and the spike on 2026-09-03 showed it was protecting
   nothing: ten thousand finds merge in 6ms and cost 2.2MB of a ~5MB budget.
   Leaving the constant behind would tell the next reader a limit still exists. */
export const MAX_PLAYBACK_HISTORY = 80;
export const MAX_QUEUE_ITEMS = 120;

export const DEFAULT_STORED_SKIN: StoredSkin = {
  source: 'preset',
  id: 'legacy-lite'
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
  stationHealthProfile: DEFAULT_STATION_HEALTH_PROFILE,
  radioSessionEvents: [],
  stationExposure: {}
};

export const DEFAULT_LIBRARY_STATE: StoredLibraryState = {
  version: 2,
  favorites: [],
  recent: [],
  collections: [],
  followedStations: [],
  followedRegions: [],
  alerts: [],
  digests: [],
  notificationPreference: DEFAULT_NOTIFICATION_PREFERENCE,
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
