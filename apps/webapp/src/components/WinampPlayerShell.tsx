import { useEffect, useMemo, useRef, useState } from 'react';
import type { StationLite } from '../types';
import { stationLocation } from '../lib/stationUtils';
import { useRadio } from '../state/RadioContext';
import { WinampOverlay } from './WinampOverlay';

type WebampTrack = {
  url: string;
  metaData: {
    title: string;
    artist: string;
  };
};

type WebampMediaStatus = 'PLAYING' | 'PAUSED' | 'STOPPED';

type WebampSerializedState = {
  media?: {
    volume?: number;
    status?: string;
  };
};

type WebampInstance = {
  renderWhenReady: (node: HTMLElement) => Promise<void>;
  dispose: () => void;
  setTracksToPlay: (tracks: WebampTrack[]) => void;
  setCurrentTrack: (index: number) => void;
  setSkinFromUrl: (url: string) => void;
  setVolume: (volume: number) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  getMediaStatus: () => string;
  onTrackDidChange: (cb: (trackInfo: { url: string } | null) => void) => () => void;
  __getSerializedState?: () => WebampSerializedState;
  __onStateChange?: (cb: () => void) => () => void;
};

type WebampCtor = new (options: Record<string, unknown>) => WebampInstance;

let webampCtorPromise: Promise<WebampCtor> | null = null;

const loadWebampCtor = async () => {
  if (!webampCtorPromise) {
    webampCtorPromise = import('webamp').then((mod) => mod.default as unknown as WebampCtor);
  }
  try {
    return await webampCtorPromise;
  } catch (error) {
    webampCtorPromise = null;
    throw error;
  }
};

const SILENT_TRACK_BASE64 =
  'UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=';

const normalizeMediaStatus = (value: string): WebampMediaStatus => {
  const normalized = value.toUpperCase();
  if (normalized === 'PLAYING') return 'PLAYING';
  if (normalized === 'PAUSED') return 'PAUSED';
  return 'STOPPED';
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const createSilentTrackBlobUrl = () => {
  const binary = atob(SILENT_TRACK_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
};

const buildTracks = (playlist: StationLite[], stationTrackUrls: Map<string, string>): WebampTrack[] =>
  playlist.map((station) => ({
    url: stationTrackUrls.get(station.stationuuid) || '',
    metaData: {
      title: station.name,
      artist: stationLocation(station)
    }
  }));

const buildLayout = (expanded: boolean) => {
  if (!expanded) {
    return {
      main: {
        position: { top: 6, left: 6 }
      },
      equalizer: {
        position: { top: 138, left: 6 },
        closed: true
      },
      playlist: {
        position: { top: 254, left: 6 },
        size: { extraHeight: 12, extraWidth: 4 },
        closed: true
      }
    };
  }

  return {
    main: {
      position: { top: 16, left: 16 }
    },
    equalizer: {
      position: { top: 136, left: 16 },
      closed: false
    },
    playlist: {
      position: { top: 252, left: 16 },
      size: { extraHeight: 12, extraWidth: 4 },
      closed: false
    }
  };
};

export const WinampPlayerShell = ({
  onDetails
}: {
  onDetails?: () => void;
}) => {
  const {
    player,
    winamp,
    nowPlaying,
    nowPlayingStatus,
    recent,
    playNext,
    playLast,
    playStation,
    copyTrack,
    toggleFavorite,
    isFavorite,
    shareStation,
    openWebAppExternally
  } = useRadio();

  const compactHostRef = useRef<HTMLDivElement | null>(null);
  const overlayHostRef = useRef<HTMLDivElement | null>(null);
  const webampRef = useRef<WebampInstance | null>(null);
  const syncPauseUntilRef = useRef(0);
  const suppressTrackSyncUntilRef = useRef(0);
  const retryDelayRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const syncingVolumeFromWebampRef = useRef(false);
  const playlistRef = useRef<StationLite[]>([]);
  const stationTrackUrlsRef = useRef<Map<string, string>>(new Map());
  const stationByTrackUrlRef = useRef<Map<string, StationLite>>(new Map());
  const [webampReady, setWebampReady] = useState(false);
  const [webampFailed, setWebampFailed] = useState(false);
  const [bootCycle, setBootCycle] = useState(0);

  const current = player.current;

  const playlist = useMemo(() => {
    if (winamp.playlist.length) return winamp.playlist;
    if (current) return [current];
    return [] as StationLite[];
  }, [winamp.playlist, current]);

  const statusLabel = useMemo(() => {
    if (!current) return 'Pick a station to start listening';
    if (player.status === 'buffering') return 'Buffering...';
    if (player.status === 'error') return 'Stream error, reconnecting';
    if (player.status === 'paused') return 'Paused';
    return 'Live';
  }, [current, player.status]);

  const trackLabel = useMemo(() => {
    if (!current) return null;
    if (nowPlaying) return `Now playing: ${nowPlaying}`;
    if (nowPlayingStatus === 'loading') return 'Fetching track...';
    if (nowPlayingStatus === 'unavailable') return 'Track info unavailable';
    return null;
  }, [current, nowPlaying, nowPlayingStatus]);

  const liked = current ? isFavorite(current.stationuuid) : false;
  const canResume = Boolean(recent.length);

  useEffect(() => {
    playlistRef.current = playlist;
  }, [playlist]);

  useEffect(() => {
    const nextIds = new Set(playlist.map((item) => item.stationuuid));
    const urls = stationTrackUrlsRef.current;
    const lookup = stationByTrackUrlRef.current;

    for (const [id, url] of urls.entries()) {
      if (nextIds.has(id)) continue;
      URL.revokeObjectURL(url);
      urls.delete(id);
      lookup.delete(url);
    }

    playlist.forEach((station) => {
      if (!urls.has(station.stationuuid)) {
        urls.set(station.stationuuid, createSilentTrackBlobUrl());
      }
      const url = urls.get(station.stationuuid);
      if (url) {
        lookup.set(url, station);
      }
    });
  }, [playlist]);

  useEffect(() => {
    return () => {
      stationTrackUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      stationTrackUrlsRef.current.clear();
      stationByTrackUrlRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const mountNode = winamp.expanded ? overlayHostRef.current : compactHostRef.current;
    if (!mountNode) return;

    let cancelled = false;
    let mountedInstance: WebampInstance | null = null;
    mountNode.innerHTML = '';
    setWebampReady(false);
    setWebampFailed(false);

    const boot = async () => {
      const Webamp = await loadWebampCtor();
      if (cancelled) return;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const instance = new Webamp({
            initialSkin: {
              url: winamp.activeSkin.url
            },
            availableSkins: winamp.availableSkins.map((skin) => ({
              name: skin.name,
              url: skin.url
            })),
            initialTracks: buildTracks(playlist, stationTrackUrlsRef.current),
            enableDoubleSizeMode: true,
            enableHotkeys: false,
            enableMediaSession: false,
            zIndex: winamp.expanded ? 70 : 20,
            windowLayout: buildLayout(winamp.expanded)
          });

          await instance.renderWhenReady(mountNode);
          if (cancelled) {
            instance.dispose();
            return;
          }

          mountedInstance = instance;
          webampRef.current = instance;
          instance.setVolume(Math.round(player.volume * 100));
          setWebampReady(true);
          setWebampFailed(false);
          retryCountRef.current = 0;
          return;
        } catch (error) {
          console.error('Winamp init failed', error);
          if (attempt === 2 || cancelled) {
            break;
          }
          await new Promise((resolve) =>
            window.setTimeout(resolve, 200 * (attempt + 1))
          );
          mountNode.innerHTML = '';
        }
      }

      if (!cancelled) {
        setWebampFailed(true);
        if (retryCountRef.current < 5) {
          retryCountRef.current += 1;
          retryDelayRef.current = window.setTimeout(() => {
            retryDelayRef.current = null;
            setBootCycle((value) => value + 1);
          }, 700 * retryCountRef.current);
        }
      }
    };

    void boot().catch((error) => {
      console.error('Winamp boot failed', error);
      if (!cancelled) {
        setWebampFailed(true);
      }
    });

    return () => {
      cancelled = true;
      setWebampReady(false);
      if (retryDelayRef.current !== null) {
        window.clearTimeout(retryDelayRef.current);
        retryDelayRef.current = null;
      }
      if (mountedInstance) {
        try {
          mountedInstance.dispose();
        } catch {
          // ignore
        }
      }
      if (webampRef.current === mountedInstance) {
        webampRef.current = null;
      }
    };
  }, [winamp.expanded, bootCycle]);

  useEffect(() => {
    const instance = webampRef.current;
    if (!instance || !webampReady) return;

    try {
      instance.setSkinFromUrl(winamp.activeSkin.url);
    } catch {
      // ignore
    }
  }, [winamp.activeSkin.url, webampReady]);

  useEffect(() => {
    const instance = webampRef.current;
    if (!instance || !webampReady) return;

    const tracks = buildTracks(playlist, stationTrackUrlsRef.current).filter((item) =>
      Boolean(item.url)
    );
    if (!tracks.length) return;

    try {
      instance.setTracksToPlay(tracks);
      const currentId = current?.stationuuid;
      const currentIndex = currentId
        ? playlist.findIndex((item) => item.stationuuid === currentId)
        : 0;
      if (currentIndex >= 0) {
        suppressTrackSyncUntilRef.current = Date.now() + 700;
        instance.setCurrentTrack(currentIndex);
      }

      syncPauseUntilRef.current = Date.now() + 500;
      if (!current) {
        instance.pause();
      } else if (player.isPlaying) {
        instance.play();
      } else {
        instance.pause();
      }
    } catch {
      // ignore
    }
  }, [webampReady, playlist, current?.stationuuid, player.isPlaying]);

  useEffect(() => {
    const instance = webampRef.current;
    if (!instance || !webampReady) return;
    if (syncingVolumeFromWebampRef.current) return;

    try {
      instance.setVolume(Math.round(clamp(player.volume, 0, 1) * 100));
    } catch {
      // ignore
    }
  }, [player.volume, webampReady]);

  useEffect(() => {
    const instance = webampRef.current;
    if (!instance || !webampReady) return;

    const unsubscribeTrack = instance.onTrackDidChange((trackInfo) => {
      if (!trackInfo || Date.now() < suppressTrackSyncUntilRef.current) return;
      const target = stationByTrackUrlRef.current.get(trackInfo.url);
      if (target) {
        if (player.current?.stationuuid === target.stationuuid) return;
        playStation(target);
      }
    });

    const syncMediaState = () => {
      let media: WebampSerializedState['media'] | undefined;
      try {
        media = instance.__getSerializedState?.().media;
      } catch {
        return;
      }
      if (!media) return;
      if (typeof media.volume === 'number') {
        const nextVolume = clamp(media.volume / 100, 0, 1);
        if (Math.abs(nextVolume - player.volume) > 0.03) {
          syncingVolumeFromWebampRef.current = true;
          player.setVolume(nextVolume);
          window.setTimeout(() => {
            syncingVolumeFromWebampRef.current = false;
          }, 120);
        }
      }
    };

    const unsubscribeState = instance.__onStateChange?.(() => {
      syncMediaState();
    });

    let previousStatus = normalizeMediaStatus(instance.getMediaStatus());
    const timer = window.setInterval(() => {
      syncMediaState();

      const nextStatus = normalizeMediaStatus(instance.getMediaStatus());
      if (nextStatus === previousStatus) return;
      previousStatus = nextStatus;

      if (Date.now() < syncPauseUntilRef.current) {
        return;
      }

      if (nextStatus === 'PLAYING') {
        if (player.current) {
          if (!player.isPlaying) {
            player.toggle();
          }
        } else if (playlistRef.current.length) {
          playStation(playlistRef.current[0]);
        } else if (canResume) {
          playLast();
        }
      }

      if (nextStatus === 'PAUSED' && player.isPlaying) {
        player.toggle();
      }

      if (nextStatus === 'STOPPED' && player.isPlaying) {
        player.stop();
      }
    }, 280);

    return () => {
      window.clearInterval(timer);
      unsubscribeTrack?.();
      unsubscribeState?.();
    };
  }, [webampReady, player, playLast, playStation, canResume]);

  const actionStrip = (variant: 'compact' | 'overlay') => (
    <div className={`winamp-actions ${variant}`}>
      {canResume && !current && (
        <button className="chip" type="button" onClick={playLast}>
          Resume
        </button>
      )}

      <button className="chip" type="button" onClick={playNext}>
        Random
      </button>

      <button
        className={`icon-btn ${liked ? 'active' : ''}`}
        onClick={() => current && toggleFavorite(current)}
        type="button"
        disabled={!current}
        aria-label={liked ? 'Unfavorite' : 'Favorite'}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 21.2l-1.4-1.3C5.4 15.4 2 12.3 2 8.4 2 5.6 4.2 3.5 7 3.5c1.6 0 3.2.7 4.2 2 1-1.3 2.6-2 4.2-2 2.8 0 5 2.1 5 4.9 0 3.9-3.4 7-8.6 11.4L12 21.2z" />
        </svg>
      </button>

      {onDetails && (
        <button
          className="chip"
          onClick={() => current && onDetails()}
          type="button"
          disabled={!current}
        >
          Info
        </button>
      )}

      <button
        className="chip"
        onClick={() => current && shareStation(current)}
        type="button"
        disabled={!current}
      >
        Share
      </button>

      <button
        className="icon-btn"
        onClick={openWebAppExternally}
        type="button"
        title="Open in Browser"
        aria-label="Open app"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M19 19H5V5h7V3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.6l-9.8 9.8 1.4 1.4L19 6.4V10h2V3h-7z" />
        </svg>
      </button>

      {nowPlaying && (
        <button className="chip" type="button" onClick={copyTrack}>
          Copy track
        </button>
      )}

      {variant === 'compact' ? (
        <button className="chip active" type="button" onClick={() => winamp.setExpanded(true)}>
          Expand
        </button>
      ) : null}
    </div>
  );

  return (
    <>
      <div className="winamp-compact">
        <div className="winamp-compact-main">
          <div className="winamp-host compact" ref={compactHostRef} />
          {!webampReady && (
            <div className="winamp-loading">
              {webampFailed ? (
                <button className="chip" type="button" onClick={() => setBootCycle((value) => value + 1)}>
                  Winamp load failed. Retry
                </button>
              ) : (
                'Loading Winamp...'
              )}
            </div>
          )}
        </div>

        <div className="winamp-compact-meta">
          <div className="player-title">{current?.name ?? 'RadioAtlas'}</div>
          <div className="player-sub">{current ? stationLocation(current) : statusLabel}</div>
          {trackLabel && (
            <button
              className={`player-track ${nowPlaying ? 'track-copy' : ''}`}
              onClick={() => nowPlaying && copyTrack()}
              type="button"
              disabled={!nowPlaying}
              title={nowPlaying ? 'Copy track' : undefined}
            >
              {trackLabel}
            </button>
          )}
          {!trackLabel && <div className="player-status">{statusLabel}</div>}
        </div>
        {actionStrip('compact')}
      </div>

      <WinampOverlay
        open={winamp.expanded}
        title={current?.name || 'Winamp Player'}
        subtitle={current ? stationLocation(current) : 'Pick a station'}
        onCollapse={() => winamp.setExpanded(false)}
        footerActions={actionStrip('overlay')}
      >
        <div className="winamp-host overlay" ref={overlayHostRef} />
        {!webampReady && (
          <div className="winamp-loading overlay">
            {webampFailed ? (
              <button className="chip" type="button" onClick={() => setBootCycle((value) => value + 1)}>
                Winamp load failed. Retry
              </button>
            ) : (
              'Loading Winamp...'
            )}
          </div>
        )}
      </WinampOverlay>
    </>
  );
};
