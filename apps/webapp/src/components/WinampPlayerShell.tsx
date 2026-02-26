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
  onTrackDidChange: (
    cb: (trackInfo: { url: string; metaData?: { title?: string } } | null) => void
  ) => () => void;
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

const buildPersistentLayout = () => ({
  main: {
    position: { top: 16, left: 16 },
    shadeMode: true
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
});

const getMainWindowNode = () => {
  const mainWindow =
    (document.querySelector('#main-window')?.closest('.window') as HTMLElement | null) ?? null;
  if (mainWindow) return mainWindow;

  const menu = document.querySelector('[title="Winamp Menu"]') as HTMLElement | null;
  return (
    (menu?.closest('.window') as HTMLElement | null) ??
    (document.querySelector('#webamp .window') as HTMLElement | null)
  );
};

const getWebampWindowNodes = () =>
  Array.from(document.querySelectorAll<HTMLElement>('#webamp .window'));

const enforceCompactWindowVisibility = () => {
  const mainWindow = getMainWindowNode();
  if (!mainWindow) return;

  getWebampWindowNodes().forEach((windowNode) => {
    if (windowNode === mainWindow) {
      delete windowNode.dataset.raCompactHidden;
      windowNode.style.display = '';
      windowNode.style.pointerEvents = 'auto';
      return;
    }

    if (windowNode.dataset.raCompactHidden === undefined) {
      windowNode.dataset.raCompactHidden = windowNode.style.display || '__empty__';
    }
    windowNode.style.display = 'none';
    windowNode.style.pointerEvents = 'none';
  });
};

const resetCompactWindowVisibility = () => {
  getWebampWindowNodes().forEach((windowNode) => {
    if (windowNode.dataset.raCompactHidden !== undefined) {
      const previousDisplay = windowNode.dataset.raCompactHidden;
      windowNode.style.display = previousDisplay === '__empty__' ? '' : previousDisplay;
      delete windowNode.dataset.raCompactHidden;
    } else {
      windowNode.style.display = '';
    }
    windowNode.style.pointerEvents = '';
  });
};

const syncCompactWindowPlacement = (mountNode: HTMLElement, forceStrip = false) => {
  const windowNode = getMainWindowNode();
  const anchor = windowNode?.parentElement as HTMLElement | null;
  if (!windowNode || !anchor) return false;

  enforceCompactWindowVisibility();
  const mountRect = mountNode.getBoundingClientRect();
  windowNode.style.transformOrigin = 'top left';
  windowNode.style.transform = '';
  windowNode.style.left = '0px';
  windowNode.style.top = '0px';
  const rawRect = windowNode.getBoundingClientRect();
  const baseWidth = rawRect.width || 275;
  const baseHeight = rawRect.height || 28;
  const fitScale = clamp((mountRect.width - 8) / baseWidth, 0.72, 3.6);
  const nextScale = Number(fitScale.toFixed(3));
  const nextWidth = baseWidth * nextScale;
  const rawHeight = Math.max(18, Math.round(baseHeight * nextScale));
  const compactHeight = forceStrip ? Math.min(30, rawHeight) : rawHeight;
  mountNode.style.height = `${compactHeight}px`;
  const hostRect = mountNode.getBoundingClientRect();
  const left = hostRect.left + Math.max(0, (hostRect.width - nextWidth) / 2);
  const actionsNode = document.querySelector('.winamp-actions.compact') as HTMLElement | null;
  const actionsRect = actionsNode?.getBoundingClientRect();
  const top = actionsRect ? Math.max(hostRect.top, actionsRect.bottom + 6) : hostRect.top;

  anchor.style.position = 'fixed';
  anchor.style.inset = '0 auto auto 0';
  anchor.style.transform = `translate(${left}px, ${top}px)`;
  anchor.style.zIndex = '58';
  anchor.style.pointerEvents = 'none';
  anchor.style.height = `${compactHeight}px`;
  anchor.style.width = `${Math.round(nextWidth)}px`;
  anchor.style.overflow = 'hidden';
  anchor.dataset.raCompactAnchor = '1';
  windowNode.style.pointerEvents = 'auto';
  windowNode.style.transform = `scale(${nextScale})`;

  return true;
};

const resetWebampWindowPlacement = () => {
  const anchors = document.querySelectorAll<HTMLElement>('[data-ra-compact-anchor="1"]');
  anchors.forEach((anchor) => {
    anchor.style.position = '';
    anchor.style.inset = '';
    anchor.style.transform = '';
    anchor.style.zIndex = '';
    anchor.style.pointerEvents = '';
    anchor.style.height = '';
    anchor.style.width = '';
    anchor.style.overflow = '';
    delete anchor.dataset.raCompactAnchor;
  });

  resetCompactWindowVisibility();
  const windowNode = getMainWindowNode();
  if (windowNode) {
    windowNode.style.transformOrigin = '';
    windowNode.style.transform = '';
    windowNode.style.pointerEvents = '';
    windowNode.style.left = '';
    windowNode.style.top = '';
  }
};

const isWindowShaded = () => {
  const mainWindow = getMainWindowNode();
  if (!mainWindow) return true;
  const rect = mainWindow.getBoundingClientRect();
  return rect.height <= 40;
};

const setMainWindowShadeMode = (shaded: boolean) => {
  const toggleBtn = document.querySelector('[title="Toggle Windowshade Mode"]') as HTMLElement | null;
  if (!toggleBtn) return;
  const current = isWindowShaded();
  if (current === shaded) return;
  toggleBtn.click();
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
  const webampRef = useRef<WebampInstance | null>(null);
  const syncPauseUntilRef = useRef(0);
  const suppressTrackSyncUntilRef = useRef(0);
  const retryDelayRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const playablePlaylistRef = useRef<StationLite[]>([]);
  const stationByTrackUrlRef = useRef<Map<string, StationLite>>(new Map());
  const stationByTrackTitleRef = useRef<Map<string, StationLite>>(new Map());
  const lastPlaylistSignatureRef = useRef('');
  const currentTrackIndexRef = useRef<number | null>(null);

  const [webampReady, setWebampReady] = useState(false);
  const [webampFailed, setWebampFailed] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootCycle, setBootCycle] = useState(0);
  const modeSwitchUntilRef = useRef(0);
  const compactSettledRef = useRef(false);

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
    playablePlaylistRef.current = playablePlaylist;
  }, [playablePlaylist]);

  useEffect(() => {
    const byUrl = stationByTrackUrlRef.current;
    const byTitle = stationByTrackTitleRef.current;
    byUrl.clear();
    byTitle.clear();

    playablePlaylist.forEach((station) => {
      if (!station.url_resolved) return;
      byUrl.set(normalizeTrackUrl(station.url_resolved), station);
      byUrl.set(canonicalTrackUrl(station.url_resolved), station);
      byTitle.set(station.name.trim().toLowerCase(), station);
    });
  }, [playablePlaylist]);

  useEffect(() => {
    return () => {
      stationByTrackUrlRef.current.clear();
      stationByTrackTitleRef.current.clear();
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
    const mountNode = compactHostRef.current;
    if (!mountNode) return;

    let cancelled = false;
    let mountedInstance: WebampInstance | null = null;

    if (webampRef.current) {
      try {
        webampRef.current.stop();
      } catch {
        // ignore
      }
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
        const layoutModes = [true, false];
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
              zIndex: 140,
              ...(useLayout ? { windowLayout: buildPersistentLayout() } : {})
            });

            await instance.renderWhenReady(mountNode);
            if (cancelled) {
              try {
                instance.stop();
              } catch {
                // ignore
              }
              instance.dispose();
              return;
            }

            mountedInstance = instance;
            webampRef.current = instance;
            lastPlaylistSignatureRef.current = '';
            currentTrackIndexRef.current = null;
            instance.setVolume(Math.round(player.volume * 100));

            modeSwitchUntilRef.current = Date.now() + 1200;
            compactSettledRef.current = false;
            if (winamp.expanded) {
              resetWebampWindowPlacement();
              resetCompactWindowVisibility();
              window.setTimeout(() => setMainWindowShadeMode(false), 120);
            } else {
              let placementAttempt = 0;
              const ensureCompactPlacement = () => {
                if (cancelled) return;
                setMainWindowShadeMode(true);
                syncCompactWindowPlacement(mountNode, true);
                placementAttempt += 1;
                if (placementAttempt < 10) {
                  window.setTimeout(ensureCompactPlacement, 180);
                }
              };
              window.setTimeout(ensureCompactPlacement, 80);
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

        await new Promise((resolve) => window.setTimeout(resolve, 200 * (attempt + 1)));
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
          mountedInstance.stop();
        } catch {
          // ignore
        }
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
  }, [bootCycle]);

  useEffect(() => {
    if (!webampReady) return;
    modeSwitchUntilRef.current = Date.now() + 1400;
    if (winamp.expanded) {
      const mountNode = compactHostRef.current;
      if (mountNode) {
        mountNode.style.height = '100%';
      }
      compactSettledRef.current = false;
      resetWebampWindowPlacement();
      resetCompactWindowVisibility();
      window.setTimeout(() => {
        setMainWindowShadeMode(false);
      }, 80);
      return;
    }

    const mountNode = compactHostRef.current;
    if (!mountNode) return;
    compactSettledRef.current = false;
    setMainWindowShadeMode(true);
    syncCompactWindowPlacement(mountNode, true);
  }, [winamp.expanded, webampReady]);

  useEffect(() => {
    if (winamp.expanded || !webampReady) return;
    const mountNode = compactHostRef.current;
    if (!mountNode) return;

    const sync = () => {
      let forceStrip = false;
      if (!compactSettledRef.current) {
        const mainWindow = getMainWindowNode();
        const mainHeight = mainWindow?.getBoundingClientRect().height ?? 0;
        if (mainHeight > 64) {
          mountNode.style.height = '28px';
          setMainWindowShadeMode(true);
          forceStrip = true;
        }
        if (mainHeight > 0) {
          compactSettledRef.current = mainHeight <= 64;
        }
      }
      syncCompactWindowPlacement(mountNode, forceStrip);
    };
    sync();
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    const interval = window.setInterval(sync, 300);
    return () => {
      window.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
      window.clearInterval(interval);
    };
  }, [winamp.expanded, webampReady]);

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

    const signature = tracks
      .map((track) => `${track.url}::${track.metaData.title}`)
      .join('|');
    if (signature === lastPlaylistSignatureRef.current) return;

    try {
      instance.setTracksToPlay(tracks);
      lastPlaylistSignatureRef.current = signature;
      currentTrackIndexRef.current = null;
    } catch {
      // ignore
    }
  }, [webampReady, playablePlaylist]);

  useEffect(() => {
    const instance = webampRef.current;
    if (!instance || !webampReady) return;

    try {
      const currentId = current?.stationuuid;
      if (currentId) {
        const index = playablePlaylist.findIndex((item) => item.stationuuid === currentId);
        if (index >= 0 && currentTrackIndexRef.current !== index) {
          currentTrackIndexRef.current = index;
          suppressTrackSyncUntilRef.current = Date.now() + 700;
          instance.setCurrentTrack(index);
        }
      } else {
        currentTrackIndexRef.current = null;
      }

      syncPauseUntilRef.current = Date.now() + 500;
      if (!current || !player.isPlaying) {
        instance.pause();
      } else {
        instance.play();
      }
    } catch {
      // ignore
    }
  }, [webampReady, playablePlaylist, current?.stationuuid, player.isPlaying]);

  useEffect(() => {
    const instance = webampRef.current;
    if (!instance || !webampReady) return;

    try {
      instance.setVolume(Math.round(clamp(player.volume, 0, 1) * 100));
    } catch {
      // ignore
    }
  }, [player.volume, webampReady]);

  useEffect(() => {
    const instance = webampRef.current;
    if (!instance || !webampReady) return;

    const applyTrack = (trackInfo: { url: string; metaData?: { title?: string } }) => {
      if (Date.now() < modeSwitchUntilRef.current) return;
      const byUrl = stationByTrackUrlRef.current;
      const byTitle = stationByTrackTitleRef.current;
      const byTrackUrl =
        byUrl.get(normalizeTrackUrl(trackInfo.url)) ??
        byUrl.get(canonicalTrackUrl(trackInfo.url));
      const titleKey = trackInfo.metaData?.title?.trim().toLowerCase();
      const target = byTrackUrl ?? (titleKey ? byTitle.get(titleKey) : undefined);
      if (!target) return;

      const index = playablePlaylistRef.current.findIndex(
        (item) => item.stationuuid === target.stationuuid
      );
      if (index >= 0) {
        currentTrackIndexRef.current = index;
      }

      if (player.current?.stationuuid === target.stationuuid) {
        if (!player.isPlaying) {
          syncPauseUntilRef.current = Date.now() + 360;
          player.toggle();
        }
        return;
      }
      playStation(target);
    };

    const unsubscribeTrack = instance.onTrackDidChange((trackInfo) => {
      if (!trackInfo || Date.now() < suppressTrackSyncUntilRef.current) return;
      applyTrack(trackInfo);
    });

    let previousStatus = normalizeMediaStatus(instance.getMediaStatus());
    const statusTick = window.setInterval(() => {
      if (Date.now() < modeSwitchUntilRef.current) return;
      const nextStatus = normalizeMediaStatus(instance.getMediaStatus());
      if (nextStatus === previousStatus) return;
      previousStatus = nextStatus;
      if (Date.now() < syncPauseUntilRef.current) return;

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
    }, 420);

    return () => {
      unsubscribeTrack?.();
      window.clearInterval(statusTick);
    };
  }, [webampReady, playStation, playLast, canResume, player.current?.stationuuid, player.isPlaying]);

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
      <div className={`winamp-compact ${winamp.expanded ? 'expanded-host' : ''}`}>
        {!winamp.expanded ? actionStrip('compact') : null}
        <div className="winamp-compact-main">
          <div className="winamp-host compact" ref={compactHostRef} />
          {!webampReady && !winamp.expanded && (
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

      <WinampOverlay
        open={winamp.expanded}
        onCollapse={() => winamp.setExpanded(false)}
        footerActions={actionStrip('overlay')}
      >
        <div className="winamp-host overlay" />
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
