import { useEffect, useMemo, useRef, useState } from 'react';
import type { StationLite } from '../types';
import { stationLocation } from '../lib/stationUtils';
import { useRadio } from '../state/RadioContext';

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
  appendTracks?: (tracks: WebampTrack[]) => void;
  setTracksToPlay?: (tracks: WebampTrack[]) => void;
  previousTrack?: () => void;
  nextTrack?: () => void;
  play?: () => Promise<void> | void;
  pause?: () => void;
  stop?: () => void;
  getMediaStatus?: () => string;
  onTrackDidChange?: (
    cb: (trackInfo: { url: string; metaData?: { title?: string } } | null) => void
  ) => () => void;
  onWillClose?: (cb: (cancel: () => void) => void) => () => void;
  onClose?: (cb: () => void) => () => void;
};

type WebampCtor = new (options: Record<string, unknown>) => WebampInstance;
type CompactViewMode = 'strip' | 'panel';

let webampCtorPromise: Promise<WebampCtor> | null = null;
const MAIN_WINDOW_WIDTH = 275;
const SHADED_WINDOW_HEIGHT = 28;
const FULL_WINDOW_HEIGHT = 116;
const STRIP_COMPACT_MIN_HEIGHT = 44;
const STRIP_COMPACT_MAX_HEIGHT = 62;
const PANEL_COMPACT_MIN_HEIGHT = 96;
const PANEL_COMPACT_MAX_HEIGHT = 196;

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
const toAssetUrl = (value: string) => {
  try {
    return new URL(value, window.location.origin).toString();
  } catch {
    return value;
  }
};

const buildTracks = (playlist: StationLite[]): WebampTrack[] =>
  playlist.map((station) => ({
    url: station.url_resolved || '',
    metaData: {
      title: station.name,
      artist: stationLocation(station)
    }
  }));

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

const getWebampRootNode = () => document.getElementById('webamp') as HTMLElement | null;
const getWindowById = (id: string) =>
  (document.querySelector(`#${id}`)?.closest('.window') as HTMLElement | null) ?? null;

const resolveWindowAnchor = (windowNode: HTMLElement) => {
  const webampRoot = getWebampRootNode();
  let anchor = windowNode.parentElement as HTMLElement | null;
  let current = anchor;

  while (current && current !== webampRoot) {
    const computed = window.getComputedStyle(current);
    if (
      computed.position === 'absolute' ||
      computed.position === 'fixed' ||
      current.style.transform
    ) {
      anchor = current;
    }
    current = current.parentElement as HTMLElement | null;
  }

  return anchor;
};

const resetIntermediateAnchors = (windowNode: HTMLElement, anchor: HTMLElement) => {
  let current = windowNode.parentElement as HTMLElement | null;
  while (current && current !== anchor) {
    current.style.position = 'absolute';
    current.style.inset = '';
    current.style.left = '0px';
    current.style.top = '0px';
    current.style.transformOrigin = 'top left';
    current.style.transform = '';
    current.style.zIndex = '';
    current.style.pointerEvents = 'none';
    current.dataset.raExpandedAnchor = '1';
    current = current.parentElement as HTMLElement | null;
  }
};

const placeWindowAnchor = (windowNode: HTMLElement, left: number, top: number, zOrder: number) => {
  const anchor = resolveWindowAnchor(windowNode);
  if (!anchor) return;
  resetIntermediateAnchors(windowNode, anchor);

  anchor.style.position = 'absolute';
  anchor.style.inset = '';
  anchor.style.left = '0px';
  anchor.style.top = '0px';
  anchor.style.transformOrigin = 'top left';
  anchor.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  anchor.style.zIndex = String(1650 + zOrder);
  anchor.style.pointerEvents = 'none';
  anchor.dataset.raExpandedAnchor = '1';

  windowNode.style.left = '0px';
  windowNode.style.top = '0px';
  windowNode.style.transform = '';
  windowNode.style.pointerEvents = 'auto';
};

const syncExpandedWindowPlacement = () => {
  const mainWindow = getWindowById('main-window');
  if (!mainWindow) return false;
  const equalizerWindow = getWindowById('equalizer-window');
  const playlistWindow = getWindowById('playlist-window');

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const headerRect = (
    document.querySelector('.winamp-overlay-header') as HTMLElement | null
  )?.getBoundingClientRect();
  const footerRect = (
    document.querySelector('.winamp-overlay-footer') as HTMLElement | null
  )?.getBoundingClientRect();
  const availableTop = Math.max(6, Math.round((headerRect?.bottom ?? 0) + 8));
  const availableBottom = Math.max(
    availableTop + 140,
    Math.round((footerRect?.top ?? viewportHeight) - 8)
  );

  const mainRect = mainWindow.getBoundingClientRect();
  const eqRect = equalizerWindow?.getBoundingClientRect();
  const playlistRect = playlistWindow?.getBoundingClientRect();
  const mainWidth = Math.max(mainRect.width, MAIN_WINDOW_WIDTH);
  const mainHeight = Math.max(mainRect.height, FULL_WINDOW_HEIGHT);
  const eqWidth = equalizerWindow ? Math.max(eqRect?.width ?? 0, MAIN_WINDOW_WIDTH) : 0;
  const eqHeight = equalizerWindow ? Math.max(eqRect?.height ?? 0, FULL_WINDOW_HEIGHT) : 0;
  const playlistWidth = playlistWindow ? Math.max(playlistRect?.width ?? 0, MAIN_WINDOW_WIDTH) : 0;
  const playlistHeight = playlistWindow ? Math.max(playlistRect?.height ?? 0, 220) : 0;

  const gap = 6;
  const totalHeight =
    mainHeight +
    (equalizerWindow ? gap + eqHeight : 0) +
    (playlistWindow ? gap + playlistHeight : 0);
  const stackWidth = Math.max(mainWidth, eqWidth, playlistWidth);

  let stackTop = availableTop;
  const overflow = stackTop + totalHeight - availableBottom;
  if (overflow > 0) {
    stackTop = Math.max(6, stackTop - overflow);
  }
  const stackLeft = Math.max(6, Math.round((viewportWidth - stackWidth) / 2));

  let cursor = stackTop;
  placeWindowAnchor(mainWindow, stackLeft, cursor, 1);
  cursor += mainHeight;

  if (equalizerWindow) {
    cursor += gap;
    placeWindowAnchor(equalizerWindow, stackLeft, cursor, 2);
    cursor += eqHeight;
  }

  if (playlistWindow) {
    cursor += gap;
    placeWindowAnchor(playlistWindow, stackLeft, cursor, 3);
  }
  return true;
};

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

const syncCompactWindowPlacement = (mountNode: HTMLElement, viewMode: CompactViewMode) => {
  const windowNode = getMainWindowNode();
  const anchor = windowNode?.parentElement as HTMLElement | null;
  if (!windowNode || !anchor) return false;

  setMainWindowShadeMode(viewMode === 'strip');
  enforceCompactWindowVisibility();
  const mountRect = mountNode.getBoundingClientRect();
  windowNode.style.transformOrigin = 'top left';
  windowNode.style.transform = '';
  windowNode.style.left = '0px';
  windowNode.style.top = '0px';
  const rawRect = windowNode.getBoundingClientRect();
  const baseWidth = rawRect.width || MAIN_WINDOW_WIDTH;
  const measuredHeight = rawRect.height || SHADED_WINDOW_HEIGHT;
  const baseHeight = measuredHeight;
  const fitScale = clamp((mountRect.width - 8) / baseWidth, 1, 3.6);
  const nextScale = Number(fitScale.toFixed(3));
  const nextWidth = baseWidth * nextScale;
  const rawHeight = Math.max(18, Math.round(baseHeight * nextScale));
  const hostRect = mountNode.getBoundingClientRect();
  const left = hostRect.left + Math.max(0, (hostRect.width - nextWidth) / 2);
  const actionsNode = document.querySelector('.winamp-actions.compact') as HTMLElement | null;
  const actionsRect = actionsNode?.getBoundingClientRect();
  const trackLineNode = document.querySelector('.winamp-trackline.compact') as HTMLElement | null;
  const trackLineRect = trackLineNode?.getBoundingClientRect();
  const navNode = document.querySelector('.bottom-nav') as HTMLElement | null;
  const navRect = navNode?.getBoundingClientRect();
  const minTop = Math.max(
    hostRect.top,
    (actionsRect?.bottom ?? hostRect.top) + 8,
    trackLineRect ? trackLineRect.bottom + 6 : hostRect.top
  );
  const maxBottom = navRect ? navRect.top - 4 : hostRect.bottom;
  const availableHeight = Math.max(STRIP_COMPACT_MIN_HEIGHT, Math.round(maxBottom - minTop));
  const compactHeight =
    viewMode === 'panel'
      ? clamp(
          Math.min(rawHeight, availableHeight),
          Math.min(PANEL_COMPACT_MIN_HEIGHT, availableHeight),
          Math.min(PANEL_COMPACT_MAX_HEIGHT, availableHeight)
        )
      : clamp(
          Math.min(rawHeight, availableHeight),
          STRIP_COMPACT_MIN_HEIGHT,
          STRIP_COMPACT_MAX_HEIGHT
        );
  mountNode.style.height = `${compactHeight}px`;
  let top = Math.max(hostRect.top, minTop);

  anchor.style.position = 'fixed';
  anchor.style.inset = '0 auto auto 0';
  anchor.style.zIndex = '58';
  anchor.style.pointerEvents = 'none';
  anchor.style.overflow = 'hidden';
  anchor.dataset.raCompactAnchor = '1';
  windowNode.style.pointerEvents = 'auto';
  windowNode.style.transform = `scale(${nextScale})`;
  const placedRect = windowNode.getBoundingClientRect();
  const adjustDown = Math.max(0, minTop - placedRect.top);
  const adjustUp = Math.max(0, placedRect.bottom - maxBottom);
  if (adjustDown > 0 || adjustUp > 0) {
    top = top + adjustDown - adjustUp;
  }

  const finalLeft = Math.round(left);
  const finalTop = Math.round(top);
  const finalWidth = Math.round(nextWidth);
  const finalHeight = Math.round(compactHeight);
  const prevLeft = Number(anchor.dataset.raCompactLeft ?? Number.NaN);
  const prevTop = Number(anchor.dataset.raCompactTop ?? Number.NaN);
  const prevWidth = Number(anchor.dataset.raCompactWidth ?? Number.NaN);
  const prevHeight = Number(anchor.dataset.raCompactHeight ?? Number.NaN);
  const changed =
    !Number.isFinite(prevLeft) ||
    !Number.isFinite(prevTop) ||
    !Number.isFinite(prevWidth) ||
    !Number.isFinite(prevHeight) ||
    Math.abs(prevLeft - finalLeft) > 1 ||
    Math.abs(prevTop - finalTop) > 1 ||
    Math.abs(prevWidth - finalWidth) > 1 ||
    Math.abs(prevHeight - finalHeight) > 1;
  if (changed) {
    anchor.style.transform = `translate(${finalLeft}px, ${finalTop}px)`;
    anchor.style.height = `${finalHeight}px`;
    anchor.style.width = `${finalWidth}px`;
    anchor.dataset.raCompactLeft = String(finalLeft);
    anchor.dataset.raCompactTop = String(finalTop);
    anchor.dataset.raCompactWidth = String(finalWidth);
    anchor.dataset.raCompactHeight = String(finalHeight);
  }

  return true;
};

const resetWebampWindowPlacement = () => {
  const anchors = document.querySelectorAll<HTMLElement>(
    '[data-ra-compact-anchor="1"], [data-ra-expanded-anchor="1"]'
  );
  anchors.forEach((anchor) => {
    anchor.style.position = '';
    anchor.style.inset = '';
    anchor.style.transform = '';
    anchor.style.zIndex = '';
    anchor.style.pointerEvents = '';
    anchor.style.height = '';
    anchor.style.width = '';
    anchor.style.overflow = '';
    anchor.style.left = '';
    anchor.style.top = '';
    anchor.style.transformOrigin = '';
    delete anchor.dataset.raCompactAnchor;
    delete anchor.dataset.raCompactLeft;
    delete anchor.dataset.raCompactTop;
    delete anchor.dataset.raCompactWidth;
    delete anchor.dataset.raCompactHeight;
    delete anchor.dataset.raExpandedAnchor;
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

  const webampRoot = getWebampRootNode();
  if (webampRoot?.dataset.raExpandedRoot === '1') {
    webampRoot.style.position = '';
    webampRoot.style.inset = '';
    webampRoot.style.left = '';
    webampRoot.style.top = '';
    webampRoot.style.transform = '';
    webampRoot.style.width = '';
    webampRoot.style.height = '';
    webampRoot.style.pointerEvents = '';
    delete webampRoot.dataset.raExpandedRoot;
  }
};

const isWindowShaded = () => {
  const mainWindow = getMainWindowNode();
  if (!mainWindow) return true;
  if (mainWindow.classList.contains('shade')) return true;
  const mainContent = mainWindow.querySelector('#main-window') as HTMLElement | null;
  if (mainContent?.classList.contains('shade')) return true;
  const rect = mainWindow.getBoundingClientRect();
  return rect.height <= 40;
};

const setMainWindowShadeMode = (shaded: boolean) => {
  const mainWindow = getMainWindowNode();
  if (!mainWindow) return;
  const current = isWindowShaded();
  if (current === shaded) return;
  const toggleBtn = document.querySelector('[title="Toggle Windowshade Mode"]') as HTMLElement | null;
  if (toggleBtn) {
    toggleBtn.click();
  }
  if (isWindowShaded() !== shaded) {
    mainWindow.classList.toggle('shade', shaded);
  }
};

const isWindowVisible = (id: string) => {
  const node = getWindowById(id);
  if (!node) return false;
  const style = window.getComputedStyle(node);
  const rect = node.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 8 && rect.height > 8;
};

const ensureWindowVisible = (id: string, toggleTitle: string) => {
  if (isWindowVisible(id)) return;
  const toggle = document.querySelector(`[title="${toggleTitle}"]`) as HTMLElement | null;
  if (!toggle) return;

  const now = Date.now();
  const last = Number(toggle.dataset.raForceOpenAt || '0');
  if (now - last < 420) return;
  toggle.dataset.raForceOpenAt = String(now);
  toggle.click();
};

const ensureExpandedWindowsVisible = () => {
  setMainWindowShadeMode(false);
  ensureWindowVisible('equalizer-window', 'Toggle Graphical Equalizer');
  ensureWindowVisible('playlist-window', 'Toggle Playlist Editor');
  setMainWindowShadeMode(false);
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

  const [webampReady, setWebampReady] = useState(false);
  const [webampFailed, setWebampFailed] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootCycle, setBootCycle] = useState(0);
  const modeSwitchUntilRef = useRef(0);
  const compactViewModeRef = useRef<CompactViewMode>('strip');
  const expandedRef = useRef(winamp.expanded);

  const current = player.current;

  useEffect(() => {
    expandedRef.current = winamp.expanded;
  }, [winamp.expanded]);

  const requestExpand = () => {
    winamp.setExpanded(true);
    window.setTimeout(() => {
      if (!expandedRef.current) {
        winamp.setExpanded(true);
      }
    }, 160);
  };

  useEffect(() => {
    const onShadeToggleStart = (event: Event) => {
      if (expandedRef.current) return;
      const shell = document.querySelector('.winamp-compact') as HTMLElement | null;
      if (!shell || shell.classList.contains('expanded-host')) return;
      const target = event.target as HTMLElement | null;
      const shadeToggle = target?.closest('[title="Toggle Windowshade Mode"]');
      if (!shadeToggle) return;
      event.preventDefault();
      event.stopPropagation();
      compactViewModeRef.current = compactViewModeRef.current === 'strip' ? 'panel' : 'strip';
      const mountNode = compactHostRef.current;
      if (!mountNode) return;
      mountNode.dataset.raCompactView = compactViewModeRef.current;
      syncCompactWindowPlacement(mountNode, compactViewModeRef.current);
      window.setTimeout(() => {
        syncCompactWindowPlacement(mountNode, compactViewModeRef.current);
      }, 120);
    };
    document.addEventListener('mousedown', onShadeToggleStart, true);
    document.addEventListener('touchstart', onShadeToggleStart, true);
    return () => {
      document.removeEventListener('mousedown', onShadeToggleStart, true);
      document.removeEventListener('touchstart', onShadeToggleStart, true);
    };
  }, []);

  const applyExpandedLayout = (mountNode: HTMLElement) => {
    mountNode.style.height = '100%';
    mountNode.style.minHeight = `${FULL_WINDOW_HEIGHT}px`;
    resetWebampWindowPlacement();
    resetCompactWindowVisibility();
    const webampRoot = getWebampRootNode();
    if (webampRoot) {
      webampRoot.style.position = 'fixed';
      webampRoot.style.inset = '0 auto auto 0';
      webampRoot.style.left = '0';
      webampRoot.style.top = '0';
      webampRoot.style.transform = '';
      webampRoot.style.width = '100%';
      webampRoot.style.height = '100%';
      webampRoot.style.pointerEvents = 'none';
      webampRoot.dataset.raExpandedRoot = '1';
    }
    window.setTimeout(() => {
      ensureExpandedWindowsVisible();
      syncExpandedWindowPlacement();
    }, 80);
    window.setTimeout(() => {
      ensureExpandedWindowsVisible();
      syncExpandedWindowPlacement();
    }, 260);
  };

  const applyCompactLayout = (mountNode: HTMLElement) => {
    mountNode.style.minHeight = '';
    resetWebampWindowPlacement();
    const mode = compactViewModeRef.current;
    mountNode.dataset.raCompactView = mode;
    mountNode.style.height =
      mode === 'panel' ? `${PANEL_COMPACT_MIN_HEIGHT}px` : `${STRIP_COMPACT_MIN_HEIGHT}px`;
    syncCompactWindowPlacement(mountNode, mode);
  };

  const effectivePlaylist = useMemo(() => {
    const merged: StationLite[] = [];
    const seen = new Set<string>();

    const addStation = (station: StationLite | null) => {
      if (!station || seen.has(station.stationuuid)) return;
      seen.add(station.stationuuid);
      merged.push(station);
    };

    winamp.playlist.forEach(addStation);
    if (!merged.length) {
      addStation(current);
    }
    return merged;
  }, [winamp.playlist, current]);

  const playablePlaylist = useMemo(
    () => effectivePlaylist.filter((station) => Boolean(station.url_resolved)),
    [effectivePlaylist]
  );

  const liked = current ? isFavorite(current.stationuuid) : false;
  const canResume = Boolean(recent.length);
  const trackTitle = nowPlaying?.trim() || '';
  const canCopyTrackTitle = Boolean(trackTitle);

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
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
    };
  }, [winamp.expanded]);

  useEffect(() => {
    const mountNode = compactHostRef.current;
    if (!mountNode) return;

    let cancelled = false;
    let mountedInstance: WebampInstance | null = null;
    let unsubscribeWillClose: (() => void) | null = null;
    let unsubscribeClosed: (() => void) | null = null;

    if (webampRef.current) {
      try {
        webampRef.current.stop?.();
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
                url: toAssetUrl(winamp.activeSkin.url)
              },
              availableSkins: winamp.availableSkins.map((skin) => ({
                name: skin.name,
                url: toAssetUrl(skin.url)
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
                instance.stop?.();
              } catch {
                // ignore
              }
              instance.dispose();
              return;
            }

            mountedInstance = instance;
            webampRef.current = instance;
            unsubscribeWillClose = instance.onWillClose?.((cancel) => cancel()) ?? null;
            unsubscribeClosed = instance.onClose?.(() => {
              if (!cancelled) {
                setBootCycle((value) => value + 1);
              }
            }) ?? null;
            suppressTrackSyncUntilRef.current = Date.now() + 1200;
            syncPauseUntilRef.current = Date.now() + 1200;

            modeSwitchUntilRef.current = Date.now() + 1200;
            compactViewModeRef.current = 'strip';
            if (expandedRef.current) {
              applyExpandedLayout(mountNode);
            } else {
              let placementAttempt = 0;
              const ensureCompactPlacement = () => {
                if (cancelled) return;
                applyCompactLayout(mountNode);
                placementAttempt += 1;
                if (placementAttempt < 6) {
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
      unsubscribeWillClose?.();
      unsubscribeClosed?.();
      if (mountedInstance) {
        try {
          mountedInstance.stop?.();
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
  }, [bootCycle, winamp.activeSkin.url]);

  useEffect(() => {
    if (!webampReady) return;
    modeSwitchUntilRef.current = Date.now() + 1400;
    const mountNode = compactHostRef.current;
    if (!mountNode) return;
    if (winamp.expanded) {
      applyExpandedLayout(mountNode);
      return;
    }
    applyCompactLayout(mountNode);
  }, [winamp.expanded, webampReady]);

  useEffect(() => {
    if (winamp.expanded || !webampReady) return;
    const mountNode = compactHostRef.current;
    if (!mountNode) return;

    const sync = () => {
      syncCompactWindowPlacement(mountNode, compactViewModeRef.current);
    };
    sync();
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    const lateSyncA = window.setTimeout(sync, 320);
    const lateSyncB = window.setTimeout(sync, 900);
    return () => {
      window.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
      window.clearTimeout(lateSyncA);
      window.clearTimeout(lateSyncB);
    };
  }, [winamp.expanded, webampReady]);

  useEffect(() => {
    if (!winamp.expanded || !webampReady) return;
    const sync = () => {
      ensureExpandedWindowsVisible();
      resetCompactWindowVisibility();
      syncExpandedWindowPlacement();
    };
    sync();
    const interval = window.setInterval(sync, 280);
    window.addEventListener('resize', sync);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('resize', sync);
    };
  }, [winamp.expanded, webampReady]);

  useEffect(() => {
    const instance = webampRef.current;
    if (!instance || !webampReady) return;

    const quietWebamp = () => {
      syncPauseUntilRef.current = Date.now() + 700;
      try {
        instance.pause?.();
      } catch {
        // ignore
      }
      try {
        instance.stop?.();
      } catch {
        // ignore
      }
    };

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
      if (player.current?.stationuuid && target.stationuuid !== player.current.stationuuid) {
        quietWebamp();
        playStation(target);
        return;
      }

      if (player.current?.stationuuid === target.stationuuid) {
        if (!player.isPlaying) {
          void player.toggle();
        }
        quietWebamp();
        return;
      }
      quietWebamp();
      playStation(target);
    };

    const unsubscribeTrack = instance.onTrackDidChange?.((trackInfo) => {
      if (!trackInfo || Date.now() < suppressTrackSyncUntilRef.current) return;
      applyTrack(trackInfo);
    });

    let previousStatus = normalizeMediaStatus(instance.getMediaStatus?.() ?? 'STOPPED');
    const statusTick = window.setInterval(() => {
      if (Date.now() < modeSwitchUntilRef.current) return;
      const nextStatus = normalizeMediaStatus(instance.getMediaStatus?.() ?? 'STOPPED');
      if (nextStatus === previousStatus) return;
      previousStatus = nextStatus;
      if (Date.now() < syncPauseUntilRef.current) return;

      if (nextStatus === 'PLAYING') {
        if (player.current) {
          if (!player.isPlaying) {
            void player.toggle();
          }
        } else if (playablePlaylistRef.current.length) {
          playStation(playablePlaylistRef.current[0]);
        } else if (canResume) {
          playLast();
        }
        quietWebamp();
      }
    }, 420);

    return () => {
      unsubscribeTrack?.();
      window.clearInterval(statusTick);
    };
  }, [webampReady, playStation, playLast, canResume, player.current?.stationuuid, player.isPlaying]);

  const actionStrip = (variant: 'compact' | 'overlay') => (
    <div className={`winamp-actions ${variant}`}>
      <button
        className={`chip ${current && player.isPlaying ? 'active' : ''}`}
        type="button"
        onClick={() => {
          if (current) {
            void player.toggle();
            return;
          }
          playLast();
        }}
        disabled={!current && !canResume}
      >
        {current ? (player.isPlaying ? 'Pause' : 'Play') : 'Resume'}
      </button>

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

      <button className="chip" type="button" onClick={copyTrack} disabled={!canCopyTrackTitle}>
        Song
      </button>

    </div>
  );

  const trackLine = (variant: 'compact' | 'overlay') => (
    <button
      className={`winamp-trackline ${variant}`}
      type="button"
      onClick={copyTrack}
      disabled={!canCopyTrackTitle}
      title={canCopyTrackTitle ? 'Copy track title' : 'Track title unavailable'}
      aria-label={canCopyTrackTitle ? `Copy track title: ${trackTitle}` : 'Track title unavailable'}
    >
      <span className="winamp-trackline-label">
        {canCopyTrackTitle ? trackTitle : 'Track title unavailable'}
      </span>
    </button>
  );

  return (
    <div
      className={`winamp-compact ${winamp.expanded ? 'expanded-host' : ''}`}
      role={winamp.expanded ? 'dialog' : undefined}
      aria-modal={winamp.expanded ? 'true' : undefined}
    >
      {winamp.expanded ? (
        <>
          <div
            className="winamp-overlay-backdrop"
            aria-hidden="true"
          />
          <div className="winamp-overlay-header">
            <div className="winamp-overlay-header-actions">
              <button className="chip active" type="button" onClick={() => winamp.setExpanded(false)}>
                Collapse
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          {actionStrip('compact')}
          <button
            className="chip active winamp-expand-fab"
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
            onClick={requestExpand}
          >
            Expand
          </button>
          {canCopyTrackTitle ? trackLine('compact') : null}
        </>
      )}

      <div
        className="winamp-compact-main"
        onClick={!winamp.expanded ? requestExpand : undefined}
      >
        <div className="winamp-host compact" ref={compactHostRef} />
        {!webampReady && (
          <div className={`winamp-loading ${winamp.expanded ? 'overlay' : ''}`}>
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

      {winamp.expanded ? (
        <div className="winamp-overlay-footer">
          {trackLine('overlay')}
          {actionStrip('overlay')}
        </div>
      ) : null}
    </div>
  );
};
