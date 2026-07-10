import { Suspense, createContext, lazy, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  FollowedRegion,
  FollowedStation,
  ListenerAlert,
  NotificationPreference,
  PlaybackCandidate,
  RadioDigest,
  UserCollection
} from '../domain/contracts';
import type {
  AppSection,
  LibraryTab,
  PlayerPresentation,
  Station,
  StationLite
} from '../types';
import { toLite } from '../lib/stationUtils';
import { useSleepTimer } from '../lib/sleepTimer';
import { useOutputDeviceGuard } from '../lib/outputDeviceGuard';
import {
  recordSectionVisit,
  recordStationSignal
} from '../lib/homeProfile';
import type { HomeSurfaceFeed } from '../lib/homeSurface';
import type { BehaviorProfile } from '../lib/homeProfile';
import {
  DEFAULT_PLAYABILITY_PROFILE,
  recordPlaybackOutcome
} from '../lib/stationPlayability';
import type {
  PlaybackOutcomeKind,
  StationPlayabilityProfile
} from '../lib/stationPlayability';
import {
  DEFAULT_STATION_HEALTH_PROFILE,
  recordStationHealthSignal,
  stationHealthFailureKindForPlayback,
  stationHealthSuccessKindForCandidate
} from '../lib/stationHealth';
import type { StationHealthProfile } from '../lib/stationHealth';
import {
  DEFAULT_TASTE_PROFILE_V2,
  hideStationFromTasteProfile,
  isStationHiddenFromRecommendations as isStationHiddenByTaste,
  unhideStationFromTasteProfile,
  recordTasteSignal
} from '../lib/tasteProfile';
import {
  normalizeTrustedTrackTitle,
  upsertTrustedTrackHistory
} from '../lib/trackTrust';
import {
  applyCuratedStationFixupsToCache,
  applyCuratedStationFixupsToList,
  clearCuratedStationSignals
} from '../lib/curatedStationFixups';
import {
  DEFAULT_NOTIFICATION_PREFERENCE,
  buildListenerAlerts,
  buildRadioDigests,
  upsertListenerAlerts,
  upsertRadioDigests
} from '../lib/retention';
import {
  PERSONAL_RADIO_QUEUE_LIMIT,
  buildPersonalRadioQueue,
  refillPersonalRadioQueueItems
} from '../lib/personalRadio';
import {
  recordRadioSessionEvent,
  type RadioSessionEvent
} from '../lib/radioSession';
import {
  recordStationPlayed,
  recordStationsShown as recordStationsShownInLedger,
  type StationExposureLedger
} from '../lib/stationExposure';
import type {
  TasteProfileV2,
  TasteSignalAction,
  TasteSessionMode
} from '../lib/tasteProfile';
import {
  getTelegramWebApp,
  isInsideTelegramClient,
  makeDeepLink,
  openLinkOrFallback,
  shareStationLink
} from '../lib/telegram';
import { getDeviceProfile } from '../lib/deviceProfile';
import { useLocale } from './LocaleContext';
import { useSession } from './SessionContext';
import { getProxiedAssetUrl } from '../lib/assetUrl';
import { usePersistentState } from '../lib/persistentState';
import { reshuffleQueueSnapshot } from '../lib/shuffleStations';
import { buildQueueCollection } from '../lib/queueToCollection';
import {
  DEFAULT_APP_STATE,
  DEFAULT_LAYOUT,
  DEFAULT_LIBRARY_STATE,
  DEFAULT_PLAYER_STATE,
  DEFAULT_SHELL_STATE,
  MAX_QUEUE_ITEMS,
  MAX_PLAYBACK_HISTORY,
  MAX_RECENT,
  MAX_TRACK_HISTORY
} from './radio/defaults';
import {
  clampQueueIndex,
  getQueueSourceLabel,
  mergeUniqueStations,
  mergeStationCache,
  normalizeStations,
  resolveUpdater,
  snapshotsEqual
} from './radio/helpers';
import type {
  LibraryContextValue,
  PlaybackContextValue,
  PlayStationInternalOptions,
  PlayStationOptions,
  QueueSnapshot,
  QueueState,
  ShellContextValue,
  StoredAppState,
  StoredLibraryState,
  StoredPlayerState,
  StoredShellState,
  StoredWinampLayout,
  TrackHistoryItem,
  WinampState
} from './radio/types';
import { createPlaybackPlayerPlaceholder, type PlaybackRuntimeSnapshot } from './radio/playbackBridge';
import { useCloudLibrarySync } from './radio/useCloudLibrarySync';
import { IDLE_NOW_PLAYING_STATE } from './radio/nowPlayingDefaults';
import {
  reportProductEvent,
  stationAnalyticsMeta
} from '../lib/productAnalytics';

const PlaybackContext = createContext<PlaybackContextValue | null>(null);
const LibraryContext = createContext<LibraryContextValue | null>(null);
const ShellContext = createContext<ShellContextValue | null>(null);
const PlaybackRuntimeLazy = lazy(() =>
  import('./radio/PlaybackRuntime').then((mod) => ({ default: mod.PlaybackRuntime }))
);
const scheduleDeferredTask = (callback: () => void, timeout = 1800) => {
  const win = window as Window & {
    requestIdleCallback?: (cb: () => void, options?: { timeout?: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (win.requestIdleCallback) {
    const id = win.requestIdleCallback(callback, { timeout });
    return () => win.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(callback, timeout);
  return () => window.clearTimeout(id);
};
const LIBRARY_PERSIST_WRITE_DELAY_MS = 1_200;
const PLAYER_PERSIST_WRITE_DELAY_MS = 900;
const PLAYBACK_OUTCOME_MESSAGES: Record<string, PlaybackOutcomeKind> = {
  'api unavailable': 'api-unavailable',
  'audio engine unavailable': 'unknown',
  'media network error': 'stream-unavailable',
  'media source not supported': 'unsupported-transport',
  'no playable candidate': 'no-playable-candidate',
  'playback superseded': 'superseded',
  'stream blocked/mixed content': 'mixed-content'
};

const normalizePlaybackOutcome = (error?: string): PlaybackOutcomeKind => {
  const normalized = error?.trim().toLowerCase() || '';
  if (!normalized) return 'unknown';
  if (PLAYBACK_OUTCOME_MESSAGES[normalized]) return PLAYBACK_OUTCOME_MESSAGES[normalized];
  if (normalized.includes('mixed content') || normalized.includes('blocked')) return 'mixed-content';
  if (normalized.includes('api unavailable')) return 'api-unavailable';
  if (normalized.includes('not supported')) return 'unsupported-transport';
  if (normalized.includes('network')) return 'stream-unavailable';
  if (normalized.includes('candidate')) return 'no-playable-candidate';
  return 'unknown';
};

export const RadioProvider = ({ children }: { children: ReactNode }) => {
  const { t } = useLocale();
  const {
    status: sessionStatus,
    profile: sessionProfile,
    library: cloudLibrary,
    replaceCloudLibrary
  } = useSession();
  const [storedAppState, setStoredAppState] = usePersistentState<StoredAppState>(
    'radio:app:v2',
    DEFAULT_APP_STATE,
    {
      clearLegacyKeys: ['radio:shell-state:v1', 'radio:behavior-profile:v1']
    }
  );
  const [storedLibraryState, setStoredLibraryState] = usePersistentState<StoredLibraryState>(
    'radio:library:v2',
    DEFAULT_LIBRARY_STATE,
    {
      writeDelayMs: LIBRARY_PERSIST_WRITE_DELAY_MS,
      clearLegacyKeys: [
        'radio:track-history',
        'radio:favorites',
        'radio:recent',
        'radio:collections:v1',
        'radio:follows:stations:v1',
        'radio:follows:regions:v1',
        'radio:alerts:v1',
        'radio:playback-history:v2'
      ]
    }
  );
  const [storedPlayerState, setStoredPlayerState] = usePersistentState<StoredPlayerState>(
    'radio:player:v2',
    DEFAULT_PLAYER_STATE,
    {
      writeDelayMs: PLAYER_PERSIST_WRITE_DELAY_MS,
      clearLegacyKeys: [
        'radio:playback-queue:v2',
        'radio:winamp-skin',
        'radio:winamp-layout:v3'
      ]
    }
  );
  const [toast, setToast] = useState<string | null>(null);
  const storedShellState = storedAppState.shell;
  const behaviorProfile =
    storedAppState.behaviorProfile?.version === 1
      ? storedAppState.behaviorProfile
      : DEFAULT_APP_STATE.behaviorProfile;
  const playabilityProfile =
    storedAppState.playabilityProfile?.version === 1
      ? storedAppState.playabilityProfile
      : DEFAULT_PLAYABILITY_PROFILE;
  const tasteProfile =
    storedAppState.tasteProfile?.version === 2
      ? storedAppState.tasteProfile
      : DEFAULT_TASTE_PROFILE_V2;
  const stationHealthProfile =
    storedAppState.stationHealthProfile?.version === 1
      ? storedAppState.stationHealthProfile
      : DEFAULT_STATION_HEALTH_PROFILE;
  const radioSessionEvents = Array.isArray(storedAppState.radioSessionEvents)
    ? storedAppState.radioSessionEvents
    : DEFAULT_APP_STATE.radioSessionEvents;
  const stationExposure =
    storedAppState.stationExposure && typeof storedAppState.stationExposure === 'object'
      ? storedAppState.stationExposure
      : {};
  const [transientHomeState, setTransientHomeState] = useState(storedShellState.home);
  const homeState = transientHomeState;
  const searchDraft = storedShellState.searchDraft;
  const favorites = storedLibraryState.favorites;
  const recent = storedLibraryState.recent;
  const collections = storedLibraryState.collections;
  const followedStations = storedLibraryState.followedStations;
  const followedRegions = storedLibraryState.followedRegions;
  const alerts = storedLibraryState.alerts;
  const digests = storedLibraryState.digests || [];
  const notificationPreference =
    storedLibraryState.notificationPreference?.version === 1
      ? storedLibraryState.notificationPreference
      : DEFAULT_NOTIFICATION_PREFERENCE;
  const trackHistory = storedLibraryState.trackHistory;
  const playbackHistoryEntries = storedLibraryState.playbackHistory;
  const knownStations = useMemo(
    () => Object.values(storedLibraryState.stationCache),
    [storedLibraryState.stationCache]
  );
  const storedQueue = storedPlayerState.queue ?? DEFAULT_PLAYER_STATE.queue;
  const storedLayout = storedPlayerState.layout ?? DEFAULT_PLAYER_STATE.layout;

  const setStoredShellState = (next: StoredShellState | ((prev: StoredShellState) => StoredShellState)) =>
    setStoredAppState((prev) => {
      const shell = resolveUpdater(prev.shell, next);
      return Object.is(shell, prev.shell) ? prev : { ...prev, shell };
    });
  const setHomeSnapshot = (snapshot: HomeSurfaceFeed) =>
    setTransientHomeState((prev) => ({
      ...prev,
      sessionSeed: snapshot.seed,
      lastBuiltAt: snapshot.builtAt,
      snapshot
    }));
  const refreshHomeSurface = (seed = Date.now()) =>
    setTransientHomeState({
      sessionSeed: seed,
      lastBuiltAt: null,
      snapshot: null
    });
  // Discovery «Лента» open-seed. Separate from the Home sessionSeed (which is
  // frozen per session to keep the Home rails from reshuffling) so the feed can
  // re-roll on EVERY open — a fresh personal-fresh mix each time — without
  // disturbing Home. rerollFeedSeed is called from the «Лента» entry's onClick
  // (a user gesture, never an effect), so it is StrictMode-safe: one bump per
  // real tap, no double-fire. Transient (not persisted): a reload naturally
  // mints a new seed, which is the desired "fresh feed on open" behaviour.
  const [feedSeed, setFeedSeed] = useState(() => homeState.sessionSeed);
  const rerollFeedSeed = useCallback(() => setFeedSeed(Date.now()), []);
  const setSearchDraft = (value: string) =>
    setStoredShellState((prev) =>
      prev.searchDraft === value
        ? prev
        : {
            ...prev,
            searchDraft: value
          }
    );
  const clearSearchDraft = () => setSearchDraft('');
  const setBehaviorProfile = (
    next: BehaviorProfile | ((prev: BehaviorProfile) => BehaviorProfile)
  ) =>
    setStoredAppState((prev) => {
      const behaviorProfile = resolveUpdater(prev.behaviorProfile || DEFAULT_APP_STATE.behaviorProfile, next);
      return Object.is(behaviorProfile, prev.behaviorProfile) ? prev : { ...prev, behaviorProfile };
    });
  const setPlayabilityProfile = (
    next:
      | StationPlayabilityProfile
      | ((prev: StationPlayabilityProfile) => StationPlayabilityProfile)
  ) =>
    setStoredAppState((prev) => {
      const playabilityProfile = resolveUpdater(
        prev.playabilityProfile || DEFAULT_PLAYABILITY_PROFILE,
        next
      );
      return Object.is(playabilityProfile, prev.playabilityProfile) ? prev : { ...prev, playabilityProfile };
    });
  const setTasteProfile = (
    next: TasteProfileV2 | ((prev: TasteProfileV2) => TasteProfileV2)
  ) =>
    setStoredAppState((prev) => {
      const tasteProfile = resolveUpdater(
        prev.tasteProfile || DEFAULT_TASTE_PROFILE_V2,
        next
      );
      return Object.is(tasteProfile, prev.tasteProfile) ? prev : { ...prev, tasteProfile };
    });
  const setStationHealthProfile = (
    next:
      | StationHealthProfile
      | ((prev: StationHealthProfile) => StationHealthProfile)
  ) =>
    setStoredAppState((prev) => {
      const stationHealthProfile = resolveUpdater(
        prev.stationHealthProfile || DEFAULT_STATION_HEALTH_PROFILE,
        next
      );
      return Object.is(stationHealthProfile, prev.stationHealthProfile)
        ? prev
        : { ...prev, stationHealthProfile };
    });
  const setRadioSessionEvents = (
    next: RadioSessionEvent[] | ((prev: RadioSessionEvent[]) => RadioSessionEvent[])
  ) =>
    setStoredAppState((prev) => {
      const radioSessionEvents = resolveUpdater(prev.radioSessionEvents || [], next);
      return Object.is(radioSessionEvents, prev.radioSessionEvents) ? prev : { ...prev, radioSessionEvents };
    });
  const setStationExposure = (
    next: StationExposureLedger | ((prev: StationExposureLedger) => StationExposureLedger)
  ) =>
    setStoredAppState((prev) => {
      const stationExposure = resolveUpdater(prev.stationExposure || {}, next);
      return Object.is(stationExposure, prev.stationExposure) ? prev : { ...prev, stationExposure };
    });
  // Discovery surfaces (the «Лента» feed) flush the ids they actually surfaced so
  // the next open can softly demote them. One batched update per flush.
  const recordStationsShown = (stationIds: string[]) => {
    const ids = (stationIds || []).filter(Boolean);
    if (!ids.length) return;
    setStationExposure((prev) => recordStationsShownInLedger(prev, ids));
  };
  const setFavorites = (next: StationLite[] | ((prev: StationLite[]) => StationLite[])) =>
    setStoredLibraryState((prev) => ({
      ...prev,
      favorites: resolveUpdater(prev.favorites, next)
    }));
  const setRecent = (next: StationLite[] | ((prev: StationLite[]) => StationLite[])) =>
    setStoredLibraryState((prev) => ({
      ...prev,
      recent: resolveUpdater(prev.recent, next)
    }));
  const setCollections = (
    next: UserCollection[] | ((prev: UserCollection[]) => UserCollection[])
  ) =>
    setStoredLibraryState((prev) => ({
      ...prev,
      collections: resolveUpdater(prev.collections, next)
    }));
  const setFollowedStations = (
    next: FollowedStation[] | ((prev: FollowedStation[]) => FollowedStation[])
  ) =>
    setStoredLibraryState((prev) => ({
      ...prev,
      followedStations: resolveUpdater(prev.followedStations, next)
    }));
  const setFollowedRegions = (
    next: FollowedRegion[] | ((prev: FollowedRegion[]) => FollowedRegion[])
  ) =>
    setStoredLibraryState((prev) => ({
      ...prev,
      followedRegions: resolveUpdater(prev.followedRegions, next)
    }));
  const setAlerts = (next: ListenerAlert[] | ((prev: ListenerAlert[]) => ListenerAlert[])) =>
    setStoredLibraryState((prev) => ({
      ...prev,
      alerts: resolveUpdater(prev.alerts || [], next)
    }));
  const setDigests = (next: RadioDigest[] | ((prev: RadioDigest[]) => RadioDigest[])) =>
    setStoredLibraryState((prev) => ({
      ...prev,
      digests: resolveUpdater(prev.digests || [], next)
    }));
  const setNotificationPreference = (
    next:
      | NotificationPreference
      | ((prev: NotificationPreference) => NotificationPreference)
  ) =>
    setStoredLibraryState((prev) => ({
      ...prev,
      notificationPreference: resolveUpdater(
        prev.notificationPreference?.version === 1
          ? prev.notificationPreference
          : DEFAULT_NOTIFICATION_PREFERENCE,
        next
      )
    }));
  const setTrackHistory = (
    next: TrackHistoryItem[] | ((prev: TrackHistoryItem[]) => TrackHistoryItem[])
  ) =>
    setStoredLibraryState((prev) => ({
      ...prev,
      trackHistory: resolveUpdater(prev.trackHistory, next)
    }));
  const setPlaybackHistoryEntries = (
    next: StationLite[] | ((prev: StationLite[]) => StationLite[])
  ) =>
    setStoredLibraryState((prev) => ({
      ...prev,
      playbackHistory: resolveUpdater(prev.playbackHistory, next)
    }));
  const rememberStations = (stations: Array<Station | StationLite | null | undefined>) =>
    setStoredLibraryState((prev) => ({
      ...prev,
      stationCache: mergeStationCache(prev.stationCache, stations)
    }));
  const setStoredQueue = (
    next: QueueSnapshot | ((prev: QueueSnapshot) => QueueSnapshot)
  ) =>
    setStoredPlayerState((prev) => ({
      ...prev,
      queue: resolveUpdater(prev.queue, next)
    }));
  const setStoredLayout = (
    next: StoredWinampLayout | ((prev: StoredWinampLayout) => StoredWinampLayout)
  ) =>
    setStoredPlayerState((prev) => ({
      ...prev,
      layout: resolveUpdater(prev.layout, next)
    }));

  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [playbackHistoryCursor, setPlaybackHistoryCursor] = useState(() =>
    playbackHistoryEntries.length ? playbackHistoryEntries.length - 1 : -1
  );
  const [globeFocusRegionId, setGlobeFocusRegionId] = useState<string | null>(null);
  const [skinLabOpen, setSkinLabOpen] = useState(false);
  const debugLoggingEnabled =
    import.meta.env.DEV ||
    (typeof window !== 'undefined' &&
      Boolean((window as typeof window & { __RA_DEBUG_LOGS__?: boolean }).__RA_DEBUG_LOGS__));

  const logDebug = useCallback(
    (msg: string) => {
      if (!debugLoggingEnabled) {
        return;
      }
      setDebugLogs((prev) =>
        [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 50)
      );
    },
    [debugLoggingEnabled]
  );

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2000);
  };

  const resolvePlaybackToastMessage = (message: string | null | undefined) => {
    switch (message) {
      case 'stream blocked/mixed content':
        return t('toast.mixedContent');
      case 'api unavailable':
        return t('toast.apiUnavailable');
      case 'media source not supported':
        return t('toast.unsupportedTransport');
      case 'media network error':
        return t('toast.streamUnavailable');
      case 'no playable candidate':
        return t('toast.noPlayable');
      default:
        return message || t('toast.playbackFailed');
    }
  };

  const [playbackRuntime, setPlaybackRuntime] = useState<PlaybackRuntimeSnapshot>(() => ({
    player: createPlaybackPlayerPlaceholder(),
    nowPlaying: null,
    nowPlayingStatus: 'idle',
    nowPlayingState: IDLE_NOW_PLAYING_STATE
  }));
  const [playbackRuntimeMounted, setPlaybackRuntimeMounted] = useState(
    () => storedQueue.currentIndex >= 0 && storedQueue.items.length > 0
  );
  const playbackRuntimeRef = useRef(playbackRuntime);
  const playbackRuntimeReadyRef = useRef(false);
  const playbackRuntimeWaitersRef = useRef<Array<() => void>>([]);
  const handlePlaybackRuntimeSnapshot = useCallback((snapshot: PlaybackRuntimeSnapshot) => {
    playbackRuntimeRef.current = snapshot;
    playbackRuntimeReadyRef.current = true;
    if (playbackRuntimeWaitersRef.current.length) {
      const waiters = playbackRuntimeWaitersRef.current;
      playbackRuntimeWaitersRef.current = [];
      waiters.forEach((resolve) => resolve());
    }
    setPlaybackRuntime(snapshot);
  }, []);
  useEffect(() => {
    playbackRuntimeRef.current = playbackRuntime;
  }, [playbackRuntime]);
  const ensurePlaybackRuntimeMounted = useCallback(async () => {
    if (playbackRuntimeReadyRef.current) return;
    setPlaybackRuntimeMounted(true);
    await new Promise<void>((resolve) => {
      if (playbackRuntimeReadyRef.current) {
        resolve();
        return;
      }
      playbackRuntimeWaitersRef.current.push(resolve);
    });
  }, []);
  const player = playbackRuntime.player;
  const nowPlaying = playbackRuntime.nowPlaying;
  const nowPlayingStatus = playbackRuntime.nowPlayingStatus;
  const nowPlayingState = playbackRuntime.nowPlayingState;
  const fullscreenRetryRef = useRef<number | null>(null);
  const manualPresentationRef = useRef(false);
  const queueRef = useRef<QueueSnapshot>(storedQueue);
  const historyEntriesRef = useRef<StationLite[]>(playbackHistoryEntries);
  const historyCursorRef = useRef(playbackHistoryCursor);
  const currentStartedAtRef = useRef<number | null>(null);
  const currentStartedStationIdRef = useRef<string | null>(null);
  const runtimeFailureSignatureRef = useRef('');
  const personalRadioRefillSignatureRef = useRef('');
  const listened30sRef = useRef<string | null>(null);
  // Sleep-timer state read at signal-fire time (the sleep timer is set up far
  // below, after the listen-signal effects) — so no listening counts as a taste
  // preference once the user has told us they're drifting off («уснул под неё»).
  const sleepActiveRef = useRef(false);
  // Which sustained-listen milestones (ms) a station-play session has already
  // credited — reset when the station changes, so the graded engagement fires
  // once per session and stays capped.
  const engagementRef = useRef<{ stationId: string | null; reached: Set<number> }>({
    stationId: null,
    reached: new Set()
  });
  const activeSection = storedShellState.activeSection;
  const playerPresentation = storedShellState.playerPresentation;
  const libraryTab = storedShellState.libraryTab;
  const detailsOpen = storedShellState.detailsOpen;
  const winampExpanded = playerPresentation === 'expanded';

  useEffect(() => {
    if (playbackRuntimeMounted) return;
    if (storedQueue.currentIndex >= 0 && storedQueue.items.length > 0) {
      setPlaybackRuntimeMounted(true);
      return;
    }
    const deviceProfile = getDeviceProfile();
    if (deviceProfile.lowPower) {
      return;
    }
    return scheduleDeferredTask(() => setPlaybackRuntimeMounted(true));
  }, [playbackRuntimeMounted, storedQueue.currentIndex, storedQueue.items.length]);

  useEffect(() => {
    queueRef.current = storedQueue;
  }, [storedQueue]);

  useEffect(() => {
    historyEntriesRef.current = playbackHistoryEntries;
  }, [playbackHistoryEntries]);

  useEffect(() => {
    historyCursorRef.current = playbackHistoryCursor;
  }, [playbackHistoryCursor]);

  useEffect(() => {
    return () => {
      if (fullscreenRetryRef.current !== null) {
        window.clearTimeout(fullscreenRetryRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (storedLayout?.version === 3) return;
    setStoredLayout({
      version: 3,
      windowPositions: storedLayout?.windowPositions ?? DEFAULT_LAYOUT.windowPositions,
      windowVisibility: storedLayout?.windowVisibility ?? DEFAULT_LAYOUT.windowVisibility
    });
  }, [setStoredLayout, storedLayout]);

  useEffect(() => {
    if (storedShellState?.version === DEFAULT_SHELL_STATE.version) return;
    const legacyShell = storedShellState as Partial<StoredShellState> & {
      home?: Partial<StoredShellState['home']>;
      searchDraft?: unknown;
    };
    setStoredShellState({
      ...DEFAULT_SHELL_STATE,
      activeSection: legacyShell.activeSection ?? DEFAULT_SHELL_STATE.activeSection,
      playerPresentation:
        legacyShell.playerPresentation ?? DEFAULT_SHELL_STATE.playerPresentation,
      libraryTab: legacyShell.libraryTab ?? DEFAULT_SHELL_STATE.libraryTab,
      detailsOpen: legacyShell.detailsOpen ?? DEFAULT_SHELL_STATE.detailsOpen,
      home: {
        sessionSeed:
          typeof legacyShell.home?.sessionSeed === 'number'
            ? legacyShell.home.sessionSeed
            : Date.now(),
        lastBuiltAt:
          typeof legacyShell.home?.lastBuiltAt === 'number'
            ? legacyShell.home.lastBuiltAt
            : null,
        snapshot: legacyShell.home?.snapshot ?? null
      },
      searchDraft:
        typeof legacyShell.searchDraft === 'string' ? legacyShell.searchDraft : ''
    });
  }, [setStoredShellState, storedShellState]);

  useEffect(() => {
    if (behaviorProfile?.version === 1) return;
    setBehaviorProfile(DEFAULT_APP_STATE.behaviorProfile);
  }, [behaviorProfile, setBehaviorProfile]);

  useEffect(() => {
    if (playabilityProfile?.version === 1) return;
    setPlayabilityProfile(DEFAULT_PLAYABILITY_PROFILE);
  }, [playabilityProfile, setPlayabilityProfile]);

  useEffect(() => {
    if (tasteProfile?.version === 2) return;
    setTasteProfile(DEFAULT_TASTE_PROFILE_V2);
  }, [tasteProfile, setTasteProfile]);

  useEffect(() => {
    if (stationHealthProfile?.version === 1) return;
    setStationHealthProfile(DEFAULT_STATION_HEALTH_PROFILE);
  }, [stationHealthProfile, setStationHealthProfile]);

  useEffect(() => {
    setStoredLibraryState((prev) => {
      const favorites = applyCuratedStationFixupsToList(prev.favorites);
      const recent = applyCuratedStationFixupsToList(prev.recent);
      const playbackHistory = applyCuratedStationFixupsToList(prev.playbackHistory);
      const stationCache = applyCuratedStationFixupsToCache(prev.stationCache);
      if (
        favorites === prev.favorites &&
        recent === prev.recent &&
        playbackHistory === prev.playbackHistory &&
        stationCache === prev.stationCache
      ) {
        return prev;
      }
      return {
        ...prev,
        favorites,
        recent,
        playbackHistory,
        stationCache
      };
    });
    setStoredPlayerState((prev) => {
      const items = applyCuratedStationFixupsToList(prev.queue.items);
      return items === prev.queue.items ? prev : { ...prev, queue: { ...prev.queue, items } };
    });
    setStoredAppState((prev) => {
      const playabilityProfile = clearCuratedStationSignals(prev.playabilityProfile);
      const stationHealthProfile = clearCuratedStationSignals(prev.stationHealthProfile);
      return playabilityProfile === prev.playabilityProfile &&
        stationHealthProfile === prev.stationHealthProfile
        ? prev
        : {
            ...prev,
            playabilityProfile,
            stationHealthProfile
          };
    });
  }, [setStoredAppState, setStoredLibraryState, setStoredPlayerState]);

  const { syncCloudLibraryImmediately } = useCloudLibrarySync({
    alerts,
    cloudLibrary,
    collections,
    favorites,
    followedRegions,
    followedStations,
    recent,
    replaceCloudLibrary,
    sessionProfileId: sessionProfile?.id,
    sessionStatus,
    setAlerts,
    setCollections,
    setFavorites,
    setFollowedRegions,
    setFollowedStations,
    setRecent,
    setTasteProfile,
    setTrackHistory,
    tasteProfile,
    trackHistory
  });

  useEffect(() => {
    if (!playbackHistoryEntries.length) {
      if (playbackHistoryCursor !== -1) {
        setPlaybackHistoryCursor(-1);
      }
      return;
    }
    if (playbackHistoryCursor >= playbackHistoryEntries.length) {
      setPlaybackHistoryCursor(playbackHistoryEntries.length - 1);
    }
  }, [playbackHistoryCursor, playbackHistoryEntries]);

  const updateQueue = (nextSnapshot: QueueSnapshot) => {
    const sanitizedItems = normalizeStations(nextSnapshot.items);
    const queueSnapshot: QueueSnapshot = {
      items: sanitizedItems,
      currentIndex: clampQueueIndex(sanitizedItems, nextSnapshot.currentIndex),
      sourceId: nextSnapshot.sourceId,
      sourceLabel: getQueueSourceLabel(
        nextSnapshot.sourceId,
        nextSnapshot.sourceLabel,
        sanitizedItems,
        t
      )
    };

    setStoredQueue((prev) => (snapshotsEqual(prev, queueSnapshot) ? prev : queueSnapshot));
    reportProductEvent(
      'queue_source',
      {
        sourceId: queueSnapshot.sourceId || null,
        queueCount: queueSnapshot.items.length,
        currentIndex: queueSnapshot.currentIndex
      },
      {
        dedupeKey: `queue_source:${queueSnapshot.sourceId || 'none'}:${queueSnapshot.items.length}`,
        dedupeMs: 10_000
      }
    );
  };

  const resolveQueueSnapshot = (
    station: StationLite,
    options?: PlayStationOptions,
    fallbackQueue?: QueueSnapshot
  ) => {
    const playlistOverride = options?.playlist?.length ? normalizeStations(options.playlist) : [];
    if (playlistOverride.length) {
      const index = playlistOverride.findIndex(
        (item) => item.stationuuid === station.stationuuid
      );
      const items =
        index === -1 ? mergeUniqueStations([station], playlistOverride) : playlistOverride;
      return {
        items,
        currentIndex: Math.max(
          0,
          items.findIndex((item) => item.stationuuid === station.stationuuid)
        ),
        sourceId: options?.sourceId ?? 'playback-context',
        sourceLabel: getQueueSourceLabel(
          options?.sourceId ?? 'playback-context',
          options?.sourceLabel,
          items,
          t
        )
      };
    }

    const currentQueue = fallbackQueue ?? queueRef.current;
    const existingIndex = currentQueue.items.findIndex(
      (item) => item.stationuuid === station.stationuuid
    );
    if (existingIndex >= 0) {
      return {
        ...currentQueue,
        currentIndex: existingIndex,
        sourceId: options?.sourceId ?? currentQueue.sourceId,
        sourceLabel: getQueueSourceLabel(
          options?.sourceId ?? currentQueue.sourceId,
          options?.sourceLabel ?? currentQueue.sourceLabel,
          currentQueue.items,
          t
        )
      };
    }

    const items = normalizeStations([station]);
    const sourceId = options?.sourceId ?? `station-${station.stationuuid}`;
    return {
      items,
      currentIndex: items.length ? 0 : -1,
      sourceId,
      sourceLabel: getQueueSourceLabel(sourceId, options?.sourceLabel ?? station.name, items, t)
    };
  };

  const pushPlaybackHistory = (
    station: StationLite,
    recordHistory: boolean,
    historyCursorTarget?: number
  ) => {
    rememberStations([station]);
    if (!recordHistory) {
      if (typeof historyCursorTarget === 'number') {
        setPlaybackHistoryCursor(historyCursorTarget);
        return;
      }
      const existingIndex = historyEntriesRef.current.findIndex(
        (item) => item.stationuuid === station.stationuuid
      );
      if (existingIndex >= 0) {
        setPlaybackHistoryCursor(existingIndex);
      }
      return;
    }

    const base =
      historyCursorRef.current >= 0
        ? historyEntriesRef.current.slice(0, historyCursorRef.current + 1)
        : historyEntriesRef.current;
    const last = base[base.length - 1];
    let next = base;
    if (last?.stationuuid === station.stationuuid) {
      next = [...base.slice(0, -1), station];
    } else {
      next = [...base, station];
    }
    if (next.length > MAX_PLAYBACK_HISTORY) {
      next = next.slice(next.length - MAX_PLAYBACK_HISTORY);
    }
    setPlaybackHistoryEntries(next);
    setPlaybackHistoryCursor(next.length - 1);
  };

  useEffect(() => {
    // ready() / expand() are documented to no-op on standalone web once
    // the SDK is loaded, so it is safe to call them through the lenient
    // getTelegramWebApp() helper without a strict client-only gate.
    const tg = getTelegramWebApp();
    tg?.ready?.();
    tg?.expand?.();
    if (tg?.isActive) {
      logDebug(`WebApp active state: ${tg.isActive}`);
    }
    // T1.2: disableVerticalSwipes kills the system "swipe down to
    // minimise" gesture that competes with our own dock-tray. Strict
    // client gate so future SDK behaviour drift on standalone web
    // cannot accidentally call it there - intent stays explicit.
    // Mount-only; the SDK persists the disabled state for the WebApp
    // lifetime, no re-enable needed.
    if (isInsideTelegramClient() && tg?.disableVerticalSwipes) {
      tg.disableVerticalSwipes();
    }
  }, []);

  // T1.2: drive the Telegram closing-confirmation toggle off the
  // canonical audio-element `isPlaying` state. We intentionally do NOT
  // call enable() in the play-button onClick / disable() in the
  // pause-button onClick - the player flips isPlaying without explicit
  // clicks on stream stalls, error recovery, queue end, station
  // switches. The effect is the only place that owns the toggle. The
  // cleanup disables on unmount so a navigation tear-down does not
  // leave the close-confirm prompt armed.
  useEffect(() => {
    if (!isInsideTelegramClient()) return;
    const tg = getTelegramWebApp();
    if (!tg) return;
    if (player.isPlaying) {
      tg.enableClosingConfirmation?.();
    } else {
      tg.disableClosingConfirmation?.();
    }
    return () => {
      tg.disableClosingConfirmation?.();
    };
  }, [player.isPlaying]);

  useEffect(() => {
    if (player.current && playerPresentation === 'peek') {
      setStoredShellState((prev) => ({
        ...prev,
        playerPresentation: 'bar'
      }));
    }
    if (!player.current && playerPresentation === 'expanded' && !manualPresentationRef.current) {
      setStoredShellState((prev) => ({
        ...prev,
        playerPresentation: 'peek',
        detailsOpen: false
      }));
    }
  }, [player.current, playerPresentation, setStoredShellState]);

  const sessionModeFromSourceId = (sourceId?: string | null): TasteSessionMode => {
    if (!sourceId) return 'resume';
    if (sourceId.includes('personal')) return 'personal';
    if (sourceId.includes('discover') || sourceId.includes('search')) return 'search';
    if (sourceId.includes('globe') || sourceId.includes('region')) return 'globe';
    if (sourceId.includes('collection')) return 'collection';
    return 'resume';
  };

  const recordSessionEventForStation = (
    station: Station | StationLite,
    action: RadioSessionEvent['action'],
    sourceId: string | null | undefined = queueRef.current.sourceId
  ) => {
    const lite = toLite(station);
    if (!lite.stationuuid) return;
    setRadioSessionEvents((prev) =>
      recordRadioSessionEvent(prev, {
        stationId: lite.stationuuid,
        action,
        mode: sessionModeFromSourceId(sourceId),
        timestamp: Date.now()
      })
    );
  };

  const recordTasteForStation = (
    station: Station | StationLite,
    action: TasteSignalAction,
    mode: TasteSessionMode = sessionModeFromSourceId(queueRef.current.sourceId),
    weightOverride?: number
  ) => {
    const lite = toLite(station);
    setTasteProfile((prev) =>
      recordTasteSignal(prev, lite, action, {
        mode,
        weightOverride
      })
    );
  };

  const recordBehaviorForStation = (
    station: Station | StationLite,
    action: 'play' | 'favorite' | 'track-copy' | 'follow' | 'collection',
    weightOverride?: number
  ) => {
    const lite = toLite(station);
    const mode = sessionModeFromSourceId(queueRef.current.sourceId);
    setBehaviorProfile((prev) => recordStationSignal(prev, lite, action, weightOverride));
    if (action === 'collection') {
      recordTasteForStation(lite, 'saved-to-collection', mode, weightOverride);
    }
    if (action === 'follow') {
      recordTasteForStation(lite, 'liked', mode, weightOverride);
    }
    if (action === 'track-copy') {
      recordTasteForStation(lite, 'listened-30s', mode, weightOverride);
    }
  };

  const recordPlaybackOutcomeForStation = (
    station: Station | StationLite,
    outcome: PlaybackOutcomeKind,
    options?: {
      activeCandidate?: PlaybackCandidate | null;
      startupMs?: number | null;
    }
  ) => {
    const lite = toLite(station);
    setPlayabilityProfile((prev) => recordPlaybackOutcome(prev, lite, outcome));
    if (outcome === 'superseded') return;
    if (outcome === 'metadata-unavailable') {
      setStationHealthProfile((prev) =>
        recordStationHealthSignal(prev, lite, 'metadata-unavailable')
      );
      return;
    }
    if (outcome === 'success') {
      setStationHealthProfile((prev) =>
        recordStationHealthSignal(
          prev,
          lite,
          stationHealthSuccessKindForCandidate(lite, options?.activeCandidate),
          {
            startupMs: options?.startupMs ?? null
          }
        )
      );
      return;
    }
    recordSessionEventForStation(lite, 'failed');
    setStationHealthProfile((prev) =>
      recordStationHealthSignal(prev, lite, stationHealthFailureKindForPlayback(outcome))
    );
    recordTasteForStation(lite, 'station-failed');
  };

  const reportStationBroken = (station: Station | StationLite) => {
    const lite = toLite(station);
    rememberStations([lite]);
    recordPlaybackOutcomeForStation(lite, 'stream-unavailable');
    reportProductEvent(
      'station_report_broken',
      {
        ...stationAnalyticsMeta(lite),
        mode: sessionModeFromSourceId(queueRef.current.sourceId),
        sourceId: queueRef.current.sourceId || null
      },
      {
        dedupeKey: `station_report_broken:${lite.stationuuid}:${Date.now()}`
      }
    );
    notify(t('toast.stationReportedBroken', { station: lite.name }));
  };

  useEffect(() => {
    const station = player.current;
    if (!station || !player.isPlaying) return;
    const stationId = station.stationuuid;
    const timer = window.setTimeout(() => {
      if (sleepActiveRef.current) return; // asleep/background — not a preference
      if (listened30sRef.current === stationId) return;
      listened30sRef.current = stationId;
      recordTasteForStation(station, 'listened-30s');
    }, 30_000);

    return () => window.clearTimeout(timer);
  }, [player.current, player.isPlaying]);

  // Graded engagement: reward SUSTAINED active listening past 4/20-min milestones
  // with diminishing weights, then STOP — a genuine long listen counts more than a
  // 30s sample, but a marathon / background / asleep-under-it session can't
  // runaway-inflate a station's score. Milestones fire once per station-play
  // session; switching stations resets them. Suppressed while the sleep timer is
  // active (the user explicitly signalled they're drifting off).
  useEffect(() => {
    const station = player.current;
    if (!station || !player.isPlaying) return;
    const stationId = station.stationuuid;
    if (engagementRef.current.stationId !== stationId) {
      engagementRef.current = { stationId, reached: new Set() };
    }
    const milestones: Array<{ ms: number; weight: number }> = [
      { ms: 4 * 60_000, weight: 3 },
      { ms: 20 * 60_000, weight: 3.5 }
    ];
    const timers = milestones
      .filter((milestone) => !engagementRef.current.reached.has(milestone.ms))
      .map((milestone) =>
        window.setTimeout(() => {
          if (sleepActiveRef.current) return;
          if (engagementRef.current.stationId !== stationId) return;
          if (engagementRef.current.reached.has(milestone.ms)) return;
          engagementRef.current.reached.add(milestone.ms);
          recordTasteForStation(station, 'sustained-listen', undefined, milestone.weight);
        }, milestone.ms)
      );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [player.current, player.isPlaying]);

  const setActiveSection = (section: AppSection) => {
    setStoredShellState((prev) => (prev.activeSection === section ? prev : { ...prev, activeSection: section }));
    setBehaviorProfile((prev) => recordSectionVisit(prev, section));
  };

  const setPlayerPresentation = (presentation: PlayerPresentation) =>
    {
      manualPresentationRef.current = true;
      setStoredShellState((prev) =>
        prev.playerPresentation === presentation ? prev : { ...prev, playerPresentation: presentation }
      );
    };

  const setLibraryTab = (tab: LibraryTab) =>
    setStoredShellState((prev) => (prev.libraryTab === tab ? prev : { ...prev, libraryTab: tab }));

  const setDetailsOpen = (value: boolean) =>
    setStoredShellState((prev) => (prev.detailsOpen === value ? prev : { ...prev, detailsOpen: value }));

  const openExternal = (station: Station | StationLite) => {
    openLinkOrFallback(toLite(station).url_resolved);
  };

  const addRecent = (station: Station | StationLite) => {
    const lite = toLite(station);
    rememberStations([lite]);
    setRecent((prev) => {
      const next = [lite, ...prev.filter((item) => item.stationuuid !== lite.stationuuid)];
      return next.slice(0, MAX_RECENT);
    });
  };

  const playStationInternal = async (
    station: Station | StationLite,
    options?: PlayStationInternalOptions
  ) => {
    const lite = toLite(station);
    rememberStations([lite]);
    const sourceId = options?.sourceId || queueRef.current.sourceId || null;

    // Quick-skip detection: if the user is bailing on a station within
    // 10 s of it starting (typical "nope, not this one" reaction),
    // record a skip signal for the OUTGOING station before we switch.
    // Previously this only fired through the explicit Next button, so
    // tapping a different station from the search list / library /
    // globe never trained the recommender to demote the rejected one.
    const outgoing = player.current;
    const startedAt = currentStartedAtRef.current;
    if (
      outgoing &&
      startedAt &&
      outgoing.stationuuid !== lite.stationuuid &&
      Date.now() - startedAt < 10_000
    ) {
      const outgoingMode = sessionModeFromSourceId(queueRef.current.sourceId);
      recordTasteForStation(outgoing, 'skip-before-10s', outgoingMode, -10);
      recordSessionEventForStation(outgoing, 'skip');
      reportProductEvent(
        'skip',
        {
          ...stationAnalyticsMeta(outgoing),
          mode: outgoingMode,
          sourceId: queueRef.current.sourceId || null,
          listenedMs: Date.now() - startedAt,
          trigger: 'switch'
        },
        {
          dedupeKey: `skip:${outgoing.stationuuid}:${startedAt}`
        }
      );
    }

    currentStartedStationIdRef.current = null;
    if (!lite.url_resolved) {
      recordPlaybackOutcomeForStation(lite, 'no-playable-candidate');
      reportProductEvent('stream_failure', {
        ...stationAnalyticsMeta(lite),
        failureKind: 'missing-stream',
        sourceId,
        mode: sessionModeFromSourceId(sourceId)
      });
      notify(t('toast.missingStream'));
      return false;
    }

    reportProductEvent(
      'play_attempt',
      {
        ...stationAnalyticsMeta(lite),
        sourceId,
        mode: sessionModeFromSourceId(sourceId),
        queueCount: options?.playlist?.length || queueRef.current.items.length || 1
      },
      {
        dedupeKey: `play_attempt:${lite.stationuuid}:${Date.now()}`
      }
    );

    await ensurePlaybackRuntimeMounted();
    const runtimePlayer = playbackRuntimeRef.current.player;
    const result = await runtimePlayer.playStation(lite);
    if (!result.ok) {
      if (result.error === 'playback superseded') {
        return false;
      }
      const outcome = normalizePlaybackOutcome(result.error);
      recordPlaybackOutcomeForStation(lite, outcome);
      reportProductEvent(
        'stream_failure',
        {
          ...stationAnalyticsMeta(lite),
          failureKind: outcome,
          sourceId,
          mode: sessionModeFromSourceId(sourceId)
        },
        {
          dedupeKey: `stream_failure:${lite.stationuuid}:${outcome}:${Date.now()}`
        }
      );
      if (!options?.suppressErrorToast) {
        notify(resolvePlaybackToastMessage(result.error));
      }
      return false;
    }

    const playedStation = result.station ?? lite;
    const playStartedAt = Date.now();
    recordPlaybackOutcomeForStation(playedStation, 'success', {
      activeCandidate: result.activeCandidate ?? null,
      startupMs: result.startupMs ?? null
    });
    rememberStations([playedStation]);
    const nextQueue =
      options?.queueSnapshot ?? resolveQueueSnapshot(playedStation, options, queueRef.current);
    reportProductEvent(
      'play_success',
      {
        ...stationAnalyticsMeta(playedStation),
        sourceId: nextQueue.sourceId || sourceId,
        mode: sessionModeFromSourceId(nextQueue.sourceId || sourceId),
        startupMs: result.startupMs ?? null,
        queueCount: nextQueue.items.length,
        transportMode: result.activeCandidate?.mode || null,
        transportFallback: Boolean(result.activeCandidate?.isFallback)
      },
      {
        dedupeKey: `play_success:${playedStation.stationuuid}:${Date.now()}`
      }
    );
    updateQueue(nextQueue);
    setStoredShellState((prev) => ({
      ...prev,
      playerPresentation: prev.playerPresentation === 'expanded' ? 'expanded' : 'bar',
      detailsOpen: false
    }));

    if (options?.addToRecent !== false) {
      addRecent(playedStation);
    }
    recordBehaviorForStation(playedStation, 'play');
    if (playedStation.stationuuid) {
      setStationExposure((prev) => recordStationPlayed(prev, playedStation.stationuuid));
    }
    currentStartedAtRef.current = playStartedAt;
    currentStartedStationIdRef.current = playedStation.stationuuid;
    listened30sRef.current = null;
    recordSessionEventForStation(
      playedStation,
      'play-started',
      nextQueue.sourceId || sourceId
    );
    recordSessionEventForStation(
      playedStation,
      'play-success',
      nextQueue.sourceId || sourceId
    );
    recordTasteForStation(
      playedStation,
      'play-started',
      sessionModeFromSourceId(nextQueue.sourceId)
    );

    pushPlaybackHistory(
      playedStation,
      options?.recordHistory !== false,
      options?.historyCursorTarget
    );
    return true;
  };

  const playStation = (station: Station | StationLite, options?: PlayStationOptions) =>
    void playStationInternal(station, options);

  const playStationQueue = (
    stations: Array<Station | StationLite>,
    options?: Pick<PlayStationOptions, 'sourceId' | 'sourceLabel'>
  ) =>
    void (async () => {
      const items = normalizeStations(stations);
      if (!items.length) {
        notify(t('toast.noPlayable'));
        return;
      }
      rememberStations(items);
      const sourceId = options?.sourceId ?? 'station-queue';
      const sourceLabel = getQueueSourceLabel(sourceId, options?.sourceLabel, items, t);
      const maxAttempts = Math.min(items.length, 20);
      items.slice(0, maxAttempts).forEach((station) => {
        recordSessionEventForStation(station, 'queued', sourceId);
      });

      for (let index = 0; index < maxAttempts; index += 1) {
        const station = items[index];
        if (!station) continue;
        const queueSnapshot: QueueSnapshot = {
          items,
          currentIndex: index,
          sourceId,
          sourceLabel
        };
        const ok = await playStationInternal(station, {
          sourceId,
          sourceLabel,
          playlist: items,
          queueSnapshot,
          suppressErrorToast: true
        });
        if (ok) return;
      }

      notify(t('toast.noPlayable'));
    })();

  useEffect(() => {
    const failure = player.failure;
    if (player.status !== 'error' || !failure || failure.kind === 'superseded') return;

    const currentQueue = queueRef.current;
    const failedStation =
      player.current ||
      (currentQueue.currentIndex >= 0 ? currentQueue.items[currentQueue.currentIndex] : null);
    if (!failedStation || currentStartedStationIdRef.current !== failedStation.stationuuid) {
      return;
    }

    const signature = [
      failedStation.stationuuid,
      failure.kind,
      failure.message,
      currentQueue.sourceId || 'none',
      currentQueue.currentIndex
    ].join(':');
    if (runtimeFailureSignatureRef.current === signature) return;
    runtimeFailureSignatureRef.current = signature;

    // `superseded` is filtered out above; this is the real failure kind.
    const outcome: PlaybackOutcomeKind = failure.kind;
    recordPlaybackOutcomeForStation(failedStation, outcome);
    reportProductEvent(
      'stream_failure',
      {
        ...stationAnalyticsMeta(failedStation),
        failureKind: outcome,
        sourceId: currentQueue.sourceId || null,
        mode: sessionModeFromSourceId(currentQueue.sourceId)
      },
      {
        dedupeKey: `runtime_stream_failure:${failedStation.stationuuid}:${outcome}:${Date.now()}`
      }
    );

    // Owner decision — NEVER auto-switch the station on a runtime failure. A
    // stream that died after playback started, and that candidate-switch +
    // scheduleReconnect (both in useAudioPlayer) could not revive, leaves the
    // player in `error`. We deliberately do NOT advance the queue or jump to
    // another station: the current station stays selected (so any further
    // reconnect/manual retry targets the SAME station), and the user is shown
    // an "unavailable" notice and left to choose what to play next. The old
    // auto-skip-to-next loop lived here and is intentionally gone.
    notify(t('toast.streamUnavailable'));
  }, [player.current, player.failure, player.status]);

  useEffect(() => {
    const currentQueue = queueRef.current;
    if (currentQueue.sourceId !== 'personal-radio') return;
    if (currentQueue.currentIndex < 0 || !currentQueue.items.length) return;
    const remainingAfterCurrent = currentQueue.items.length - currentQueue.currentIndex - 1;
    if (remainingAfterCurrent > 4 || currentQueue.items.length >= MAX_QUEUE_ITEMS) return;

    const signature = [
      currentQueue.currentIndex,
      currentQueue.items.length,
      tasteProfile.lastUpdatedAt || 0,
      Object.keys(playabilityProfile.signals || {}).length,
      Object.keys(stationHealthProfile.signals || {}).length,
      radioSessionEvents[0]?.timestamp || 0
    ].join(':');
    if (personalRadioRefillSignatureRef.current === signature) return;
    personalRadioRefillSignatureRef.current = signature;

    const catalog = mergeUniqueStations(
      knownStations,
      currentQueue.items,
      favorites,
      recent,
      playbackHistoryEntries
    );
    if (!catalog.length) return;

    const generatedQueue = buildPersonalRadioQueue({
      catalog,
      favorites,
      recent,
      queuePreview: currentQueue.items.slice(currentQueue.currentIndex, currentQueue.currentIndex + 4),
      playbackHistory: playbackHistoryEntries,
      trackHistory,
      collections,
      followedStations,
      followedRegions,
      behaviorProfile,
      playabilityProfile,
      tasteProfile,
      healthProfile: stationHealthProfile,
      sessionEvents: radioSessionEvents,
      exposure: stationExposure,
      context: {
        mode: 'personal',
        currentStation: player.current,
        seed: Date.now(),
        limit: PERSONAL_RADIO_QUEUE_LIMIT
      }
    });
    const nextItems = refillPersonalRadioQueueItems({
      currentItems: currentQueue.items,
      currentIndex: currentQueue.currentIndex,
      candidates: generatedQueue.stations,
      tailSize: PERSONAL_RADIO_QUEUE_LIMIT,
      maxItems: MAX_QUEUE_ITEMS
    });
    if (nextItems.length <= currentQueue.items.length) return;

    updateQueue({
      ...currentQueue,
      items: nextItems
    });
  }, [
    behaviorProfile,
    collections,
    favorites,
    followedRegions,
    followedStations,
    knownStations,
    playbackHistoryEntries,
    playabilityProfile,
    player.current,
    radioSessionEvents,
    recent,
    stationHealthProfile,
    tasteProfile,
    trackHistory
  ]);

  const isFavorite = (stationId: string) =>
    favorites.some((item) => item.stationuuid === stationId);

  const toggleFavorite = (station: Station | StationLite) => {
    const lite = toLite(station);
    rememberStations([lite]);
    const alreadyFavorite = favorites.some((item) => item.stationuuid === lite.stationuuid);
    const nextFavorites = alreadyFavorite
      ? favorites.filter((item) => item.stationuuid !== lite.stationuuid)
      : [lite, ...favorites];
    const favoriteMode = sessionModeFromSourceId(queueRef.current.sourceId);
    const nextTasteProfile = recordTasteSignal(
      tasteProfile,
      lite,
      alreadyFavorite ? 'unliked' : 'liked',
      { mode: favoriteMode }
    );
    setFavorites(nextFavorites);
    setTasteProfile(nextTasteProfile);
    if (!alreadyFavorite) {
      recordBehaviorForStation(lite, 'favorite');
      recordSessionEventForStation(lite, 'like');
    }
    reportProductEvent(
      'like',
      {
        ...stationAnalyticsMeta(lite),
        liked: !alreadyFavorite,
        mode: sessionModeFromSourceId(queueRef.current.sourceId),
        sourceId: queueRef.current.sourceId || null
      },
      {
        dedupeKey: `like:${lite.stationuuid}:${!alreadyFavorite}:${Date.now()}`
      }
    );
    syncCloudLibraryImmediately({
      favorites: nextFavorites,
      recent: recent.slice(0, MAX_RECENT),
      trackHistory: trackHistory.slice(0, MAX_TRACK_HISTORY),
      collections,
      followedStations,
      followedRegions,
      alerts,
      tasteProfile: nextTasteProfile
    });
  };

  const playPrevious = () => {
    const playFromQueue = () => {
      const currentQueue = queueRef.current;
      if (currentQueue.currentIndex <= 0 || currentQueue.items.length <= 1) {
        return false;
      }
      const previousIndex = currentQueue.currentIndex - 1;
      const previousStation = currentQueue.items[previousIndex];
      if (!previousStation) return false;
      const queueSnapshot: QueueSnapshot = {
        ...currentQueue,
        currentIndex: previousIndex
      };
      void playStationInternal(previousStation, {
        recordHistory: false,
        addToRecent: false,
        queueSnapshot
      });
      return true;
    };

    if (historyCursorRef.current <= 0) {
      playFromQueue();
      return;
    }
    const previousIndex = historyCursorRef.current - 1;
    const previousStation = historyEntriesRef.current[previousIndex];
    if (!previousStation) {
      playFromQueue();
      return;
    }

    const currentQueue = queueRef.current;
    const queueIndex = currentQueue.items.findIndex(
      (item) => item.stationuuid === previousStation.stationuuid
    );
    const queueSnapshot =
      queueIndex >= 0
        ? {
            ...currentQueue,
            currentIndex: queueIndex
          }
        : resolveQueueSnapshot(previousStation, {
            sourceId: 'history',
            sourceLabel: t('radio.history')
          });

    void playStationInternal(previousStation, {
      recordHistory: false,
      addToRecent: false,
      queueSnapshot,
      historyCursorTarget: previousIndex
    });
  };

  const playNext = () => {
    const currentStation = player.current;
    const startedAt = currentStartedAtRef.current;
    if (currentStation && startedAt && Date.now() - startedAt < 10_000) {
      recordTasteForStation(currentStation, 'skip-before-10s');
      recordSessionEventForStation(currentStation, 'skip');
      reportProductEvent(
        'skip',
        {
          ...stationAnalyticsMeta(currentStation),
          mode: sessionModeFromSourceId(queueRef.current.sourceId),
          sourceId: queueRef.current.sourceId || null,
          listenedMs: Date.now() - startedAt
        },
        {
          dedupeKey: `skip:${currentStation.stationuuid}:${startedAt}`
        }
      );
    }

    const playFromQueue = async () => {
      const currentQueue = queueRef.current;
      if (
        currentQueue.items.length <= 0 ||
        currentQueue.currentIndex < 0 ||
        currentQueue.currentIndex >= currentQueue.items.length - 1
      ) {
        return false;
      }

      for (
        let nextIndex = currentQueue.currentIndex + 1;
        nextIndex < currentQueue.items.length;
        nextIndex += 1
      ) {
        const nextStation = currentQueue.items[nextIndex];
        if (!nextStation) continue;
        const ok = await playStationInternal(nextStation, {
          queueSnapshot: {
            ...currentQueue,
            currentIndex: nextIndex
          },
          suppressErrorToast: true
        });
        if (ok) return true;
      }

      return false;
    };

    // Owner decision — NEVER jump to a random station. At the end of the queue
    // (or on a lone live station) playNext is a no-op beyond a notice; the old
    // playFromGlobalPool random-fallback is intentionally gone.
    void (async () => {
      if (await playFromQueue()) return;
      notify(t('toast.noPlayable'));
    })();
  };

  const playLast = () => {
    const currentQueue = queueRef.current;
    const latestStation =
      historyEntriesRef.current[historyEntriesRef.current.length - 1] ??
      recent[0] ??
      currentQueue.items[0] ??
      knownStations[0];

    if (!latestStation) return;

    const queueIndex = currentQueue.items.findIndex(
      (item) => item.stationuuid === latestStation.stationuuid
    );
    const queueSnapshot =
      queueIndex >= 0
        ? {
            ...currentQueue,
            currentIndex: queueIndex
          }
        : resolveQueueSnapshot(latestStation, {
            sourceId: currentQueue.sourceId ?? 'resume',
            sourceLabel: currentQueue.sourceLabel ?? t('radio.resume')
          });

    void playStationInternal(latestStation, {
      queueSnapshot
    });
  };

  // FIX 4: keep the mediaSession transport callbacks behind a ref so the
  // handler-registration effect below depends only on the queue's skippability,
  // not on `player` identity / now-playing metadata. Without this the handlers
  // re-registered on every metadata tick (each `nowPlaying` update) and on every
  // player snapshot.
  const mediaSessionActionsRef = useRef({
    playNext,
    playPrevious,
    toggle: player.toggle,
    stop: player.stop
  });
  mediaSessionActionsRef.current = {
    playNext,
    playPrevious,
    toggle: player.toggle,
    stop: player.stop
  };

  // Metadata + playback state — cheap to re-run on every now-playing/isPlaying
  // change; sets no action handlers, so it never causes handler churn.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const station = player.current;
    if (!station) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
      return;
    }

    const artworkUrl = getProxiedAssetUrl(station.stationArtwork || station.favicon);
    const artwork = artworkUrl
      ? [
          {
            src: artworkUrl,
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      : undefined;

    const title = nowPlaying || station.name;
    const artist = nowPlaying ? station.name : station.country || 'Live Radio';

    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album: station.state || '',
      artwork
    });
    navigator.mediaSession.playbackState = player.isPlaying ? 'playing' : 'paused';
  }, [player.current, player.isPlaying, nowPlaying]);

  // Transport action handlers. FIX 2a: expose next/prev ONLY for a multi-item
  // queue — a lone live station has nowhere to skip, and leaving the handlers
  // bound let the OS lock-screen "next" trigger playNext (which used to random-
  // jump). play/pause/stop stay always-on. Re-runs only when the queue crosses
  // the single-item boundary, not on metadata ticks (FIX 4).
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play', () =>
      mediaSessionActionsRef.current.toggle()
    );
    navigator.mediaSession.setActionHandler('pause', () =>
      mediaSessionActionsRef.current.toggle()
    );
    navigator.mediaSession.setActionHandler('stop', () =>
      mediaSessionActionsRef.current.stop()
    );
    if (storedQueue.items.length > 1) {
      navigator.mediaSession.setActionHandler('nexttrack', () =>
        mediaSessionActionsRef.current.playNext()
      );
      navigator.mediaSession.setActionHandler('previoustrack', () =>
        mediaSessionActionsRef.current.playPrevious()
      );
    } else {
      navigator.mediaSession.setActionHandler('nexttrack', null);
      navigator.mediaSession.setActionHandler('previoustrack', null);
    }
  }, [storedQueue.items.length]);

  const openWebAppExternally = () => {
    let url = window.location.origin;
    if (player.current) {
      url += `?station=station_${player.current.stationuuid}`;
    }

    openLinkOrFallback(url, { try_instant_view: false });
  };

  const shareStation = async (station: Station | StationLite) => {
    const lite = toLite(station);
    const botName = import.meta.env.VITE_TG_BOT as string | undefined;
    const url = botName
      ? makeDeepLink(botName, lite.stationuuid)
      : `${window.location.origin}?station=station_${lite.stationuuid}`;
    const title = lite.name;
    const text = `Listen live: ${lite.name}`;

    // T_share_1: the ordered flow lives in shareStationLink (Telegram native
    // chat-picker first, then web share sheet, then clipboard). Deep link is
    // unchanged — makeDeepLink → t.me/<bot>?startapp=station_<uuid>.
    const outcome = await shareStationLink({ url, title, text });
    switch (outcome) {
      case 'telegram':
      case 'opened':
        notify(t('toast.shareOpened'));
        break;
      case 'web-share':
        notify(t('toast.shareDialog'));
        break;
      case 'clipboard':
        notify(t('toast.linkCopied'));
        break;
      default:
        notify(t('toast.shareFailed'));
    }
  };

  const rememberTrackHistory = (
    station: Station | StationLite,
    track: string,
    timestamp = Date.now()
  ) => {
    const lite = toLite(station);
    const trustedTrack = normalizeTrustedTrackTitle(track, lite);
    if (!trustedTrack) return false;
    const entry: TrackHistoryItem = {
      id: `${timestamp}-${lite.stationuuid}`,
      stationId: lite.stationuuid,
      stationName: lite.name,
      track: trustedTrack,
      timestamp
    };
    setTrackHistory((prev) => upsertTrustedTrackHistory(prev, entry, MAX_TRACK_HISTORY, timestamp));
    return true;
  };

  // «Треки» is a CURATED collection — ONLY tracks the user explicitly copies
  // (copyTrack → rememberTrackHistory) land there, so it stays a keep-list of
  // songs you actually liked. We deliberately do NOT auto-log every nowPlaying
  // track here — that filled the tab with «всякий шлак» (everything that played).

  useEffect(() => {
    const nextDigests = buildRadioDigests({
      recent,
      playbackHistory: playbackHistoryEntries,
      favorites,
      followedRegions,
      existingDigests: digests,
      notificationPreference,
      copy: {
        trackAvailable: () => ({ title: '', body: '' }),
        stationBackOnline: () => ({ title: '', body: '' }),
        regionActivity: () => ({ title: '', body: '' }),
        digest: (kind, stationNames) => ({
          title: t(`retention.${kind}Title`),
          body: t(`retention.${kind}Body`, {
            stations: stationNames.join(', ')
          })
        })
      }
    });
    if (!nextDigests.length) return;
    setDigests((prev) => upsertRadioDigests(prev, nextDigests));
  }, [
    digests,
    favorites,
    followedRegions,
    notificationPreference,
    playbackHistoryEntries,
    recent,
    t
  ]);

  useEffect(() => {
    const station = player.current;
    const trustedTrack = station ? normalizeTrustedTrackTitle(nowPlaying, station) : null;
    const nextAlerts = buildListenerAlerts({
      currentStation: station,
      trustedTrack,
      followedStations,
      followedRegions,
      knownStations,
      stationHealthProfile,
      existingAlerts: alerts,
      notificationPreference,
      copy: {
        trackAvailable: (stationName, track) => ({
          title: t('retention.trackAvailableTitle', { station: stationName }),
          body: t('retention.trackAvailableBody', { track })
        }),
        stationBackOnline: (stationName) => ({
          title: t('retention.stationBackOnlineTitle', { station: stationName }),
          body: t('retention.stationBackOnlineBody')
        }),
        regionActivity: (regionName, stationName) => ({
          title: t('retention.regionActivityTitle', { region: regionName }),
          body: t('retention.regionActivityBody', { station: stationName })
        }),
        digest: () => ({ title: '', body: '' })
      }
    });
    if (!nextAlerts.length) return;
    setAlerts((prev) => upsertListenerAlerts(prev, nextAlerts));
  }, [
    alerts,
    followedRegions,
    followedStations,
    knownStations,
    notificationPreference,
    nowPlaying,
    player.current,
    stationHealthProfile,
    t
  ]);

  const clearFavorites = () => {
    setFavorites([]);
    syncCloudLibraryImmediately({
      favorites: [],
      recent: recent.slice(0, MAX_RECENT),
      trackHistory: trackHistory.slice(0, MAX_TRACK_HISTORY),
      collections,
      followedStations,
      followedRegions,
      alerts,
      tasteProfile
    });
  };
  const clearRecent = () => setRecent([]);
  const clearTrackHistory = () => setTrackHistory([]);
  const removeTrackHistoryItem = (trackId: string) =>
    setTrackHistory((items) => items.filter((item) => item.id !== trackId));
  const createCollection = (name: string) => {
    const normalized = name.trim();
    if (!normalized) return;
    const now = Date.now();
    setCollections((prev) => [
      {
        id: `collection-${now}-${Math.random().toString(36).slice(2, 8)}`,
        name: normalized.slice(0, 48),
        description: null,
        stationIds: [],
        isPublic: false,
        updatedAt: now,
        createdAt: now,
        pinned: false
      },
      ...prev
    ]);
    setLibraryTab('collections');
  };
  const saveQueueAsCollection = (name: string) => {
    const queueStations = queueRef.current.items;
    const now = Date.now();
    const collection = buildQueueCollection(name, queueStations, {
      id: `collection-${now}-${Math.random().toString(36).slice(2, 8)}`,
      now
    });
    if (!collection) return;
    // CRITICAL: cache every queue station so the new playlist can resolve them
    // via the stationMap (knownStations = Object.values(stationCache)). The
    // queue holds StationLite that may never have entered the cache — without
    // this the playlist would render dangling ids. Same path as
    // addStationToCollection. Pure data-op: playback is NOT touched
    // (never-auto-switch — the queue keeps playing as it was).
    rememberStations(queueStations);
    setCollections((prev) => [collection, ...prev]);
    setLibraryTab('collections');
  };
  const addStationToNewCollection = (name: string, station: Station | StationLite) => {
    const normalized = name.trim().slice(0, 48);
    if (!normalized) return;
    const lite = toLite(station);
    const now = Date.now();
    rememberStations([lite]);
    setCollections((prev) => [
      {
        id: `collection-${now}-${Math.random().toString(36).slice(2, 8)}`,
        name: normalized,
        description: null,
        stationIds: [lite.stationuuid],
        isPublic: false,
        updatedAt: now,
        createdAt: now,
        pinned: false
      },
      ...prev
    ]);
    recordBehaviorForStation(lite, 'collection');
  };
  const deleteCollection = (collectionId: string) => {
    // Plain filter via setCollections — the same channel every other collection
    // mutator uses, so the cloud push effect (full-replace) propagates the
    // removal. The one-time hydration union-merge already ran before this, so a
    // deleted playlist does not resurrect in-session. (No tombstones: a stale
    // copy on a DIFFERENT device can still re-add it on its next union-merge —
    // a pre-existing cross-device limitation shared by favorites etc.)
    setCollections((prev) => prev.filter((collection) => collection.id !== collectionId));
  };
  const toggleCollectionPinned = (collectionId: string) => {
    setCollections((prev) =>
      prev.map((collection) =>
        collection.id !== collectionId
          ? collection
          : {
              ...collection,
              pinned: !collection.pinned,
              updatedAt: Date.now()
            }
      )
    );
  };

  const isStationHiddenFromRecommendations = (stationId: string) =>
    isStationHiddenByTaste(tasteProfile, stationId);

  const hideStationFromRecommendations = (station: Station | StationLite) => {
    const lite = toLite(station);
    const mode = sessionModeFromSourceId(queueRef.current.sourceId);
    rememberStations([lite]);
    setTasteProfile((prev) => hideStationFromTasteProfile(prev, lite));
    recordTasteForStation(lite, 'skip-before-10s', mode, -12);
    recordSessionEventForStation(lite, 'hide');
    reportProductEvent(
      'station_hidden',
      {
        ...stationAnalyticsMeta(lite),
        mode,
        hidden: true
      },
      {
        dedupeKey: `station_hidden:${lite.stationuuid}:${Date.now()}`
      }
    );
    notify(t('toast.stationHidden', { station: lite.name }));
  };

  const unhideStationFromRecommendations = (station: Station | StationLite) => {
    const lite = toLite(station);
    const mode = sessionModeFromSourceId(queueRef.current.sourceId);
    rememberStations([lite]);
    setTasteProfile((prev) => unhideStationFromTasteProfile(prev, lite));
    reportProductEvent(
      'station_hidden',
      {
        ...stationAnalyticsMeta(lite),
        mode,
        hidden: false
      },
      {
        dedupeKey: `station_unhidden:${lite.stationuuid}:${Date.now()}`
      }
    );
    notify(t('toast.stationUnhidden', { station: lite.name }));
  };
  const renameCollection = (collectionId: string, name: string) => {
    const normalized = name.trim().slice(0, 48);
    if (!normalized) return;
    setCollections((prev) =>
      prev.map((collection) =>
        collection.id !== collectionId || collection.name === normalized
          ? collection
          : {
              ...collection,
              name: normalized,
              updatedAt: Date.now()
            }
      )
    );
  };
  const moveStationInCollection = (
    collectionId: string,
    stationId: string,
    direction: -1 | 1
  ) => {
    setCollections((prev) =>
      prev.map((collection) => {
        if (collection.id !== collectionId) return collection;
        const index = collection.stationIds.indexOf(stationId);
        const nextIndex = index + direction;
        if (index < 0 || nextIndex < 0 || nextIndex >= collection.stationIds.length) {
          return collection;
        }
        const stationIds = [...collection.stationIds];
        const [moved] = stationIds.splice(index, 1);
        stationIds.splice(nextIndex, 0, moved);
        return {
          ...collection,
          stationIds,
          updatedAt: Date.now()
        };
      })
    );
  };
  const addStationToCollection = (collectionId: string, station: Station | StationLite) => {
    const lite = toLite(station);
    rememberStations([lite]);
    setCollections((prev) =>
      prev.map((collection) =>
        collection.id !== collectionId || collection.stationIds.includes(lite.stationuuid)
          ? collection
          : {
              ...collection,
              stationIds: [lite.stationuuid, ...collection.stationIds].slice(0, 128),
              updatedAt: Date.now()
            }
      )
    );
    recordBehaviorForStation(lite, 'collection');
  };
  const removeStationFromCollection = (collectionId: string, stationId: string) => {
    setCollections((prev) =>
      prev.map((collection) =>
        collection.id !== collectionId
          ? collection
          : {
              ...collection,
              stationIds: collection.stationIds.filter((item) => item !== stationId),
              updatedAt: Date.now()
            }
      )
    );
  };
  const toggleFollowStation = (station: Station | StationLite) => {
    const lite = toLite(station);
    rememberStations([lite]);
    const alreadyFollowed = followedStations.some((item) => item.stationId === lite.stationuuid);
    setFollowedStations((prev) => {
      if (prev.some((item) => item.stationId === lite.stationuuid)) {
        return prev.filter((item) => item.stationId !== lite.stationuuid);
      }
      return [
        {
          stationId: lite.stationuuid,
          stationName: lite.name,
          country: lite.country || '',
          createdAt: Date.now(),
          pinned: false,
          alerts: ['back-online', 'track']
        },
        ...prev
      ];
    });
    if (!alreadyFollowed) {
      recordBehaviorForStation(lite, 'follow');
    }
  };
  const toggleFollowRegion = (region: { id: string; label: string; scope: 'country' | 'area' }) => {
    setFollowedRegions((prev) => {
      if (prev.some((item) => item.id === region.id)) {
        return prev.filter((item) => item.id !== region.id);
      }
      return [
        {
          ...region,
          createdAt: Date.now(),
          pinned: false
        },
        ...prev
      ];
    });
  };
  const markAlertRead = (alertId: string) => {
    setAlerts((prev) =>
      prev.map((alert) =>
        alert.id === alertId && alert.readAt === null
          ? {
              ...alert,
              readAt: Date.now()
            }
          : alert
      )
    );
  };
  const markDigestRead = (digestId: string) => {
    setDigests((prev) =>
      prev.map((digest) =>
        digest.id === digestId && digest.readAt === null
          ? {
              ...digest,
              readAt: Date.now()
            }
          : digest
      )
    );
  };
  const updateNotificationPreference = (next: Partial<NotificationPreference>) => {
    setNotificationPreference((prev) => ({
      ...prev,
      ...next,
      version: 1,
      updatedAt: Date.now()
    }));
  };
  const clearCache = () => {
    setStoredLibraryState((prev) => ({
      ...prev,
      stationCache: {}
    }));
    setTransientHomeState((prev) => ({
      ...prev,
      lastBuiltAt: null,
      snapshot: null
    }));
    setStoredShellState((prev) => ({
      ...prev,
      searchDraft: ''
    }));
    try {
      window.localStorage.removeItem('radio:last-known-tracks:v2');
    } catch {
      // ignore storage failures
    }
    notify(t('toast.cacheCleared'));
  };

  const copyTrack = async () => {
    const station = player.current;
    const trustedTrack = normalizeTrustedTrackTitle(nowPlaying, station);
    if (!station || !trustedTrack) {
      notify(t('toast.noTrackInfo'));
      return;
    }
    try {
      await navigator.clipboard.writeText(trustedTrack);
      rememberTrackHistory(station, trustedTrack);
      recordBehaviorForStation(station, 'track-copy');
      notify(t('toast.trackCopied'));
    } catch {
      notify(t('toast.copyFailed'));
    }
  };

  const queue = useMemo<QueueState>(
    () => ({
      ...storedQueue,
      playAtIndex: (index) => {
        const target = queueRef.current.items[index];
        if (!target) return;
        void playStationInternal(target, {
          queueSnapshot: {
            ...queueRef.current,
            currentIndex: index
          }
        });
      },
      removeAtIndex: (index) => {
        const currentQueue = queueRef.current;
        const target = currentQueue.items[index];
        if (!target) return;

        recordSessionEventForStation(target, 'hide', currentQueue.sourceId);
        reportProductEvent(
          'queue_remove',
          {
            sourceId: currentQueue.sourceId || null,
            queueCount: currentQueue.items.length,
            index,
            activeIndex: currentQueue.currentIndex,
            removingCurrent: index === currentQueue.currentIndex
          },
          {
            dedupeKey: `queue_remove:${target.stationuuid}:${index}:${Date.now()}`
          }
        );

        const nextItems = currentQueue.items.filter((_, itemIndex) => itemIndex !== index);
        if (!nextItems.length) {
          updateQueue({
            ...currentQueue,
            items: [],
            currentIndex: -1
          });
          if (player.current?.stationuuid === target.stationuuid) {
            player.stop();
          }
          return;
        }

        if (index === currentQueue.currentIndex) {
          const nextIndex = Math.min(index, nextItems.length - 1);
          const nextStation = nextItems[nextIndex];
          if (!nextStation) return;
          const nextQueue: QueueSnapshot = {
            ...currentQueue,
            items: nextItems,
            currentIndex: nextIndex
          };
          updateQueue(nextQueue);
          void playStationInternal(nextStation, {
            recordHistory: false,
            addToRecent: false,
            queueSnapshot: nextQueue
          });
          return;
        }

        updateQueue({
          ...currentQueue,
          items: nextItems,
          currentIndex:
            index < currentQueue.currentIndex
              ? Math.max(0, currentQueue.currentIndex - 1)
            : currentQueue.currentIndex
        });
      },
      moveAtIndex: (index, direction) => {
        const currentQueue = queueRef.current;
        const targetIndex = index + direction;
        if (
          index < 0 ||
          targetIndex < 0 ||
          index >= currentQueue.items.length ||
          targetIndex >= currentQueue.items.length ||
          index === currentQueue.currentIndex ||
          targetIndex === currentQueue.currentIndex
        ) {
          return;
        }

        const nextItems = [...currentQueue.items];
        const [target] = nextItems.splice(index, 1);
        if (!target) return;
        nextItems.splice(targetIndex, 0, target);
        updateQueue({
          ...currentQueue,
          items: nextItems
        });
        reportProductEvent(
          'queue_reorder',
          {
            sourceId: currentQueue.sourceId || null,
            queueCount: currentQueue.items.length,
            fromIndex: index,
            toIndex: targetIndex,
            activeIndex: currentQueue.currentIndex
          },
          {
            dedupeKey: `queue_reorder:${target.stationuuid}:${index}:${targetIndex}:${Date.now()}`
          }
        );
      },
      shuffleQueue: () => {
        const currentQueue = queueRef.current;
        // Nothing to shuffle for a 0/1-item queue (the chip is disabled there
        // too — this is the belt-and-braces guard).
        if (currentQueue.items.length <= 1) return;
        // Reorder ONLY the upcoming items: reshuffleQueueSnapshot pins the
        // playing item at its current index, so playback is untouched
        // (never-auto-switch, PR #86). Persist via updateQueue ONLY — NO play*
        // call here, so the audio element, recent log and play_attempt analytics
        // are never touched. sourceId/sourceLabel are carried through.
        updateQueue(reshuffleQueueSnapshot(currentQueue));
        reportProductEvent(
          'queue_shuffle',
          {
            sourceId: currentQueue.sourceId || null,
            queueCount: currentQueue.items.length,
            activeIndex: currentQueue.currentIndex
          },
          {
            dedupeKey: `queue_shuffle:${currentQueue.sourceId || 'none'}:${Date.now()}`
          }
        );
        // Always give feedback — even when a tiny queue can only reproduce the
        // same order. The Toast is role=status aria-live=polite, so this single
        // call is both the visible toast AND the screen-reader announcement.
        notify(t('library.shuffleQueueAnnounce'));
      },
      clearUpcoming: () => {
        const currentQueue = queueRef.current;
        if (!currentQueue.items.length) return;
        if (currentQueue.currentIndex < 0) {
          updateQueue({
            ...currentQueue,
            items: [],
            currentIndex: -1
          });
          reportProductEvent(
            'queue_clear_upcoming',
            {
              sourceId: currentQueue.sourceId || null,
              queueCount: currentQueue.items.length,
              activeIndex: currentQueue.currentIndex,
              removedCount: currentQueue.items.length
            },
            {
              dedupeKey: `queue_clear_upcoming:none:${Date.now()}`
            }
          );
          return;
        }

        const nextItems = currentQueue.items.slice(0, currentQueue.currentIndex + 1);
        const removedCount = currentQueue.items.length - nextItems.length;
        if (removedCount <= 0) return;
        updateQueue({
          ...currentQueue,
          items: nextItems,
          currentIndex: Math.min(currentQueue.currentIndex, nextItems.length - 1)
        });
        reportProductEvent(
          'queue_clear_upcoming',
          {
            sourceId: currentQueue.sourceId || null,
            queueCount: currentQueue.items.length,
            activeIndex: currentQueue.currentIndex,
            removedCount
          },
          {
            dedupeKey: `queue_clear_upcoming:${currentQueue.sourceId || 'none'}:${Date.now()}`
          }
        );
      },
      clearQueue: () => {
        updateQueue({
          ...queueRef.current,
          items: [],
          currentIndex: -1
        });
        player.stop();
      },
      enqueue: (station) => {
        const currentQueue = queueRef.current;
        const [incoming] = normalizeStations([station]);
        if (!incoming) return false;
        // Append-only: if it's already queued, do nothing (never reorders nor
        // replays — the playing station and currentIndex are untouched, so this
        // can NEVER auto-switch playback, PR #86).
        if (currentQueue.items.some((item) => item.stationuuid === incoming.stationuuid)) {
          notify(t('feed.alreadyQueued'));
          return false;
        }
        // Keep the station resolvable later (queue items dehydrate to ids).
        rememberStations([incoming]);
        updateQueue({
          ...currentQueue,
          items: [...currentQueue.items, incoming],
          // currentIndex deliberately carried through unchanged.
          sourceId: currentQueue.sourceId ?? 'discovery-feed',
          sourceLabel: currentQueue.sourceLabel ?? null
        });
        notify(t('feed.addedToQueue'));
        reportProductEvent(
          'queue_enqueue',
          {
            sourceId: currentQueue.sourceId || null,
            queueCount: currentQueue.items.length + 1,
            activeIndex: currentQueue.currentIndex
          },
          {
            dedupeKey: `queue_enqueue:${incoming.stationuuid}:${Date.now()}`
          }
        );
        return true;
      }
    }),
    [player, storedQueue]
  );

  const winamp = useMemo<WinampState>(
    () => ({
      expanded: winampExpanded,
      setExpanded: (value) => {
        manualPresentationRef.current = true;
        if (fullscreenRetryRef.current !== null) {
          window.clearTimeout(fullscreenRetryRef.current);
          fullscreenRetryRef.current = null;
        }
        setStoredShellState((prev) => ({
          ...prev,
          playerPresentation: value ? 'expanded' : 'bar'
        }));
        if (!value) {
          return;
        }
        fullscreenRetryRef.current = window.setTimeout(() => {
          fullscreenRetryRef.current = null;
          if (!player.current) {
            return;
          }
          setStoredShellState((prev) =>
            prev.playerPresentation === 'expanded'
              ? prev
              : {
                  ...prev,
                  playerPresentation: 'expanded'
                }
          );
        }, 180);
      },
      compactMode: 'panel',
      setCompactMode: () => {},
      windowPositions: storedLayout.windowPositions,
      setWindowPosition: (id, position) =>
        setStoredLayout((prev) => {
          const currentPosition = prev.windowPositions[id];
          if (
            currentPosition &&
            Math.abs(currentPosition.x - position.x) < 1 &&
            Math.abs(currentPosition.y - position.y) < 1
          ) {
            return prev;
          }
          return {
            ...prev,
            windowPositions: {
              ...prev.windowPositions,
              [id]: {
                x: Math.round(position.x),
                y: Math.round(position.y)
              }
            }
          };
        }),
      windowVisibility: storedLayout.windowVisibility,
      setWindowVisibility: (id, visible) =>
        setStoredLayout((prev) =>
          prev.windowVisibility[id] === visible
            ? prev
            : {
                ...prev,
                windowVisibility: {
                  ...prev.windowVisibility,
                  [id]: visible
                }
              }
        ),
      resetLayout: () => setStoredLayout(DEFAULT_LAYOUT),
    }),
    [player.current, setStoredLayout, setStoredShellState, storedLayout, winampExpanded]
  );
  // — Sleep timer + headphone-unplug guard. A ref tracks the latest player so the
  // timer/guard callbacks always pause the live engine, not a stale snapshot. —
  const playerRef = useRef(player);
  useEffect(() => {
    playerRef.current = player;
  }, [player]);

  const pauseOnHeadphoneUnplug = storedAppState.pauseOnHeadphoneUnplug ?? true;
  const setPauseOnHeadphoneUnplug = useCallback(
    (value: boolean) => {
      setStoredAppState((prev) => ({ ...prev, pauseOnHeadphoneUnplug: value }));
    },
    [setStoredAppState]
  );

  const pausePlayback = useCallback(() => {
    playerRef.current.pause();
  }, []);

  const {
    active: sleepActive,
    minutes: sleepMinutes,
    remainingMs: sleepRemaining,
    start: startSleepTimer,
    cancel: cancelSleepTimer
  } = useSleepTimer(pausePlayback);
  // Expose the live sleep state to the listen-signal effects above (they run
  // earlier in the body, so they read it through this ref).
  sleepActiveRef.current = sleepActive;

  useOutputDeviceGuard({
    enabled: pauseOnHeadphoneUnplug,
    isPlaying: player.isPlaying,
    onUnplug: pausePlayback
  });

  const playbackValue = useMemo<PlaybackContextValue>(
    () => ({
      nowPlaying,
      nowPlayingStatus,
      nowPlayingState,
      player,
      queue,
      playStation,
      playStationQueue,
      playPrevious,
      playNext,
      playLast,
      copyTrack,
      openExternal,
      shareStation,
      sleepTimer: { active: sleepActive, minutes: sleepMinutes, remainingMs: sleepRemaining },
      startSleepTimer,
      cancelSleepTimer,
      pauseOnHeadphoneUnplug,
      setPauseOnHeadphoneUnplug
    }),
    [
      copyTrack,
      nowPlaying,
      nowPlayingState,
      nowPlayingStatus,
      openExternal,
      playLast,
      playNext,
      playPrevious,
      playStation,
      playStationQueue,
      player,
      queue,
      shareStation,
      sleepActive,
      sleepMinutes,
      sleepRemaining,
      startSleepTimer,
      cancelSleepTimer,
      pauseOnHeadphoneUnplug,
      setPauseOnHeadphoneUnplug
    ]
  );

  const libraryValue = useMemo<LibraryContextValue>(
    () => ({
      knownStations,
      favorites,
      recent,
      collections,
      followedStations,
      followedRegions,
      alerts,
      digests,
      notificationPreference,
      trackHistory,
      playbackHistory: playbackHistoryEntries,
      behaviorProfile,
      playabilityProfile,
      tasteProfile,
      stationHealthProfile,
      radioSessionEvents,
      stationExposure,
      recordStationsShown,
      toggleFavorite,
      isFavorite,
      hideStationFromRecommendations,
      unhideStationFromRecommendations,
      isStationHiddenFromRecommendations,
      reportStationBroken,
      clearFavorites,
      clearRecent,
      clearTrackHistory,
      removeTrackHistoryItem,
      createCollection,
      saveQueueAsCollection,
      addStationToNewCollection,
      deleteCollection,
      toggleCollectionPinned,
      renameCollection,
      moveStationInCollection,
      addStationToCollection,
      removeStationFromCollection,
      toggleFollowStation,
      toggleFollowRegion,
      markAlertRead,
      markDigestRead,
      updateNotificationPreference,
      rememberStations
    }),
    [
      addStationToCollection,
      alerts,
      behaviorProfile,
      clearFavorites,
      clearRecent,
      clearTrackHistory,
      removeTrackHistoryItem,
      collections,
      createCollection,
      saveQueueAsCollection,
      addStationToNewCollection,
      deleteCollection,
      digests,
      favorites,
      followedRegions,
      followedStations,
      hideStationFromRecommendations,
      isStationHiddenFromRecommendations,
      isFavorite,
      knownStations,
      markAlertRead,
      markDigestRead,
      moveStationInCollection,
      notificationPreference,
      playbackHistoryEntries,
      playabilityProfile,
      radioSessionEvents,
      stationExposure,
      recordStationsShown,
      renameCollection,
      tasteProfile,
      stationHealthProfile,
      recent,
      rememberStations,
      removeStationFromCollection,
      reportStationBroken,
      toggleFavorite,
      toggleCollectionPinned,
      toggleFollowRegion,
      toggleFollowStation,
      trackHistory,
      unhideStationFromRecommendations,
      updateNotificationPreference
    ]
  );

  const shellValue = useMemo<ShellContextValue>(
    () => ({
      toast,
      debugLogs,
      winamp,
      activeSection,
      setActiveSection,
      playerPresentation,
      setPlayerPresentation,
      libraryTab,
      setLibraryTab,
      detailsOpen,
      setDetailsOpen,
      homeState,
      setHomeSnapshot,
      refreshHomeSurface,
      feedSeed,
      rerollFeedSeed,
      searchDraft,
      setSearchDraft,
      clearSearchDraft,
      globeFocusRegionId,
      setGlobeFocusRegionId,
      skinLabOpen,
      setSkinLabOpen,
      openWebAppExternally,
      clearCache
    }),
    [
      activeSection,
      clearCache,
      clearSearchDraft,
      debugLogs,
      detailsOpen,
      feedSeed,
      globeFocusRegionId,
      homeState,
      libraryTab,
      rerollFeedSeed,
      openWebAppExternally,
      playerPresentation,
      refreshHomeSurface,
      searchDraft,
      skinLabOpen,
      setActiveSection,
      setDetailsOpen,
      setHomeSnapshot,
      setLibraryTab,
      setPlayerPresentation,
      setSearchDraft,
      toast,
      winamp
    ]
  );

  return (
    <PlaybackContext.Provider value={playbackValue}>
      <LibraryContext.Provider value={libraryValue}>
        <ShellContext.Provider value={shellValue}>
          {playbackRuntimeMounted ? (
            <Suspense fallback={null}>
              <PlaybackRuntimeLazy
                logDebug={logDebug}
                onSnapshot={handlePlaybackRuntimeSnapshot}
              />
            </Suspense>
          ) : null}
          {children}
        </ShellContext.Provider>
      </LibraryContext.Provider>
    </PlaybackContext.Provider>
  );
};

export const usePlayback = () => {
  const context = useContext(PlaybackContext);
  if (!context) {
    throw new Error('usePlayback must be used inside RadioProvider');
  }
  return context;
};

export const useLibrary = () => {
  const context = useContext(LibraryContext);
  if (!context) {
    throw new Error('useLibrary must be used inside RadioProvider');
  }
  return context;
};

export const useShell = () => {
  const context = useContext(ShellContext);
  if (!context) {
    throw new Error('useShell must be used inside RadioProvider');
  }
  return context;
};
