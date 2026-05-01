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
  ActiveWinampSkin,
  AppSection,
  LibraryTab,
  PlayerPresentation,
  Station,
  StationLite,
  WinampMuseumSkin,
  WinampUploadedSkin
} from '../types';
import { toLite } from '../lib/stationUtils';
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
  DEFAULT_NOTIFICATION_PREFERENCE,
  buildListenerAlerts,
  buildRadioDigests,
  upsertListenerAlerts,
  upsertRadioDigests
} from '../lib/retention';
import type {
  TasteProfileV2,
  TasteSignalAction,
  TasteSessionMode
} from '../lib/tasteProfile';
import { makeDeepLink } from '../lib/telegram';
import { useLocale } from './LocaleContext';
import { useSession } from './SessionContext';
import { getProxiedAssetUrl } from '../lib/assetUrl';
import { usePersistentState } from '../lib/persistentState';
import {
  WINAMP_SKIN_PRESETS,
  findPresetSkin
} from '../lib/winampSkins';
import {
  DEFAULT_APP_STATE,
  DEFAULT_LAYOUT,
  DEFAULT_LIBRARY_STATE,
  DEFAULT_PLAYER_STATE,
  DEFAULT_SHELL_STATE,
  DEFAULT_WINAMP_SKIN_ID,
  MAX_PLAYBACK_HISTORY,
  MAX_RECENT,
  MAX_TRACK_HISTORY,
  WINAMP_CLASSIC_PALETTE,
  toActiveSkin,
  toMuseumActiveSkin
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
  StoredSkin,
  StoredWinampLayout,
  TrackHistoryItem,
  WinampState
} from './radio/types';
import { createPlaybackPlayerPlaceholder, type PlaybackRuntimeSnapshot } from './radio/playbackRuntimeBridge';
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
  const homeState = storedShellState.home;
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
  const storedQueue = storedPlayerState.queue;
  const storedSkin = storedPlayerState.skin;
  const storedLayout = storedPlayerState.layout;

  const setStoredShellState = (next: StoredShellState | ((prev: StoredShellState) => StoredShellState)) =>
    setStoredAppState((prev) => ({
      ...prev,
      shell: resolveUpdater(prev.shell, next)
    }));
  const setHomeSnapshot = (snapshot: HomeSurfaceFeed) =>
    setStoredShellState((prev) => ({
      ...prev,
      home: {
        ...prev.home,
        sessionSeed: snapshot.seed,
        lastBuiltAt: snapshot.builtAt,
        snapshot
      }
    }));
  const refreshHomeSurface = (seed = Date.now()) =>
    setStoredShellState((prev) => ({
      ...prev,
      home: {
        sessionSeed: seed,
        lastBuiltAt: null,
        snapshot: null
      }
    }));
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
    setStoredAppState((prev) => ({
      ...prev,
      behaviorProfile: resolveUpdater(prev.behaviorProfile || DEFAULT_APP_STATE.behaviorProfile, next)
    }));
  const setPlayabilityProfile = (
    next:
      | StationPlayabilityProfile
      | ((prev: StationPlayabilityProfile) => StationPlayabilityProfile)
  ) =>
    setStoredAppState((prev) => ({
      ...prev,
      playabilityProfile: resolveUpdater(
        prev.playabilityProfile || DEFAULT_PLAYABILITY_PROFILE,
        next
      )
    }));
  const setTasteProfile = (
    next: TasteProfileV2 | ((prev: TasteProfileV2) => TasteProfileV2)
  ) =>
    setStoredAppState((prev) => ({
      ...prev,
      tasteProfile: resolveUpdater(
        prev.tasteProfile || DEFAULT_TASTE_PROFILE_V2,
        next
      )
    }));
  const setStationHealthProfile = (
    next:
      | StationHealthProfile
      | ((prev: StationHealthProfile) => StationHealthProfile)
  ) =>
    setStoredAppState((prev) => ({
      ...prev,
      stationHealthProfile: resolveUpdater(
        prev.stationHealthProfile || DEFAULT_STATION_HEALTH_PROFILE,
        next
      )
    }));
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
  const setStoredSkin = (next: StoredSkin | ((prev: StoredSkin) => StoredSkin)) =>
    setStoredPlayerState((prev) => ({
      ...prev,
      skin: resolveUpdater(prev.skin, next)
    }));
  const setStoredLayout = (
    next: StoredWinampLayout | ((prev: StoredWinampLayout) => StoredWinampLayout)
  ) =>
    setStoredPlayerState((prev) => ({
      ...prev,
      layout: resolveUpdater(prev.layout, next)
    }));

  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [activeSkin, setActiveSkin] = useState<ActiveWinampSkin>(
    toActiveSkin(storedSkin.id)
  );
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
  const handlePlaybackRuntimeSnapshot = useCallback((snapshot: PlaybackRuntimeSnapshot) => {
    setPlaybackRuntime(snapshot);
  }, []);
  const player = playbackRuntime.player;
  const nowPlaying = playbackRuntime.nowPlaying;
  const nowPlayingStatus = playbackRuntime.nowPlayingStatus;
  const nowPlayingState = playbackRuntime.nowPlayingState;
  const fullscreenRetryRef = useRef<number | null>(null);
  const manualPresentationRef = useRef(false);
  const uploadedSkinUrlRef = useRef<string | null>(null);
  const queueRef = useRef<QueueSnapshot>(storedQueue);
  const historyEntriesRef = useRef<StationLite[]>(playbackHistoryEntries);
  const historyCursorRef = useRef(playbackHistoryCursor);
  const currentStartedAtRef = useRef<number | null>(null);
  const listened30sRef = useRef<string | null>(null);
  const activeSection = storedShellState.activeSection;
  const playerPresentation = storedShellState.playerPresentation;
  const libraryTab = storedShellState.libraryTab;
  const detailsOpen = storedShellState.detailsOpen;
  const winampExpanded = playerPresentation === 'expanded';

  useEffect(
    () => () => {
      if (uploadedSkinUrlRef.current) {
        URL.revokeObjectURL(uploadedSkinUrlRef.current);
      }
    },
    []
  );

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
    let cancelled = false;

    const restoreSkin = async () => {
      try {
        const runtime = await import('./radio/winampSkinRuntime');
        const result = await runtime.resolveStoredActiveSkin(storedSkin);
        if (cancelled) return;
        setActiveSkin(result.skin);
        if (result.restoredName) {
          logDebug(`Skin restored: ${result.restoredName}`);
        }
        if (result.usedFallback) {
          setStoredSkin({ source: 'preset', id: result.skin.id });
          notify(t('toast.savedSkinFallback'));
        }
      } catch (restoreError) {
        if (cancelled) return;
        logDebug(
          `Skin restore failed: ${
            restoreError instanceof Error ? restoreError.message : String(restoreError)
          }`
        );
        const fallback = toActiveSkin(DEFAULT_WINAMP_SKIN_ID);
        setActiveSkin(fallback);
        setStoredSkin({ source: 'preset', id: fallback.id });
        notify(t('toast.savedSkinFallback'));
      }
    };

    void restoreSkin();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const applyTheme = async () => {
      const runtime = await import('./radio/winampSkinRuntime');
      const palette = await runtime.applyActiveSkinTheme(activeSkin);

      const tg = window.Telegram?.WebApp;
      tg?.setHeaderColor?.(palette.bg);
      tg?.setBackgroundColor?.(palette.bg);
      if (mounted) {
        logDebug(`Skin: ${activeSkin.name}`);
      }
    };

    applyTheme().catch(() => {
      void import('./radio/winampSkinRuntime').then((runtime) => {
        runtime.applyClassicSkinTheme();
      });
    });

    return () => {
      mounted = false;
    };
  }, [activeSkin]);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    tg?.ready?.();
    tg?.expand?.();
    if (tg?.isActive) {
      logDebug(`WebApp active state: ${tg.isActive}`);
    }
  }, []);

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
      if (listened30sRef.current === stationId) return;
      listened30sRef.current = stationId;
      recordTasteForStation(station, 'listened-30s');
    }, 30_000);

    return () => window.clearTimeout(timer);
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
    const url = station.url_resolved;
    const tg = window.Telegram?.WebApp;
    if (tg?.openLink) {
      tg.openLink(url);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
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

    const result = await player.playStation(lite);
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
    currentStartedAtRef.current = playStartedAt;
    listened30sRef.current = null;
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

  const isFavorite = (stationId: string) =>
    favorites.some((item) => item.stationuuid === stationId);

  const toggleFavorite = (station: Station | StationLite) => {
    const lite = toLite(station);
    rememberStations([lite]);
    const alreadyFavorite = favorites.some((item) => item.stationuuid === lite.stationuuid);
    const nextFavorites = alreadyFavorite
      ? favorites.filter((item) => item.stationuuid !== lite.stationuuid)
      : [lite, ...favorites];
    setFavorites(nextFavorites);
    if (!alreadyFavorite) {
      recordBehaviorForStation(lite, 'favorite');
      recordTasteForStation(lite, 'liked');
    } else {
      recordTasteForStation(lite, 'unliked');
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
      tasteProfile
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

  const pickRandomStation = (pool: StationLite[]) => {
    if (!pool.length) return null;
    const currentId = player.current?.stationuuid;
    if (pool.length === 1) {
      return pool[0].stationuuid === currentId ? null : pool[0];
    }

    for (let i = 0; i < 6; i += 1) {
      const candidate = pool[Math.floor(Math.random() * pool.length)];
      if (!candidate || candidate.stationuuid === currentId) continue;
      return candidate;
    }

    return pool.find((item) => item.stationuuid !== currentId) ?? null;
  };

  const playNext = () => {
    const currentStation = player.current;
    const startedAt = currentStartedAtRef.current;
    if (currentStation && startedAt && Date.now() - startedAt < 10_000) {
      recordTasteForStation(currentStation, 'skip-before-10s');
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

    const playFromGlobalPool = async () => {
      const currentQueue = queueRef.current;
      const globalPool = knownStations;
      const pool = globalPool.length ? globalPool : currentQueue.items;
      if (!pool.length) return false;

      const tried = new Set<string>();
      const maxAttempts = Math.min(12, pool.length);
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const available = pool.filter((station) => !tried.has(station.stationuuid));
        const candidatePool = available.length ? available : pool;
        const randomStation = pickRandomStation(candidatePool);
        if (!randomStation) break;
        tried.add(randomStation.stationuuid);
        const ok = await playStationInternal(randomStation, {
          queueSnapshot: resolveQueueSnapshot(randomStation, {
            sourceId: 'all-stations',
            sourceLabel: t('radio.allStations')
          }),
          suppressErrorToast: true
        });
        if (ok) return true;
      }

      return false;
    };

    void (async () => {
      if (await playFromQueue()) return;
      if (await playFromGlobalPool()) return;
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

    navigator.mediaSession.setActionHandler('play', () => player.toggle());
    navigator.mediaSession.setActionHandler('pause', () => player.toggle());
    navigator.mediaSession.setActionHandler('stop', () => player.stop());
    navigator.mediaSession.setActionHandler('previoustrack', () => playPrevious());
    navigator.mediaSession.setActionHandler('nexttrack', () => playNext());
  }, [player, player.current, player.isPlaying, nowPlaying]);

  const openWebAppExternally = () => {
    let url = window.location.origin;
    if (player.current) {
      url += `?station=station_${player.current.stationuuid}`;
    }

    const tg = window.Telegram?.WebApp;
    if (tg?.openLink) {
      tg.openLink(url, { try_instant_view: false });
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const shareStation = async (station: Station | StationLite) => {
    const botName = import.meta.env.VITE_TG_BOT as string | undefined;
    const url = botName
      ? makeDeepLink(botName, station.stationuuid)
      : `${window.location.origin}?station=station_${station.stationuuid}`;
    const title = station.name;
    const text = `Listen live: ${station.name}`;

    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        notify(t('toast.shareDialog'));
        return;
      } catch {
        // ignore
      }
    }

    try {
      await navigator.clipboard.writeText(`${title} ${url}`);
      notify(t('toast.linkCopied'));
      return;
    } catch {
      // ignore
    }

    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
    const tg = window.Telegram?.WebApp;

    if (tg?.openLink) {
      tg.openLink(shareUrl);
      notify(t('toast.shareOpened'));
      return;
    }

    try {
      const popup = window.open(shareUrl, '_blank', 'noopener,noreferrer');
      if (popup) {
        notify(t('toast.shareOpened'));
        return;
      }
    } catch {
      // ignore
    }

    notify(t('toast.shareFailed'));
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

  useEffect(() => {
    const station = player.current;
    if (!station || !nowPlaying) return;
    rememberTrackHistory(station, nowPlaying);
  }, [nowPlaying, player.current]);

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
    setStoredShellState((prev) => ({
      ...prev,
      home: {
        ...prev.home,
        lastBuiltAt: null,
        snapshot: null
      },
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

  const setSkin = (skinId: string) => {
    if (uploadedSkinUrlRef.current) {
      URL.revokeObjectURL(uploadedSkinUrlRef.current);
      uploadedSkinUrlRef.current = null;
    }
    const preset = findPresetSkin(skinId);
    setActiveSkin({ ...preset, source: 'preset' });
    setStoredSkin({ source: 'preset', id: preset.id });
    notify(t('toast.skinApplied', { name: preset.name }));
  };

  const selectSkin = (skin: WinampMuseumSkin) => {
    if (uploadedSkinUrlRef.current) {
      URL.revokeObjectURL(uploadedSkinUrlRef.current);
      uploadedSkinUrlRef.current = null;
    }
    setActiveSkin(toMuseumActiveSkin(skin));
    setStoredSkin({
      source: 'museum',
      md5: skin.md5,
      name: skin.name
    });
    notify(t('toast.skinApplied', { name: skin.name }));
  };

  const selectUploadedSkin = (skin: WinampUploadedSkin) => {
    if (uploadedSkinUrlRef.current && uploadedSkinUrlRef.current !== skin.objectUrl) {
      URL.revokeObjectURL(uploadedSkinUrlRef.current);
    }
    uploadedSkinUrlRef.current = skin.objectUrl;
    setActiveSkin(skin);
    notify(t('toast.skinApplied', { name: skin.name }));
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
      clearQueue: () => {
        updateQueue({
          ...queueRef.current,
          items: [],
          currentIndex: -1
        });
        player.stop();
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
      availableSkins: WINAMP_SKIN_PRESETS,
      activeSkin,
      setSkin,
      selectSkin,
      selectUploadedSkin
    }),
    [activeSkin, player.current, setStoredLayout, setStoredShellState, storedLayout, winampExpanded]
  );
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
      shareStation
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
      shareStation
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
      toggleFavorite,
      isFavorite,
      hideStationFromRecommendations,
      unhideStationFromRecommendations,
      isStationHiddenFromRecommendations,
      reportStationBroken,
      clearFavorites,
      clearRecent,
      clearTrackHistory,
      createCollection,
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
      collections,
      createCollection,
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
      globeFocusRegionId,
      homeState,
      libraryTab,
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
          <Suspense fallback={null}>
            <PlaybackRuntimeLazy
              logDebug={logDebug}
              onSnapshot={handlePlaybackRuntimeSnapshot}
            />
          </Suspense>
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
