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
  playlist?: {
    currentTrack?: number;
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

const normalizeMediaStatus = (value: string): WebampMediaStatus => {
  const normalized = value.toUpperCase();
  if (normalized === 'PLAYING') return 'PLAYING';
  if (normalized === 'PAUSED') return 'PAUSED';
  return 'STOPPED';
};
const normalizeTrackUrl = (url: string) => {
  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return url;
  }
};
const canonicalTrackUrl = (url: string) => {
  try {
    const parsed = new URL(url, window.location.origin);
    return `${parsed.origin}${parsed.pathname}`.toLowerCase();
  } catch {
    return url.split(/[?#]/, 1)[0].toLowerCase();
  }
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const buildTracks = (playlist: StationLite[]): WebampTrack[] =>
  playlist.map((station) => ({
    url: station.url_resolved || '',
    metaData: {
      title: station.name,
      artist: stationLocation(station)
    }
  }));

const buildLayout = (expanded: boolean) => {
  if (!expanded) {
    return {
      main: {
        position: { top: 6, left: 6 },
        shadeMode: true
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

const syncCompactWindowPlacement = (mountNode: HTMLElement, scale: number) => {
  const menu = document.querySelector('[title="Winamp Menu"]') as HTMLElement | null;
  const windowNode =
    (menu?.closest('.window') as HTMLElement | null) ??
    (document.querySelector('.window') as HTMLElement | null);
  const anchor = windowNode?.parentElement as HTMLElement | null;
  if (!windowNode || !anchor) return false;

  const mountRect = mountNode.getBoundingClientRect();
  windowNode.style.transformOrigin = 'top left';
  windowNode.style.transform = '';
  const rawRect = windowNode.getBoundingClientRect();
  const baseWidth = rawRect.width || 275;
  const nextScale = Number(scale.toFixed(3));
  const nextWidth = baseWidth * nextScale;
  const compactHeight = Math.round(28 * nextScale);
  const left = mountRect.left + Math.max(0, (mountRect.width - nextWidth) / 2);
  const top = mountRect.top;

  anchor.style.position = 'fixed';
  anchor.style.inset = '0 auto auto 0';
  anchor.style.transform = `translate(${left}px, ${top}px)`;
  anchor.style.zIndex = '58';
  anchor.style.pointerEvents = 'none';
  anchor.style.height = `${compactHeight}px`;
  anchor.style.overflow = 'hidden';
  windowNode.style.pointerEvents = 'auto';
  windowNode.style.transform = `scale(${nextScale})`;

  return true;
};

const resetWebampWindowPlacement = () => {
  const menu = document.querySelector('[title="Winamp Menu"]') as HTMLElement | null;
  const windowNode =
    (menu?.closest('.window') as HTMLElement | null) ??
    (document.querySelector('.window') as HTMLElement | null);
  const anchor = windowNode?.parentElement as HTMLElement | null;
  if (anchor) {
    anchor.style.position = '';
    anchor.style.inset = '';
    anchor.style.transform = '';
    anchor.style.zIndex = '';
    anchor.style.pointerEvents = '';
    anchor.style.height = '';
    anchor.style.overflow = '';
  }
  if (windowNode) {
    windowNode.style.transformOrigin = '';
    windowNode.style.transform = '';
    windowNode.style.pointerEvents = '';
  }
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
  const playablePlaylistRef = useRef<StationLite[]>([]);
  const stationByTrackUrlRef = useRef<Map<string, StationLite>>(new Map());
  const [webampReady, setWebampReady] = useState(false);
  const [webampFailed, setWebampFailed] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootCycle, setBootCycle] = useState(0);
  const [compactScale, setCompactScale] = useState(1);

  const current = player.current;

  const playlist = useMemo(() => {
    if (winamp.playlist.length) return winamp.playlist;
    if (current) return [current];
    return [] as StationLite[];
  }, [winamp.playlist, current]);
  const playablePlaylist = useMemo(
    () => playlist.filter((station) => Boolean(station.url_resolved)),
    [playlist]
  );

  const liked = current ? isFavorite(current.stationuuid) : false;
  const canResume = Boolean(recent.length);

  useEffect(() => {
    const updateScale = () => {
      const viewport = Math.max(window.innerWidth, 320);
      const nextScale = clamp((viewport - 24) / 275, 0.64, 1.24);
      setCompactScale(Number(nextScale.toFixed(3)));
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => {
      window.removeEventListener('resize', updateScale);
    };
  }, []);

  useEffect(() => {
    playablePlaylistRef.current = playablePlaylist;
  }, [playablePlaylist]);

  useEffect(() => {
    const lookup = stationByTrackUrlRef.current;
    lookup.clear();
    playablePlaylist.forEach((station) => {
      if (!station.url_resolved) return;
      lookup.set(normalizeTrackUrl(station.url_resolved), station);
      lookup.set(canonicalTrackUrl(station.url_resolved), station);
    });
  }, [playablePlaylist]);

  useEffect(() => {
    return () => {
      stationByTrackUrlRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!winamp.expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [winamp.expanded]);

  useEffect(() => {
    const mountNode = winamp.expanded ? overlayHostRef.current : compactHostRef.current;
    if (!mountNode) return;

    let cancelled = false;
    let mountedInstance: WebampInstance | null = null;
    if (webampRef.current) {
      try {
        webampRef.current.dispose();
      } catch {
        // ignore
      }
      webampRef.current = null;
    }
    mountNode.innerHTML = '';
    resetWebampWindowPlacement();
    setWebampReady(false);
    setWebampFailed(false);
    setBootError(null);

    const boot = async () => {
      const Webamp = await loadWebampCtor();
      if (cancelled) return;

      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const layoutModes = [false];
        for (const useLayout of layoutModes) {
          try {
            const instance = new Webamp({
              initialSkin: {
                url: winamp.activeSkin.url
              },
              availableSkins: winamp.availableSkins.map((skin) => ({
                name: skin.name,
                url: skin.url
              })),
              initialTracks: buildTracks(playablePlaylist),
              enableDoubleSizeMode: false,
              enableHotkeys: false,
              enableMediaSession: false,
              zIndex: winamp.expanded ? 140 : 64,
              ...(useLayout ? { windowLayout: buildLayout(winamp.expanded) } : {})
            });

            await instance.renderWhenReady(mountNode);
            if (cancelled) {
              instance.dispose();
              return;
            }

            mountedInstance = instance;
            webampRef.current = instance;
            instance.setVolume(Math.round(player.volume * 100));
            if (!winamp.expanded) {
              let placementAttempt = 0;
              const ensureCompactPlacement = () => {
                if (cancelled) return;
                syncCompactWindowPlacement(mountNode, compactScale);
                placementAttempt += 1;
                if (placementAttempt < 10) {
                  window.setTimeout(ensureCompactPlacement, 180);
                }
              };
              window.setTimeout(ensureCompactPlacement, 80);
            } else {
              resetWebampWindowPlacement();
            }
            setWebampReady(true);
            setWebampFailed(false);
            setBootError(null);
            retryCountRef.current = 0;
            return;
          } catch (error) {
            lastError = error;
            console.error(
              `Winamp init failed (attempt ${attempt + 1}, layout=${useLayout ? 'on' : 'off'})`,
              error
            );
            if (cancelled) {
              break;
            }
            mountNode.innerHTML = '';
          }
        }
        if (attempt === 2 || cancelled) {
          break;
        }
        await new Promise((resolve) =>
          window.setTimeout(resolve, 200 * (attempt + 1))
        );
      }

      if (!cancelled) {
        setWebampFailed(true);
        setBootError(lastError ? toErrorMessage(lastError) : null);
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
      resetWebampWindowPlacement();
      if (webampRef.current === mountedInstance) {
        webampRef.current = null;
      }
    };
  }, [winamp.expanded, bootCycle]);

  useEffect(() => {
    if (winamp.expanded || !webampReady) return;
    const mountNode = compactHostRef.current;
    if (!mountNode) return;

    const sync = () => {
      syncCompactWindowPlacement(mountNode, compactScale);
    };
    sync();
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    return () => {
      window.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [winamp.expanded, webampReady, compactScale]);

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

    const tracks = buildTracks(playablePlaylist);
    if (!tracks.length) return;

    try {
      instance.setTracksToPlay(tracks);
      const currentId = current?.stationuuid;
      const currentIndex = currentId
        ? playablePlaylist.findIndex((item) => item.stationuuid === currentId)
        : 0;
      if (currentIndex >= 0) {
        suppressTrackSyncUntilRef.current = Date.now() + 700;
        instance.setCurrentTrack(currentIndex);
      }
    } catch {
      // ignore
    }
  }, [webampReady, playablePlaylist, current?.stationuuid]);

  useEffect(() => {
    const instance = webampRef.current;
    if (!instance || !webampReady) return;

    try {
      syncPauseUntilRef.current = Date.now() + 500;
      if (!current || !player.isPlaying) {
        instance.pause();
      } else {
        instance.play();
      }
    } catch {
      // ignore
    }
  }, [webampReady, current?.stationuuid, player.isPlaying]);

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
      const lookup = stationByTrackUrlRef.current;
      const target =
        lookup.get(normalizeTrackUrl(trackInfo.url)) ??
        lookup.get(canonicalTrackUrl(trackInfo.url));
      if (target) {
        if (player.current?.stationuuid === target.stationuuid) return;
        playStation(target);
        return;
      }

      let currentIndex: number | undefined;
      try {
        currentIndex = instance.__getSerializedState?.().playlist?.currentTrack;
      } catch {
        currentIndex = undefined;
      }
      if (typeof currentIndex === 'number' && currentIndex >= 0) {
        const station = playablePlaylistRef.current[currentIndex];
        if (station && player.current?.stationuuid !== station.stationuuid) {
          playStation(station);
        }
      }
    });

    let previousStatus = normalizeMediaStatus(instance.getMediaStatus());

    const syncMediaState = (state?: WebampSerializedState) => {
      const media = state?.media;
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

      const nextStatus = normalizeMediaStatus(media.status ?? instance.getMediaStatus());
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
        } else if (playablePlaylistRef.current.length) {
          playStation(playablePlaylistRef.current[0]);
        } else if (canResume) {
          playLast();
        }
      }

      if ((nextStatus === 'PAUSED' || nextStatus === 'STOPPED') && player.isPlaying) {
        player.toggle();
      }
    };

    const unsubscribeState = instance.__onStateChange?.(() => {
      const state = instance.__getSerializedState?.();
      syncMediaState(state);
    });

    return () => {
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

      <button className="chip" type="button" onClick={copyTrack} disabled={!nowPlaying}>
        Song
      </button>

      {variant === 'compact' ? (
        <button className="chip active" type="button" onClick={() => winamp.setExpanded(true)}>
          Expand
        </button>
      ) : null}
    </div>
  );

  return (
    <>
      {!winamp.expanded && (
        <div className="winamp-compact">
          {actionStrip('compact')}
          <div className="winamp-compact-main">
            <div className="winamp-host compact" ref={compactHostRef} />
            {!webampReady && (
              <div className="winamp-loading">
                {webampFailed ? (
                  <button
                    className="chip"
                    type="button"
                    title={bootError || undefined}
                    onClick={() => setBootCycle((value) => value + 1)}
                  >
                    Winamp load failed. Retry
                  </button>
                ) : (
                  'Loading Winamp...'
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <WinampOverlay
        open={winamp.expanded}
        onCollapse={() => winamp.setExpanded(false)}
        footerActions={actionStrip('overlay')}
      >
        <div className="winamp-host overlay" ref={overlayHostRef} />
        {!webampReady && (
          <div className="winamp-loading overlay">
            {webampFailed ? (
              <button
                className="chip"
                type="button"
                title={bootError || undefined}
                onClick={() => setBootCycle((value) => value + 1)}
              >
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
