import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  ActiveWinampSkin,
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

type WinampState = {
  expanded: boolean;
  setExpanded: (value: boolean) => void;
  availableSkins: WinampSkinPreset[];
  activeSkin: ActiveWinampSkin;
  playlist: StationLite[];
  collection: StationLite[];
  collectionSource: string | null;
  setCollection: (sourceId: string, stations: Array<Station | StationLite>) => void;
  setSkin: (skinId: string) => void;
  selectSkin: (skin: WinampMuseumSkin) => void;
};

type PlayStationOptions = {
  playlist?: Array<Station | StationLite>;
  sourceId?: string;
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
  player: ReturnType<typeof useAudioPlayer>;
  winamp: WinampState;
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
const DEFAULT_STORED_SKIN: StoredSkin = {
  source: 'preset',
  id: DEFAULT_WINAMP_SKIN_ID
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

export const RadioProvider = ({ children }: { children: ReactNode }) => {
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
  const [winampPlaylist, setWinampPlaylist] = useLocalStorage<StationLite[]>(
    'radio:winamp-playlist',
    []
  );
  const [storedSkin, setStoredSkin] = useLocalStorage<StoredSkin>(
    'radio:winamp-skin',
    DEFAULT_STORED_SKIN
  );

  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [winampExpanded, setWinampExpanded] = useState(false);
  const [activeSkin, setActiveSkin] = useState<ActiveWinampSkin>(
    toActiveSkin(storedSkin.id)
  );
  const [winampCollectionState, setWinampCollectionState] = useState<{
    sourceId: string | null;
    stations: StationLite[];
  }>({
    sourceId: null,
    stations: []
  });

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
        } catch (error) {
          logDebug(
            `Skin restore failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      if (cancelled) return;
      const fallback = toActiveSkin(DEFAULT_WINAMP_SKIN_ID);
      setActiveSkin(fallback);
      setStoredSkin({ source: 'preset', id: fallback.id });
      notify('Saved skin unavailable. Reverted to Winamp Base 2.91.');
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
        if (mounted) {
          if (full.length) {
            setStations(full);
            hasData = true;
          }
        }
      } catch (err) {
        if (mounted && !hasData) {
          setError(err instanceof Error ? err.message : 'Failed to load');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };
    load();
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

  const setWinampCollection = (sourceId: string, stations: Array<Station | StationLite>) => {
    const nextStations = mergeUniqueStations(
      stations.map((station) => toLite(station))
    ).slice(0, 120);

    setWinampCollectionState((prev) => {
      const unchanged =
        prev.sourceId === sourceId &&
        prev.stations.length === nextStations.length &&
        prev.stations.every(
          (station, index) => station.stationuuid === nextStations[index]?.stationuuid
        );
      if (unchanged) {
        return prev;
      }
      return {
        sourceId,
        stations: nextStations
      };
    });
  };

  const seedWinampPlaylist = (
    station: Station | StationLite,
    playlistOverride?: Array<Station | StationLite>
  ) => {
    const lite = toLite(station);
    const visibleCollection = playlistOverride?.length
      ? playlistOverride.map((item) => toLite(item))
      : winampCollectionState.stations;
    const next = mergeUniqueStations(
      [lite],
      visibleCollection,
      favorites,
      recent
    ).slice(0, 120);
    setWinampPlaylist(next);
  };

  useEffect(() => {
    if (winampPlaylist.length) return;
    const seed = mergeUniqueStations(
      winampCollectionState.stations,
      favorites,
      recent
    ).slice(0, 120);
    if (seed.length) {
      setWinampPlaylist(seed);
    }
  }, [favorites, recent, winampCollectionState.stations, winampPlaylist.length, setWinampPlaylist]);

  const playStationInternal = async (
    station: Station | StationLite,
    addToHistory: boolean,
    options?: PlayStationOptions
  ) => {
    const lite = toLite(station);
    const url = lite.url_resolved;
    if (!url) {
      notify('Missing stream URL');
      return;
    }

    const playlistOverride = options?.playlist?.map((item) => toLite(item)) ?? [];
    const sourceId =
      options?.sourceId ??
      (playlistOverride.length ? 'playback-context' : winampCollectionState.sourceId);
    if (playlistOverride.length && sourceId) {
      setWinampCollection(sourceId, playlistOverride);
    }

    const result = await player.playStation(lite);
    if (!result.ok) {
      notify(result.error || 'Playback failed');
      return;
    }

    const playedStation = result.station ?? lite;
    seedWinampPlaylist(playedStation, playlistOverride);
    if (addToHistory) {
      addRecent(playedStation);
    }
  };

  const playStation = (station: Station | StationLite, options?: PlayStationOptions) =>
    void playStationInternal(station, true, options);

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
      playStation(station);
      startHandledRef.current = true;
    }
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
      } catch (e) {
        logDebug(`Metadata Err: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    update();
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
    const currentId = player.current?.stationuuid;
    if (!currentId || !recent.length) return;
    const index = recent.findIndex((item) => item.stationuuid === currentId);
    if (index === -1) {
      void playStationInternal(recent[0], false);
      return;
    }
    const prev = recent[index + 1] ?? null;
    if (prev) {
      void playStationInternal(prev, false);
    }
  };

  const pickRandomStation = () => {
    const pool = winampCollectionState.stations.length
      ? winampCollectionState.stations
      : stations;
    if (!pool.length) return null;
    const currentId = player.current?.stationuuid;
    if (pool.length === 1) return pool[0];
    for (let i = 0; i < 6; i += 1) {
      const candidate = pool[Math.floor(Math.random() * pool.length)];
      if (!candidate || candidate.stationuuid === currentId) continue;
      return candidate;
    }
    return pool.find((item) => item.stationuuid !== currentId) ?? pool[0];
  };

  const playNext = () => {
    const currentId = player.current?.stationuuid;
    if (currentId && recent.length >= 2) {
      const index = recent.findIndex((item) => item.stationuuid === currentId);
      const next = index > 0 ? recent[index - 1] : null;
      if (next) {
        void playStationInternal(next, false);
        return;
      }
    }
    const randomStation = pickRandomStation();
    if (randomStation) {
      void playStationInternal(randomStation, true, {
        playlist: winampCollectionState.stations,
        sourceId: winampCollectionState.sourceId ?? 'playback-context'
      });
    }
  };

  const playLast = () => {
    if (recent.length) {
      void playStationInternal(recent[0], true);
      return;
    }
    if (winampCollectionState.stations.length) {
      void playStationInternal(winampCollectionState.stations[0], true, {
        playlist: winampCollectionState.stations,
        sourceId: winampCollectionState.sourceId ?? 'playback-context'
      });
      return;
    }
    if (stations.length) {
      void playStationInternal(stations[0], true);
    }
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
    const artist = nowPlaying ? station.name : (station.country || 'Live Radio');

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
  }, [player.current, player.isPlaying, nowPlaying, playPrevious, playNext, player]);

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
        notify('Share dialog opened');
        return;
      } catch {
        // ignore
      }
    }

    try {
      await navigator.clipboard.writeText(`${title} ${url}`);
      notify('Link copied');
      return;
    } catch {
      // ignore
    }

    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
    const tg = window.Telegram?.WebApp;

    if (tg?.openLink) {
      tg.openLink(shareUrl);
      notify('Share opened');
      return;
    }

    try {
      const popup = window.open(shareUrl, '_blank', 'noopener,noreferrer');
      if (popup) {
        notify('Share opened');
        return;
      }
    } catch {
      // ignore
    }

    notify('Share failed');
  };

  const clearFavorites = () => setFavorites([]);
  const clearRecent = () => setRecent([]);
  const clearCache = () => {
    clearStationsCache();
    notify('Cache cleared');
  };

  const copyTrack = async () => {
    const station = player.current;
    if (!station || !nowPlaying) {
      notify('No track info');
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
      notify('Track copied');
    } catch {
      notify('Copy failed');
    }
  };

  const setSkin = (skinId: string) => {
    const preset = findPresetSkin(skinId);
    setActiveSkin({ ...preset, source: 'preset' });
    setStoredSkin({ source: 'preset', id: preset.id });
    notify(`Skin: ${preset.name}`);
  };

  const selectSkin = (skin: WinampMuseumSkin) => {
    setActiveSkin(toMuseumActiveSkin(skin));
    setStoredSkin({
      source: 'museum',
      md5: skin.md5,
      name: skin.name
    });
    notify(`Skin: ${skin.name}`);
  };

  const winamp = useMemo<WinampState>(
    () => ({
      expanded: winampExpanded,
      setExpanded: setWinampExpanded,
      availableSkins: WINAMP_SKIN_PRESETS,
      activeSkin,
      playlist: winampPlaylist,
      collection: winampCollectionState.stations,
      collectionSource: winampCollectionState.sourceId,
      setCollection: setWinampCollection,
      setSkin,
      selectSkin
    }),
    [winampExpanded, activeSkin, winampCollectionState, winampPlaylist]
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
    player,
    winamp,
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
