import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  ActiveWinampSkin,
  AppSection,
  LibraryTab,
  PlayerPresentation,
  Station,
  StationLite,
  WinampMuseumSkin,
  WinampSkinPreset,
  WinampSkinSource
} from '../types';
import { fetchStations, clearStationsCache } from '../lib/radioBrowser';
import { fetchNowPlaying, subscribeNowPlaying } from '../lib/nowPlaying';
import { useLocalStorage } from '../lib/useLocalStorage';
import { useAudioPlayer } from '../lib/useAudioPlayer';
import { toLite } from '../lib/stationUtils';
import { getStartParam, makeDeepLink, parseStationParam } from '../lib/telegram';
import { useLocale } from './LocaleContext';
import { getApiBase } from '../lib/apiBase';
import { applySkinPalette, applySkinThemeFromUrl } from '../lib/skinTheme';
import { fetchMuseumSkinByMd5 } from '../lib/skinMuseum';
import {
  DEFAULT_WINAMP_SKIN_ID,
  WINAMP_CLASSIC_PALETTE,
  WINAMP_SKIN_PRESETS,
  findPresetSkin
} from '../lib/winampSkins';

type TrackHistoryItem = {
  id: string;
  stationId: string;
  stationName: string;
  track: string;
  timestamp: number;
};

type StoredSkin = {
  source: WinampSkinSource;
  id?: string;
  md5?: string;
  name?: string;
};

type CompactMode = 'strip' | 'panel';
type ExpandedWindowId = 'main-window' | 'equalizer-window' | 'playlist-window';

type QueueSnapshot = {
  items: StationLite[];
  currentIndex: number;
  sourceId: string | null;
  sourceLabel: string | null;
};

type LayoutWindowVisibility = {
  'equalizer-window': boolean;
  'playlist-window': boolean;
};

type WindowPositions = Partial<Record<ExpandedWindowId, { x: number; y: number }>>;

type StoredWinampLayout = {
  version: 3;
  windowPositions: WindowPositions;
  windowVisibility: LayoutWindowVisibility;
};

type StoredShellState = {
  version: 1;
  activeSection: AppSection;
  playerPresentation: PlayerPresentation;
  libraryTab: LibraryTab;
  detailsOpen: boolean;
};

type QueueState = QueueSnapshot & {
  playAtIndex: (index: number) => void;
  removeAtIndex: (index: number) => void;
  clearQueue: () => void;
};

type WinampState = {
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
};

type PlayStationOptions = {
  playlist?: Array<Station | StationLite>;
  sourceId?: string;
  sourceLabel?: string;
};

type PlayStationInternalOptions = PlayStationOptions & {
  recordHistory?: boolean;
  addToRecent?: boolean;
  queueSnapshot?: QueueSnapshot;
  historyCursorTarget?: number;
  suppressErrorToast?: boolean;
};

type RadioContextValue = {
  stations: Station[];
  loading: boolean;
  error: string | null;
  favorites: StationLite[];
  recent: StationLite[];
  toast: string | null;
  nowPlaying: string | null;
  nowPlayingStatus: 'idle' | 'loading' | 'ready' | 'unavailable';
  trackHistory: TrackHistoryItem[];
  playbackHistory: StationLite[];
  player: ReturnType<typeof useAudioPlayer>;
  queue: QueueState;
  winamp: WinampState;
  activeSection: AppSection;
  setActiveSection: (section: AppSection) => void;
  playerPresentation: PlayerPresentation;
  setPlayerPresentation: (presentation: PlayerPresentation) => void;
  libraryTab: LibraryTab;
  setLibraryTab: (tab: LibraryTab) => void;
  detailsOpen: boolean;
  setDetailsOpen: (value: boolean) => void;
  playStation: (station: Station | StationLite, options?: PlayStationOptions) => void;
  playPrevious: () => void;
  playNext: () => void;
  playLast: () => void;
  copyTrack: () => void;
  toggleFavorite: (station: Station | StationLite) => void;
  isFavorite: (stationId: string) => boolean;
  openExternal: (station: Station | StationLite) => void;
  shareStation: (station: Station | StationLite) => void;
  openWebAppExternally: () => void;
  clearFavorites: () => void;
  clearRecent: () => void;
  clearCache: () => void;
  debugLogs: string[];
};

const RadioContext = createContext<RadioContextValue | null>(null);

const MAX_RECENT = 20;
const MAX_TRACK_HISTORY = 200;
const MAX_PLAYBACK_HISTORY = 80;
const MAX_QUEUE_ITEMS = 120;
const DEFAULT_STORED_SKIN: StoredSkin = {
  source: 'preset',
  id: DEFAULT_WINAMP_SKIN_ID
};
const DEFAULT_QUEUE: QueueSnapshot = {
  items: [],
  currentIndex: -1,
  sourceId: null,
  sourceLabel: null
};
const DEFAULT_LAYOUT: StoredWinampLayout = {
  version: 3,
  windowPositions: {},
  windowVisibility: {
    'equalizer-window': true,
    'playlist-window': true
  }
};
const DEFAULT_SHELL_STATE: StoredShellState = {
  version: 1,
  activeSection: 'home',
  playerPresentation: 'peek',
  libraryTab: 'favorites',
  detailsOpen: false
};

const toActiveSkin = (presetId: string | undefined): ActiveWinampSkin => {
  const preset = findPresetSkin(presetId);
  return {
    ...preset,
    source: 'preset'
  };
};

const toMuseumActiveSkin = (skin: WinampMuseumSkin): ActiveWinampSkin => ({
  ...skin,
  source: 'museum'
});

const mergeUniqueStations = (...groups: Array<Array<StationLite | null | undefined>>) => {
  const merged: StationLite[] = [];
  const seen = new Set<string>();

  groups.forEach((group) => {
    group.forEach((station) => {
      if (!station || seen.has(station.stationuuid)) return;
      seen.add(station.stationuuid);
      merged.push(station);
    });
  });

  return merged;
};

const normalizeStations = (stations: Array<Station | StationLite>) =>
  mergeUniqueStations(stations.map((station) => toLite(station))).slice(0, MAX_QUEUE_ITEMS);

const getQueueSourceLabel = (
  sourceId: string | null | undefined,
  sourceLabel: string | null | undefined,
  items: StationLite[],
  t: (key: string, vars?: Record<string, string | number>) => string
) => {
  if (sourceLabel?.trim()) return sourceLabel.trim();
  if (!sourceId) {
    return items.length === 1 ? items[0]?.name || t('radio.queueDefault') : t('radio.queueDefault');
  }
  if (sourceId === 'favorites') return t('radio.favorites');
  if (sourceId === 'recent') return t('radio.recent');
  if (sourceId === 'search-stations' || sourceId === 'discover-stations') return t('radio.searchResults');
  if (sourceId === 'search-links' || sourceId === 'discover-links') return t('radio.savedLinks');
  if (sourceId === 'search-links-recent' || sourceId === 'discover-links-recent') return t('radio.recentLinks');
  if (sourceId === 'explore-trending') return t('radio.trending');
  if (sourceId === 'explore-search') return t('radio.exploreSearch');
  if (sourceId === 'explore-pick') return t('radio.nearby');
  if (sourceId.startsWith('browse-')) return t('radio.discoverResults');
  if (sourceId.startsWith('station-')) return items[0]?.name || 'Single station';
  return sourceId
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const snapshotsEqual = (left: QueueSnapshot, right: QueueSnapshot) =>
  left.currentIndex === right.currentIndex &&
  left.sourceId === right.sourceId &&
  left.sourceLabel === right.sourceLabel &&
  left.items.length === right.items.length &&
  left.items.every((station, index) => station.stationuuid === right.items[index]?.stationuuid);

const clampQueueIndex = (items: StationLite[], index: number) => {
  if (!items.length) return -1;
  return Math.min(Math.max(index, 0), items.length - 1);
};

export const RadioProvider = ({ children }: { children: ReactNode }) => {
  const { t } = useLocale();
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [nowPlaying, setNowPlaying] = useState<string | null>(null);
  const [nowPlayingStatus, setNowPlayingStatus] = useState<
    'idle' | 'loading' | 'ready' | 'unavailable'
  >('idle');
  const [trackHistory, setTrackHistory] = useLocalStorage<TrackHistoryItem[]>(
    'radio:track-history',
    []
  );
  const [favorites, setFavorites] = useLocalStorage<StationLite[]>(
    'radio:favorites',
    []
  );
  const [recent, setRecent] = useLocalStorage<StationLite[]>(
    'radio:recent',
    []
  );
  const [storedQueue, setStoredQueue] = useLocalStorage<QueueSnapshot>(
    'radio:playback-queue:v2',
    DEFAULT_QUEUE
  );
  const [playbackHistoryEntries, setPlaybackHistoryEntries] = useLocalStorage<StationLite[]>(
    'radio:playback-history:v2',
    []
  );
  const [storedSkin, setStoredSkin] = useLocalStorage<StoredSkin>(
    'radio:winamp-skin',
    DEFAULT_STORED_SKIN
  );
  const [storedLayout, setStoredLayout] = useLocalStorage<StoredWinampLayout>(
    'radio:winamp-layout:v3',
    DEFAULT_LAYOUT
  );
  const [storedShellState, setStoredShellState] = useLocalStorage<StoredShellState>(
    'radio:shell-state:v1',
    DEFAULT_SHELL_STATE
  );

  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [activeSkin, setActiveSkin] = useState<ActiveWinampSkin>(
    toActiveSkin(storedSkin.id)
  );
  const [playbackHistoryCursor, setPlaybackHistoryCursor] = useState(() =>
    playbackHistoryEntries.length ? playbackHistoryEntries.length - 1 : -1
  );

  const logDebug = (msg: string) => {
    setDebugLogs((prev) =>
      [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 50)
    );
  };

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2000);
  };

  const player = useAudioPlayer({
    onEvent: logDebug
  });
  const startHandledRef = useRef(false);
  const queueRef = useRef<QueueSnapshot>(storedQueue);
  const historyEntriesRef = useRef<StationLite[]>(playbackHistoryEntries);
  const historyCursorRef = useRef(playbackHistoryCursor);
  const activeSection = storedShellState.activeSection;
  const playerPresentation = storedShellState.playerPresentation;
  const libraryTab = storedShellState.libraryTab;
  const detailsOpen = storedShellState.detailsOpen;
  const winampExpanded = playerPresentation === 'expanded';

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
    if (storedLayout?.version === 3) return;
    setStoredLayout({
      version: 3,
      windowPositions: storedLayout?.windowPositions ?? DEFAULT_LAYOUT.windowPositions,
      windowVisibility: storedLayout?.windowVisibility ?? DEFAULT_LAYOUT.windowVisibility
    });
  }, [setStoredLayout, storedLayout]);

  useEffect(() => {
    if (storedShellState?.version === 1) return;
    setStoredShellState(DEFAULT_SHELL_STATE);
  }, [setStoredShellState, storedShellState]);

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
      if (storedSkin.source === 'preset') {
        setActiveSkin(toActiveSkin(storedSkin.id));
        return;
      }

      if (storedSkin.source === 'museum' && storedSkin.md5) {
        try {
          const restoredSkin = await fetchMuseumSkinByMd5(storedSkin.md5);
          if (cancelled) return;
          if (restoredSkin) {
            setActiveSkin(toMuseumActiveSkin(restoredSkin));
            logDebug(`Skin restored: ${restoredSkin.name}`);
            return;
          }
        } catch (restoreError) {
          logDebug(
            `Skin restore failed: ${
              restoreError instanceof Error ? restoreError.message : String(restoreError)
            }`
          );
        }
      }

      if (cancelled) return;
      const fallback = toActiveSkin(DEFAULT_WINAMP_SKIN_ID);
      setActiveSkin(fallback);
      setStoredSkin({ source: 'preset', id: fallback.id });
      notify(t('toast.savedSkinFallback'));
    };

    void restoreSkin();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const applyTheme = async () => {
      const palette = activeSkin.palette
        ? applySkinPalette(activeSkin.palette)
        : await applySkinThemeFromUrl(activeSkin.url, WINAMP_CLASSIC_PALETTE);

      const tg = window.Telegram?.WebApp;
      tg?.setHeaderColor?.(palette.bg);
      tg?.setBackgroundColor?.(palette.bg);
      if (mounted) {
        logDebug(`Skin: ${activeSkin.name}`);
      }
    };

    applyTheme().catch(() => {
      applySkinPalette(WINAMP_CLASSIC_PALETTE);
    });

    return () => {
      mounted = false;
    };
  }, [activeSkin]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      let hasData = false;
      try {
        const quick = await fetchStations({ mode: 'fast' });
        if (mounted && quick.length) {
          setStations(quick);
          hasData = true;
          setLoading(false);
        }
        const full = await fetchStations({ mode: 'full' });
        if (mounted && full.length) {
          setStations(full);
          hasData = true;
        }
      } catch (loadError) {
        if (mounted && !hasData) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, []);

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
    if (!player.current && playerPresentation === 'expanded') {
      setStoredShellState((prev) => ({
        ...prev,
        playerPresentation: 'peek',
        detailsOpen: false
      }));
    }
  }, [player.current, playerPresentation, setStoredShellState]);

  const setActiveSection = (section: AppSection) =>
    setStoredShellState((prev) => (prev.activeSection === section ? prev : { ...prev, activeSection: section }));

  const setPlayerPresentation = (presentation: PlayerPresentation) =>
    setStoredShellState((prev) =>
      prev.playerPresentation === presentation ? prev : { ...prev, playerPresentation: presentation }
    );

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
    if (!lite.url_resolved) {
      notify(t('toast.missingStream'));
      return false;
    }

    const result = await player.playStation(lite);
    if (!result.ok) {
      if (result.error === 'playback superseded') {
        return false;
      }
      if (!options?.suppressErrorToast) {
        notify(result.error || t('toast.playbackFailed'));
      }
      return false;
    }

    const playedStation = result.station ?? lite;
    const nextQueue =
      options?.queueSnapshot ?? resolveQueueSnapshot(playedStation, options, queueRef.current);
    updateQueue(nextQueue);
    setStoredShellState((prev) => ({
      ...prev,
      playerPresentation: prev.playerPresentation === 'expanded' ? 'expanded' : 'bar',
      detailsOpen: false
    }));

    if (options?.addToRecent !== false) {
      addRecent(playedStation);
    }

    pushPlaybackHistory(
      playedStation,
      options?.recordHistory !== false,
      options?.historyCursorTarget
    );
    return true;
  };

  const playStation = (station: Station | StationLite, options?: PlayStationOptions) =>
    void playStationInternal(station, options);

  useEffect(() => {
    if (startHandledRef.current) return;
    if (!stations.length) return;

    const startParam = getStartParam();
    if (!startParam) {
      startHandledRef.current = true;
      return;
    }

    const stationId = parseStationParam(startParam);
    const station = stations.find((item) => item.stationuuid === stationId);
    if (station) {
      void playStationInternal(station, {
        sourceId: 'deep-link',
        sourceLabel: t('radio.deepLink')
      });
      startHandledRef.current = true;
      return;
    }

    startHandledRef.current = true;
  }, [stations]);

  useEffect(() => {
    const station = player.current;
    if (!station || !player.isPlaying) {
      setNowPlaying(null);
      setNowPlayingStatus('idle');
      return;
    }

    let active = true;
    let lastUpdate = 0;
    setNowPlayingStatus('loading');

    const applyTrack = (track: string | null) => {
      if (!active) return;
      if (track) {
        lastUpdate = Date.now();
        setNowPlaying(track);
        setNowPlayingStatus('ready');
      } else if (Date.now() - lastUpdate > 20000) {
        setNowPlaying(null);
        setNowPlayingStatus('unavailable');
      }
    };

    const unsubscribe = subscribeNowPlaying(station, applyTrack);

    const update = async () => {
      try {
        const track = await fetchNowPlaying(station, logDebug);
        if (track) {
          logDebug(`Metadata: ${track}`);
        } else if (Date.now() - lastUpdate > 20000) {
          logDebug(`Metadata: null (API: ${getApiBase() || 'default'})`);
        }
        applyTrack(track);
      } catch (metadataError) {
        logDebug(
          `Metadata Err: ${
            metadataError instanceof Error ? metadataError.message : String(metadataError)
          }`
        );
      }
    };

    void update();
    const interval = window.setInterval(update, 15000);
    const timeout = window.setTimeout(() => {
      if (!lastUpdate) {
        setNowPlayingStatus('unavailable');
      }
    }, 8000);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      unsubscribe?.();
    };
  }, [player.current?.stationuuid, player.isPlaying]);

  const isFavorite = (stationId: string) =>
    favorites.some((item) => item.stationuuid === stationId);

  const toggleFavorite = (station: Station | StationLite) => {
    const lite = toLite(station);
    setFavorites((prev) => {
      if (prev.some((item) => item.stationuuid === lite.stationuuid)) {
        return prev.filter((item) => item.stationuuid !== lite.stationuuid);
      }
      return [lite, ...prev];
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
      const globalPool = stations.map((station) => toLite(station));
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
      stations[0];

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

    const artwork = station.favicon
      ? [
          {
            src: station.favicon,
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

  const clearFavorites = () => setFavorites([]);
  const clearRecent = () => setRecent([]);
  const clearCache = () => {
    clearStationsCache();
    notify(t('toast.cacheCleared'));
  };

  const copyTrack = async () => {
    const station = player.current;
    if (!station || !nowPlaying) {
      notify(t('toast.noTrackInfo'));
      return;
    }
    try {
      await navigator.clipboard.writeText(nowPlaying);
      const entry: TrackHistoryItem = {
        id: `${Date.now()}-${station.stationuuid}`,
        stationId: station.stationuuid,
        stationName: station.name,
        track: nowPlaying,
        timestamp: Date.now()
      };
      setTrackHistory((prev) => [entry, ...prev].slice(0, MAX_TRACK_HISTORY));
      notify(t('toast.trackCopied'));
    } catch {
      notify(t('toast.copyFailed'));
    }
  };

  const setSkin = (skinId: string) => {
    const preset = findPresetSkin(skinId);
    setActiveSkin({ ...preset, source: 'preset' });
    setStoredSkin({ source: 'preset', id: preset.id });
    notify(t('toast.skinApplied', { name: preset.name }));
  };

  const selectSkin = (skin: WinampMuseumSkin) => {
    setActiveSkin(toMuseumActiveSkin(skin));
    setStoredSkin({
      source: 'museum',
      md5: skin.md5,
      name: skin.name
    });
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
      setExpanded: (value) =>
        setStoredShellState((prev) => ({
          ...prev,
          playerPresentation: value ? 'expanded' : 'bar'
        })),
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
      selectSkin
    }),
    [activeSkin, setStoredLayout, setStoredShellState, storedLayout, winampExpanded]
  );

  const value: RadioContextValue = {
    stations,
    loading,
    error,
    favorites,
    recent,
    toast,
    nowPlaying,
    nowPlayingStatus,
    trackHistory,
    playbackHistory: playbackHistoryEntries,
    player,
    queue,
    winamp,
    activeSection,
    setActiveSection,
    playerPresentation,
    setPlayerPresentation,
    libraryTab,
    setLibraryTab,
    detailsOpen,
    setDetailsOpen,
    playStation,
    playPrevious,
    playNext,
    playLast,
    copyTrack,
    toggleFavorite,
    isFavorite,
    openExternal,
    openWebAppExternally,
    shareStation,
    clearFavorites,
    clearRecent,
    clearCache,
    debugLogs
  };

  return <RadioContext.Provider value={value}>{children}</RadioContext.Provider>;
};

export const useRadio = () => {
  const context = useContext(RadioContext);
  if (!context) {
    throw new Error('useRadio must be used inside RadioProvider');
  }
  return context;
};
