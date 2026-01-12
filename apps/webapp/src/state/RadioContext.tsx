import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Station, StationLite } from '../types';
import { fetchStations, clearStationsCache } from '../lib/radioBrowser';
import { fetchNowPlaying, subscribeNowPlaying } from '../lib/nowPlaying';
import { useLocalStorage } from '../lib/useLocalStorage';
import { useAudioPlayer } from '../lib/useAudioPlayer';
import { toLite } from '../lib/stationUtils';
import { getStartParam, makeDeepLink, parseStationParam } from '../lib/telegram';
import { getApiBase } from '../lib/apiBase';

type TrackHistoryItem = {
  id: string;
  stationId: string;
  stationName: string;
  track: string;
  timestamp: number;
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
  playStation: (station: Station | StationLite) => void;
  playPrevious: () => void;
  playNext: () => void;
  playLast: () => void;
  copyTrack: () => void;
  toggleFavorite: (station: Station | StationLite) => void;
  isFavorite: (stationId: string) => boolean;
  openExternal: (station: Station | StationLite) => void;
  shareStation: (station: Station | StationLite) => void;
  clearFavorites: () => void;
  clearRecent: () => void;
  clearCache: () => void;
};

const RadioContext = createContext<RadioContextValue | null>(null);

const MAX_RECENT = 20;
const MAX_TRACK_HISTORY = 200;

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

  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  const logDebug = (msg: string) => {
    setDebugLogs((prev) =>
      [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 50)
    );
  };

  const player = useAudioPlayer({
    onEvent: logDebug
  });
  const startHandledRef = useRef(false);

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
    tg?.setHeaderColor?.('#0b1514');
    tg?.setBackgroundColor?.('#0b1514');
    if (tg?.isActive) {
      logDebug(`WebApp active state: ${tg.isActive}`);
    }
  }, []);

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
      const track = await fetchNowPlaying(station);
      applyTrack(track);
    };

    update();
    const interval = window.setInterval(update, 60000);
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

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2000);
  };

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

  const addRecent = (station: Station | StationLite) => {
    const lite = toLite(station);
    setRecent((prev) => {
      const next = [lite, ...prev.filter((item) => item.stationuuid !== lite.stationuuid)];
      return next.slice(0, MAX_RECENT);
    });
  };

  const playStationInternal = (
    station: Station | StationLite,
    addToHistory: boolean
  ) => {
    const lite = toLite(station);
    const url = lite.url_resolved;
    if (!url) {
      notify('Missing stream URL');
      return;
    }
    const proxyBase = getApiBase();
    const hasProxy = Boolean(proxyBase);
    const isHttps = url.startsWith('https://');
    const isLocal = window.location.protocol === 'http:';
    if (!isHttps && !isLocal && !hasProxy) {
      notify('HTTP stream: open externally');
      openExternal(lite);
      return;
    }
    player.playStation(lite);
    if (addToHistory) {
      addRecent(lite);
    }
  };

  const playStation = (station: Station | StationLite) =>
    playStationInternal(station, true);

  const playPrevious = () => {
    const currentId = player.current?.stationuuid;
    if (!currentId || recent.length < 2) return;
    const index = recent.findIndex((item) => item.stationuuid === currentId);
    const prev = index >= 0 ? recent[index + 1] : null;
    if (prev) {
      playStationInternal(prev, false);
    }
  };

  const pickRandomStation = () => {
    if (!stations.length) return null;
    const currentId = player.current?.stationuuid;
    if (stations.length === 1) return stations[0];
    for (let i = 0; i < 6; i += 1) {
      const candidate = stations[Math.floor(Math.random() * stations.length)];
      if (!candidate || candidate.stationuuid === currentId) continue;
      return candidate;
    }
    return stations.find((item) => item.stationuuid !== currentId) ?? stations[0];
  };

  const playNext = () => {
    const currentId = player.current?.stationuuid;
    if (currentId && recent.length >= 2) {
      const index = recent.findIndex((item) => item.stationuuid === currentId);
      const next = index > 0 ? recent[index - 1] : null;
      if (next) {
        playStationInternal(next, false);
        return;
      }
    }
    const randomStation = pickRandomStation();
    if (randomStation) {
      playStationInternal(randomStation, true);
    }
  };

  const playLast = () => {
    if (recent.length) {
      playStationInternal(recent[0], true);
      return;
    }
    if (stations.length) {
      playStationInternal(stations[0], true);
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

    // Use track title if available, otherwise station name
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

  const openExternal = (station: Station | StationLite) => {
    const url = station.url_resolved;
    const tg = window.Telegram?.WebApp;
    if (tg?.openLink) {
      tg.openLink(url);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openWebAppExternally = () => {
    let url = window.location.origin;
    if (player.current) {
      url += `?station=station_${player.current.stationuuid}`;
    }

    const tg = window.Telegram?.WebApp;
    if (tg?.openLink) {
      // Using openLink to break out of WebView
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
    // 1. Try Native Share (Mobile)
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch {
        // ignore share aborts/errors, fall through
      }
    }

    // 2. Try Clipboard
    try {
      await navigator.clipboard.writeText(`${title} ${url}`);
      notify('Link copied');
      return;
    } catch {
      // ignore
    }

    // 3. Fallback: Telegram Share Link
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
    const tg = window.Telegram?.WebApp;

    if (tg?.openLink) {
      tg.openLink(shareUrl);
      return;
    }

    // 4. Last Resort: Window Open
    try {
      window.open(shareUrl, '_blank', 'noopener,noreferrer');
      return;
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
  } as RadioContextValue & { openWebAppExternally: () => void; debugLogs: string[] };

  return <RadioContext.Provider value={value}>{children}</RadioContext.Provider>;
};

export const useRadio = () => {
  const context = useContext(RadioContext);
  if (!context) {
    throw new Error('useRadio must be used inside RadioProvider');
  }
  return context;
};
