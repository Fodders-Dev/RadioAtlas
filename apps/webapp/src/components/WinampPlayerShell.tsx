import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent
} from 'react';
import type { StationLite } from '../types';
import { reportClientEvent } from '../lib/observability';
import { bindWinampTransportBridge, getWebampRootNode, stopNativeEvent } from '../lib/winampBridge';
import { useLocale } from '../state/LocaleContext';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import './winampShell/winamp.css';
import {
  BOOT_WINDOW_WAIT_MS,
  COMPACT_INTERACTIVE_SELECTOR,
  EXPANDED_WINDOW_Z_ORDER,
  LIVE_STREAM_FAKE_DURATION_SECONDS,
  PANEL_COMPACT_MIN_HEIGHT,
  STRIP_COMPACT_MIN_HEIGHT,
  buildPersistentLayout,
  buildTracks,
  canonicalTrackUrl,
  clamp,
  ensureExpandedWindowsVisible,
  FULL_WINDOW_HEIGHT,
  getEqSliderValueFromBand,
  getExpandedViewportBounds,
  getMainWindowNode,
  getResponsiveExpandedMode,
  getSliderValue,
  getWindowById,
  isWindowVisible,
  isWindowVisibleInCompactHost,
  isWindowVisibleOnViewport,
  loadWebampCtor,
  measureExpandedWindowMetric,
  placeExpandedWindowAnchor,
  readExpandedAnchorTransform,
  resetCompactWindowVisibility,
  resetWebampWindowPlacement,
  setMainWindowShadeMode,
  setWindowVisibility,
  syncCompactWindowPlacement,
  toAssetUrl,
  toErrorMessage,
  toPlayerVolume,
  toWebampBalance,
  toWebampVolume,
  waitForMainWindow
} from './winampShell/runtime';
import type {
  CompactViewMode,
  ExpandedWindowId,
  ExpandedWindowMetric,
  ResponsiveExpandedMode,
  WebampInstance,
  WinampDevApi
} from './winampShell/runtime';
import {
  bootWebampInstance,
  disposeWebampInstance,
  recoverCompactWindow,
  recoverExpandedWindows,
  resetBootSurface
} from './winampShell/boot';
import { useWinampTransportSync } from './winampShell/useTransportSync';

const LazyWinampOverlay = lazy(() => import('./winampShell/WinampOverlay'));

export const WinampPlayerShell = ({
  onDetails
}: {
  onDetails?: () => void;
}) => {
  const { t } = useLocale();
  const {
    player,
    queue,
    nowPlaying,
    playPrevious,
    playNext,
    playLast,
    playStation,
    copyTrack,
    shareStation
  } = usePlayback();
  const {
    playbackHistory,
    trackHistory,
    toggleFavorite,
    isFavorite,
    hideStationFromRecommendations,
    unhideStationFromRecommendations,
    isStationHiddenFromRecommendations
  } = useLibrary();
  const { winamp, openWebAppExternally } = useShell();

  const compactHostRef = useRef<HTMLDivElement | null>(null);
  const webampRef = useRef<WebampInstance | null>(null);
  const retryDelayRef = useRef<number | null>(null);
  const expandRetryRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const playlistSignatureRef = useRef('');
  const lastAppliedVolumeRef = useRef<number | null>(null);
  const lastAppliedBalanceRef = useRef<number | null>(null);
  const lastElapsedTimeSyncRef = useRef<number | null>(null);
  const suppressVolumeSyncUntilRef = useRef(0);
  const expandedRecoveryAttemptsRef = useRef(0);
  const compactRecoveryAttemptsRef = useRef(0);
  const recoveredSkinRef = useRef<string | null>(null);
  const runtimeSkinUrlRef = useRef<string | null>(null);

  const [webampReady, setWebampReady] = useState(false);
  const [webampFailed, setWebampFailed] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootCycle, setBootCycle] = useState(0);
  const [expandedLayoutMode, setExpandedLayoutMode] = useState<ResponsiveExpandedMode>(() =>
    typeof window === 'undefined' ? 'desktop' : getResponsiveExpandedMode()
  );
  const liteFullscreenMode = winamp.expanded;
  const runtimeExpanded = winamp.expanded && !liteFullscreenMode;
  const expandedRef = useRef(runtimeExpanded);
  const figmaCaptureMode =
    typeof window !== 'undefined' && window.location.hash.includes('figmacapture=');
  const overlayScrollRestoreRef = useRef<number | null>(null);

  const current = player.current;

  useEffect(() => {
    expandedRef.current = runtimeExpanded;
    if (runtimeExpanded && expandRetryRef.current !== null) {
      window.clearTimeout(expandRetryRef.current);
      expandRetryRef.current = null;
    }
  }, [runtimeExpanded]);

  useEffect(() => {
    if (!liteFullscreenMode) return;
    reportClientEvent('winamp_safe_mode', {
      dedupeKey: `winamp_safe_mode:${current?.stationuuid || 'none'}`,
      dedupeMs: 15_000,
      meta: {
        stationId: current?.stationuuid || null
      }
    });
  }, [current?.stationuuid, liteFullscreenMode]);

  useEffect(() => {
    if (recoveredSkinRef.current !== winamp.activeSkin.url) {
      recoveredSkinRef.current = winamp.activeSkin.url;
      expandedRecoveryAttemptsRef.current = 0;
      compactRecoveryAttemptsRef.current = 0;
    }
  }, [winamp.activeSkin.url]);

  const requestExpand = () => {
    if (expandRetryRef.current !== null) {
      window.clearTimeout(expandRetryRef.current);
    }
    winamp.setExpanded(true);
    expandRetryRef.current = window.setTimeout(() => {
      expandRetryRef.current = null;
      if (!expandedRef.current) {
        winamp.setExpanded(true);
      }
    }, 160);
  };

  useEffect(() => {
    return () => {
      if (expandRetryRef.current !== null) {
        window.clearTimeout(expandRetryRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const syncMode = () => {
      setExpandedLayoutMode(getResponsiveExpandedMode());
    };
    syncMode();
    window.addEventListener('resize', syncMode);
    window.addEventListener('orientationchange', syncMode);
    return () => {
      window.removeEventListener('resize', syncMode);
      window.removeEventListener('orientationchange', syncMode);
    };
  }, []);

  useEffect(() => {
    const onShadeToggleStart = (event: Event) => {
      if (expandedRef.current) return;
      const shell = document.querySelector('.winamp-compact') as HTMLElement | null;
      if (!shell || shell.classList.contains('fullscreen-ui')) return;
      const target = event.target as HTMLElement | null;
      const webampRoot = getWebampRootNode();
      if (!target || !webampRoot?.contains(target)) return;
      const shadeToggle = target?.closest('[title="Toggle Windowshade Mode"]');
      if (!shadeToggle) return;
      stopNativeEvent(event);
      const nextMode: CompactViewMode = winamp.compactMode === 'strip' ? 'panel' : 'strip';
      winamp.setCompactMode(nextMode);
      const mountNode = compactHostRef.current;
      if (!mountNode) return;
      mountNode.dataset.raCompactView = nextMode;
      syncCompactWindowPlacement(mountNode, nextMode);
      window.setTimeout(() => {
        syncCompactWindowPlacement(mountNode, nextMode);
      }, 120);
    };
    document.addEventListener('mousedown', onShadeToggleStart, true);
    document.addEventListener('touchstart', onShadeToggleStart, true);
    return () => {
      document.removeEventListener('mousedown', onShadeToggleStart, true);
      document.removeEventListener('touchstart', onShadeToggleStart, true);
    };
  }, [winamp]);

  useEffect(() => {
    const syncCompactAfterControl = () => {
      const mountNode = compactHostRef.current;
      if (!mountNode) return;
      window.requestAnimationFrame(() => {
        if (expandedRef.current) {
          resetCompactWindowVisibility();
          syncExpandedWindowPlacement(getResponsiveExpandedMode());
        } else {
          syncCompactWindowPlacement(mountNode, winamp.compactMode);
        }
        window.setTimeout(() => {
          if (expandedRef.current) {
            resetCompactWindowVisibility();
            syncExpandedWindowPlacement(getResponsiveExpandedMode());
          } else {
            syncCompactWindowPlacement(mountNode, winamp.compactMode);
          }
        }, 90);
      });
    };
    return bindWinampTransportBridge({
      onControl: (control) => {
        if (control === 'previous') {
          playPrevious();
          syncCompactAfterControl();
          return;
        }

        if (control === 'next') {
          playNext();
          syncCompactAfterControl();
          return;
        }

        if (control === 'stop') {
          player.stop();
          syncCompactAfterControl();
          return;
        }

        if (control === 'pause') {
          if (player.current) {
            void player.toggle();
          }
          syncCompactAfterControl();
          return;
        }

        if (player.current) {
          if (!player.isPlaying) {
            void player.toggle();
          }
          syncCompactAfterControl();
          return;
        }

        const queuedStation = queue.items.find((station) => Boolean(station.url_resolved));
        if (queuedStation) {
          playStation(queuedStation);
          syncCompactAfterControl();
          return;
        }

        if (playbackHistory.length > 0 || queue.items.length > 0) {
          playLast();
          syncCompactAfterControl();
        }
      }
    });
  }, [
    playLast,
    playNext,
    playPrevious,
    playStation,
    player,
    player.current,
    player.isPlaying,
    playbackHistory.length,
    queue.items,
    queue.items.length
  ]);

  const applyExpandedLayout = (mountNode: HTMLElement) => {
    mountNode.style.height = '100%';
    mountNode.style.minHeight = `${FULL_WINDOW_HEIGHT}px`;
    resetWebampWindowPlacement();
    resetCompactWindowVisibility();
    const mode = getResponsiveExpandedMode();
    setExpandedLayoutMode(mode);
    mountNode.dataset.raExpandedMode = mode;
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
    const queueInitialPlacement = () => {
      ensureExpandedWindowsVisible(mode, true, winamp.windowVisibility);
      resetCompactWindowVisibility();
      syncExpandedWindowPlacement(mode);
    };
    window.requestAnimationFrame(queueInitialPlacement);
    window.setTimeout(queueInitialPlacement, 180);
  };

  const applyCompactLayout = (mountNode: HTMLElement) => {
    mountNode.style.minHeight = '';
    resetWebampWindowPlacement();
    const mode = winamp.compactMode;
    mountNode.dataset.raCompactView = mode;
    mountNode.style.height =
      mode === 'panel' ? `${PANEL_COMPACT_MIN_HEIGHT}px` : `${STRIP_COMPACT_MIN_HEIGHT}px`;
    syncCompactWindowPlacement(mountNode, mode);
  };

  const effectivePlaylist = useMemo(() => {
    const ordered: StationLite[] = [];
    const seen = new Set<string>();
    const pushUniqueStation = (station: StationLite | null | undefined) => {
      if (!station) return;
      if (seen.has(station.stationuuid)) return;
      seen.add(station.stationuuid);
      ordered.push(station);
    };

    // Keep currently selected station first so Webamp title/playlist reflect real playback target.
    pushUniqueStation(current);

    if (queue.items.length) {
      const indexed =
        queue.currentIndex >= 0 && queue.currentIndex < queue.items.length
          ? queue.items[queue.currentIndex]
          : null;
      pushUniqueStation(indexed);
      queue.items.forEach(pushUniqueStation);
      return ordered;
    }

    return ordered;
  }, [current, queue.items, queue.currentIndex]);

  const playablePlaylist = useMemo(
    () => effectivePlaylist.filter((station) => Boolean(station.url_resolved)),
    [effectivePlaylist]
  );
  const playlistSignature = useMemo(
    () =>
      playablePlaylist
        .map((station) => `${station.stationuuid}:${canonicalTrackUrl(station.url_resolved || '')}`)
        .join('|'),
    [playablePlaylist]
  );

  const liked = current ? isFavorite(current.stationuuid) : false;
  const stationHidden = current ? isStationHiddenFromRecommendations(current.stationuuid) : false;
  const canResume = Boolean(playbackHistory.length || queue.items.length);
  const trackTitle = nowPlaying?.trim() || '';
  const displayTrackTitle =
    trackTitle || current?.name || playablePlaylist[0]?.name || t('winamp.trackUnavailable');
  const canCopyTrackTitle = Boolean(trackTitle);
  const stopCompactInteraction = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  };
  const handleCompactMainClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (winamp.expanded) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(COMPACT_INTERACTIVE_SELECTOR)) {
      return;
    }
    requestExpand();
  };

  const syncExpandedWindowPlacement = (mode: ResponsiveExpandedMode) => {
    const mainWindow = getWindowById('main-window');
    if (!mainWindow) return false;

    const eqWindow = getWindowById('equalizer-window');
    const playlistWindow = getWindowById('playlist-window');
    const bounds = getExpandedViewportBounds();
    const mainMetric = measureExpandedWindowMetric(mainWindow);
    const eqMetric =
      eqWindow && isWindowVisible('equalizer-window')
        ? measureExpandedWindowMetric(eqWindow)
        : null;
    const playlistMetric =
      playlistWindow && isWindowVisible('playlist-window')
        ? measureExpandedWindowMetric(playlistWindow)
        : null;

    if (!mainMetric) return false;

    const gap = mode === 'mobile' ? 12 : 8;
    const placeStack = (
      metrics: ExpandedWindowMetric[],
      maxScale: number,
      verticalAlign: 'top' | 'center' = 'center',
      minScale = 1
    ) => {
      const contentWidth = Math.max(...metrics.map((metric) => metric.width));
      const contentHeight =
        metrics.reduce((total, metric) => total + metric.height, 0) +
        gap * Math.max(0, metrics.length - 1);
      const scale = clamp(
        Math.min(bounds.width / contentWidth, bounds.height / contentHeight),
        minScale,
        maxScale
      );
      const scaledHeight = contentHeight * scale;
      const topOffset =
        verticalAlign === 'top'
          ? Math.max(4, Math.round(Math.min(26, (bounds.height - scaledHeight) * 0.12)))
          : Math.max(0, Math.round((bounds.height - scaledHeight) / 2));
      let cursorY = bounds.top + topOffset;
      metrics.forEach((metric) => {
        const width = metric.width * scale;
        const height = metric.height * scale;
        const x = bounds.left + Math.max(0, Math.round((bounds.width - width) / 2));
        placeExpandedWindowAnchor(
          metric.node,
          x,
          cursorY,
          EXPANDED_WINDOW_Z_ORDER[metric.id],
          scale,
          metric.width,
          metric.height
        );
        cursorY += height + gap;
      });
    };

    if (mode === 'mobile') {
      const metrics = [
        mainMetric,
        ...(eqMetric ? [eqMetric] : []),
        ...(playlistMetric ? [playlistMetric] : [])
      ];
      placeStack(
        metrics,
        1.62,
        'top',
        1.14
      );
      return true;
    }

    const defaultLeftColumnHeight = mainMetric.height + (eqMetric ? gap + eqMetric.height : 0);
    const defaultClusterWidth =
      mainMetric.width + (playlistMetric ? gap + playlistMetric.width : 0);
    const defaultClusterHeight = Math.max(
      defaultLeftColumnHeight,
      playlistMetric?.height ?? mainMetric.height
    );
    const defaultStartX =
      bounds.left + Math.max(0, Math.round((bounds.width - defaultClusterWidth) / 2));
    const defaultStartY =
      bounds.top + Math.max(0, Math.round((bounds.height - defaultClusterHeight) / 2));

    const clampPosition = (metric: ExpandedWindowMetric, x: number, y: number) => ({
      x: clamp(Math.round(x), bounds.left, Math.max(bounds.left, bounds.right - metric.width)),
      y: clamp(Math.round(y), bounds.top, Math.max(bounds.top, bounds.bottom - metric.height))
    });

    const mainPosition = clampPosition(
      mainMetric,
      winamp.windowPositions['main-window']?.x ?? defaultStartX,
      winamp.windowPositions['main-window']?.y ?? defaultStartY
    );
    placeExpandedWindowAnchor(
      mainMetric.node,
      mainPosition.x,
      mainPosition.y,
      EXPANDED_WINDOW_Z_ORDER[mainMetric.id],
      1,
      mainMetric.width,
      mainMetric.height
    );

    if (eqMetric) {
      const eqPosition = clampPosition(
        eqMetric,
        winamp.windowPositions['equalizer-window']?.x ?? mainPosition.x,
        winamp.windowPositions['equalizer-window']?.y ??
          mainPosition.y + mainMetric.height + gap
      );
      placeExpandedWindowAnchor(
        eqMetric.node,
        eqPosition.x,
        eqPosition.y,
        EXPANDED_WINDOW_Z_ORDER[eqMetric.id],
        1,
        eqMetric.width,
        eqMetric.height
      );
    }

    if (playlistMetric) {
      const playlistPosition = clampPosition(
        playlistMetric,
        winamp.windowPositions['playlist-window']?.x ?? mainPosition.x + mainMetric.width + gap,
        winamp.windowPositions['playlist-window']?.y ?? mainPosition.y
      );
      placeExpandedWindowAnchor(
        playlistMetric.node,
        playlistPosition.x,
        playlistPosition.y,
        EXPANDED_WINDOW_Z_ORDER[playlistMetric.id],
        1,
        playlistMetric.width,
        playlistMetric.height
      );
    }
    return true;
  };

  const offsetExpandedWindow = (id: ExpandedWindowId, deltaX: number, deltaY: number) => {
    const windowNode = getWindowById(id);
    const anchor = windowNode ? resolveExpandedWindowAnchor(windowNode) : null;
    if (!windowNode || !anchor) return false;
    const { x, y, scale } = readExpandedAnchorTransform(anchor);
    const nextX = Math.round(x + deltaX);
    const nextY = Math.round(y + deltaY);
    anchor.style.transform = `translate(${nextX}px, ${nextY}px) scale(${scale})`;
    winamp.setWindowPosition(id, {
      x: nextX,
      y: nextY
    });
    return true;
  };

  const resetExpandedLayout = () => {
    if (!runtimeExpanded || !webampReady) return;
    winamp.resetLayout();
    const mode = getResponsiveExpandedMode();
    setExpandedLayoutMode(mode);
    ensureExpandedWindowsVisible(mode, true, winamp.windowVisibility);
    const sync = () => {
      resetCompactWindowVisibility();
      syncExpandedWindowPlacement(mode);
    };
    sync();
    window.requestAnimationFrame(sync);
    window.setTimeout(sync, 120);
  };

  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return;
    const hostWindow = window as typeof window & {
      __radioAtlasWinamp?: WinampDevApi;
    };
    hostWindow.__radioAtlasWinamp = {
      moveExpandedWindow: offsetExpandedWindow,
      resetExpandedLayout,
      getStoreState: () => webampRef.current?.store?.getState?.() ?? null,
      dispatchStoreAction: (action) => {
        webampRef.current?.store?.dispatch?.(action);
      }
    };
    return () => {
      delete hostWindow.__radioAtlasWinamp;
    };
  }, [resetExpandedLayout, runtimeExpanded, webampReady]);

  const syncExpandedEqStateFromDom = () => {
    const equalizerWindow = document.querySelector('#equalizer-window') as HTMLElement | null;
    if (!equalizerWindow || !isWindowVisible('equalizer-window')) return;

    const enabled =
      (equalizerWindow.querySelector('#on') as HTMLElement | null)?.classList.contains('selected') ??
      true;
    if (player.eq.enabled !== enabled) {
      player.setEqEnabled(enabled);
    }

    const nextPreamp = getEqSliderValueFromBand(equalizerWindow.querySelector('#preamp'));
    if (Math.abs(player.eq.preamp - nextPreamp) > 0.5) {
      player.setEqPreamp(nextPreamp);
    }

    EQ_BANDS.forEach((band, index) => {
      const nextValue = getEqSliderValueFromBand(
        equalizerWindow.querySelector(`#band-${band}`)
      );
      if (Math.abs((player.eq.bands[index] ?? 50) - nextValue) > 0.5) {
        player.setEqBand(index, nextValue);
      }
    });
  };

  useEffect(() => {
    if (!winamp.expanded) return;
    const previousOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    const restoreScroll =
      overlayScrollRestoreRef.current === null ? window.scrollY : overlayScrollRestoreRef.current;
    overlayScrollRestoreRef.current = restoreScroll;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    return () => {
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      if (overlayScrollRestoreRef.current !== null) {
        window.scrollTo({ top: overlayScrollRestoreRef.current, left: 0, behavior: 'auto' });
        overlayScrollRestoreRef.current = null;
      }
    };
  }, [winamp.expanded]);

  useEffect(() => {
    const mountNode = compactHostRef.current;
    if (!mountNode) return;

    if (figmaCaptureMode || liteFullscreenMode) {
      resetBootSurface({
        mountNode,
        setBootError,
        setWebampFailed,
        setWebampReady
      });
      if (liteFullscreenMode) {
        setBootError(null);
        setWebampFailed(false);
        setWebampReady(false);
      }
      return;
    }

    let cancelled = false;
    let mountedInstance: WebampInstance | null = null;
    let unsubscribeWillClose: (() => void) | null = null;
    let unsubscribeClosed: (() => void) | null = null;

    if (webampRef.current) {
      disposeWebampInstance(webampRef.current);
      webampRef.current = null;
    }

    resetBootSurface({
      mountNode,
      setBootError,
      setWebampFailed,
      setWebampReady
    });

    const boot = async () => {
      try {
        const result = await bootWebampInstance({
          activeSkinUrl: winamp.activeSkin.url,
          applyCompactLayout,
          applyExpandedLayout,
          availableSkins: winamp.availableSkins,
          isCancelled: () => cancelled,
          isExpanded: () => expandedRef.current,
          mountNode,
          onClosed: () => setBootCycle((value) => value + 1),
          playablePlaylist
        });
        if (cancelled) {
          disposeWebampInstance(result.instance);
          return;
        }

        mountedInstance = result.instance;
        webampRef.current = result.instance;
        unsubscribeWillClose = result.unsubscribeWillClose;
        unsubscribeClosed = result.unsubscribeClosed;
        runtimeSkinUrlRef.current = winamp.activeSkin.url;
        setWebampReady(true);
        setWebampFailed(false);
        setBootError(null);
        retryCountRef.current = 0;
      } catch (error) {
        if (cancelled) {
          return;
        }
        setWebampFailed(true);
        const nextBootError = toErrorMessage(error);
        setBootError(nextBootError);
        reportClientEvent('webamp_boot_failed', `webamp_boot_failed:${nextBootError || 'unknown'}`);
        if (retryCountRef.current < 5) {
          retryCountRef.current += 1;
          retryDelayRef.current = window.setTimeout(() => {
            retryDelayRef.current = null;
            setBootCycle((value) => value + 1);
          }, 700 * retryCountRef.current);
        }
      }
    };

    void boot();

    return () => {
      cancelled = true;
      setWebampReady(false);
      if (retryDelayRef.current !== null) {
        window.clearTimeout(retryDelayRef.current);
        retryDelayRef.current = null;
      }
      unsubscribeWillClose?.();
      unsubscribeClosed?.();
      disposeWebampInstance(mountedInstance);
      resetWebampWindowPlacement();
      runtimeSkinUrlRef.current = null;
      if (webampRef.current === mountedInstance) {
        webampRef.current = null;
      }
    };
  }, [bootCycle, figmaCaptureMode, liteFullscreenMode]);

  useEffect(() => {
    if (!webampReady || figmaCaptureMode || liteFullscreenMode) return;
    const instance = webampRef.current;
    if (!instance) return;

    const nextSkinUrl = winamp.activeSkin.url;
    if (runtimeSkinUrlRef.current === nextSkinUrl) return;

    if (!instance.setSkinFromUrl) {
      setBootCycle((value) => value + 1);
      return;
    }

    let cancelled = false;
    const applySkin = async () => {
      try {
        await instance.setSkinFromUrl?.(toAssetUrl(nextSkinUrl));
        if (cancelled) return;
        runtimeSkinUrlRef.current = nextSkinUrl;
        setWebampFailed(false);
        setBootError(null);
      } catch (error) {
        if (cancelled) return;
        console.error('Winamp skin swap failed', error);
        setBootCycle((value) => value + 1);
      }
    };

    void applySkin();
    return () => {
      cancelled = true;
    };
  }, [figmaCaptureMode, liteFullscreenMode, webampReady, winamp.activeSkin.url]);

  useEffect(() => {
    if (!webampReady) return;
    const mountNode = compactHostRef.current;
    if (!mountNode) return;
    if (runtimeExpanded) {
      applyExpandedLayout(mountNode);
      return;
    }
    applyCompactLayout(mountNode);
  }, [runtimeExpanded, webamp.compactMode, webampReady]);

  useEffect(() => {
    if (runtimeExpanded || !webampReady) return;
    const mountNode = compactHostRef.current;
    if (!mountNode) return;

    let frameId: number | null = null;
    const observed = new Set<Element>();
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;

    const sync = () => {
      frameId = null;
      syncCompactWindowPlacement(mountNode, winamp.compactMode);
    };

    const queueSync = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(sync);
    };

    const observeNode = (node: Element | null) => {
      if (!node || observed.has(node)) return;
      observed.add(node);
      resizeObserver?.observe(node);
    };

    const attachLayoutObservers = () => {
      observeNode(mountNode);
      observeNode(document.documentElement);
      observeNode(document.body);
      observeNode(document.querySelector('.app'));
      observeNode(document.querySelector('main'));
      observeNode(document.querySelector('.winamp-compact'));
      observeNode(document.querySelector('.winamp-compact-main'));
      observeNode(document.querySelector('.bottom-nav'));
      observeNode(document.querySelector('.winamp-actions.compact'));
      observeNode(document.querySelector('.winamp-trackline.compact'));
      observeNode(getWebampRootNode());
      observeNode(getMainWindowNode());
    };

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        queueSync();
      });
      attachLayoutObservers();
    }

    if (typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(() => {
        attachLayoutObservers();
        queueSync();
      });
      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    queueSync();
    window.addEventListener('scroll', queueSync, { passive: true });
    window.addEventListener('resize', queueSync);
    const watchdogInterval = window.setInterval(queueSync, 240);
    const lateSyncA = window.setTimeout(queueSync, 120);
    const lateSyncB = window.setTimeout(queueSync, 320);
    const lateSyncC = window.setTimeout(queueSync, 760);
    const lateSyncD = window.setTimeout(queueSync, 1500);
    const lateSyncE = window.setTimeout(queueSync, 2600);
    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener('scroll', queueSync);
      window.removeEventListener('resize', queueSync);
      window.clearInterval(watchdogInterval);
      window.clearTimeout(lateSyncA);
      window.clearTimeout(lateSyncB);
      window.clearTimeout(lateSyncC);
      window.clearTimeout(lateSyncD);
      window.clearTimeout(lateSyncE);
    };
  }, [runtimeExpanded, webamp.compactMode, webampReady]);

  useEffect(() => {
    if (runtimeExpanded || !webampReady) return;
    const mountNode = compactHostRef.current;
    if (!mountNode) return;

    const sync = () => {
      syncCompactWindowPlacement(mountNode, winamp.compactMode);
    };

    sync();
    const timeoutId = window.setTimeout(sync, 90);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [current?.stationuuid, player.isPlaying, runtimeExpanded, trackTitle, webamp.compactMode, webampReady]);

  useEffect(() => {
    if (!runtimeExpanded || !webampReady) return;
    const syncExpandedLayout = (applyDefaults: boolean) => {
      const mode = getResponsiveExpandedMode();
      setExpandedLayoutMode(mode);
      const mountNode = compactHostRef.current;
      if (mountNode) {
        mountNode.dataset.raExpandedMode = mode;
      }
      if (applyDefaults) {
        ensureExpandedWindowsVisible(mode, true, winamp.windowVisibility);
      } else {
        setMainWindowShadeMode(false);
        ensureExpandedWindowsVisible(mode, false, winamp.windowVisibility);
      }
      resetCompactWindowVisibility();
      syncExpandedWindowPlacement(mode);
    };

    syncExpandedLayout(true);
    const lateSyncA = window.setTimeout(() => syncExpandedLayout(false), 110);
    const lateSyncB = window.setTimeout(() => syncExpandedLayout(false), 260);

    const onResize = () => {
      syncExpandedLayout(false);
    };

    const onExpandedToggle = (event: Event) => {
      const target = event.target as HTMLElement | null;
      const webampRoot = getWebampRootNode();
      if (!target || !webampRoot?.contains(target)) {
        return;
      }
      if (
        !target?.closest(
          '[title="Toggle Graphical Equalizer"], [title="Toggle Playlist Editor"], [title="Toggle Windowshade Mode"]'
        )
      ) {
        return;
      }
      window.setTimeout(() => {
        winamp.setWindowVisibility('equalizer-window', isWindowVisible('equalizer-window'));
        winamp.setWindowVisibility('playlist-window', isWindowVisible('playlist-window'));
        syncExpandedLayout(false);
      }, 120);
    };

    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    document.addEventListener('click', onExpandedToggle, true);
    return () => {
      window.clearTimeout(lateSyncA);
      window.clearTimeout(lateSyncB);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      document.removeEventListener('click', onExpandedToggle, true);
    };
  }, [runtimeExpanded, webamp, webampReady]);

  useEffect(() => {
    if (!runtimeExpanded || !webampReady) return;

    let cancelled = false;
    const recoverLayout = () => {
      if (cancelled || !runtimeExpanded) return;
      recoverExpandedWindows({
        beforeSync: (mode) => {
          ensureExpandedWindowsVisible(mode, true, winamp.windowVisibility);
          resetCompactWindowVisibility();
        },
        expandedRecoveryAttemptsRef,
        setBootCycle,
        syncExpandedWindowPlacement,
        winamp
      });
    };

    const checkA = window.setTimeout(recoverLayout, 320);
    const checkB = window.setTimeout(recoverLayout, 980);

    return () => {
      cancelled = true;
      window.clearTimeout(checkA);
      window.clearTimeout(checkB);
    };
  }, [runtimeExpanded, webampReady, winamp, winamp.activeSkin.url]);

  useEffect(() => {
    if (runtimeExpanded || !webampReady) return;
    const mountNode = compactHostRef.current;
    if (!mountNode) return;

    let cancelled = false;
    const recoverLayout = () => {
      if (cancelled || runtimeExpanded) return;
      recoverCompactWindow({
        applyCompactLayout,
        compactRecoveryAttemptsRef,
        mountNode,
        setBootCycle,
        winamp
      });
    };

    const checkA = window.setTimeout(recoverLayout, 240);
    const checkB = window.setTimeout(recoverLayout, 760);
    const checkC = window.setTimeout(recoverLayout, 1420);

    return () => {
      cancelled = true;
      window.clearTimeout(checkA);
      window.clearTimeout(checkB);
      window.clearTimeout(checkC);
    };
  }, [runtimeExpanded, webamp, webamp.compactMode, webamp.activeSkin.url, webampReady]);

  const { quietWebampPlayback } = useWinampTransportSync({
    lastAppliedBalanceRef,
    lastAppliedVolumeRef,
    lastElapsedTimeSyncRef,
    playablePlaylist,
    player,
    playlistSignature,
    playlistSignatureRef,
    suppressVolumeSyncUntilRef,
    syncExpandedEqStateFromDom,
    webampReady,
    webampRef
  });

  const transportButton = (
    <button
      className={`chip ${current && player.isPlaying ? 'active' : ''}`}
      type="button"
      onClick={() => {
        if (current) {
          quietWebampPlayback();
          void player.toggle();
          return;
        }
        playLast();
      }}
      disabled={!current && !canResume}
    >
      {current ? (player.isPlaying ? t('common.pause') : t('common.play')) : t('common.resume')}
    </button>
  );

  const nextButton = (
    <button className="chip" type="button" onClick={playNext}>
      {t('common.next')}
    </button>
  );

  const favoriteButton = (
    <button
      className={`icon-btn ${liked ? 'active' : ''}`}
      onClick={() => current && toggleFavorite(current)}
      type="button"
      disabled={!current}
      aria-label={liked ? t('stationTable.unfavorite') : t('stationTable.favorite')}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 21.2l-1.4-1.3C5.4 15.4 2 12.3 2 8.4 2 5.6 4.2 3.5 7 3.5c1.6 0 3.2.7 4.2 2 1-1.3 2.6-2 4.2-2 2.8 0 5 2.1 5 4.9 0 3.9-3.4 7-8.6 11.4L12 21.2z" />
      </svg>
    </button>
  );

  const appButton = (
    <button
      className="icon-btn"
      onClick={openWebAppExternally}
      type="button"
      title={t('common.openBrowser')}
      aria-label={t('common.openApp')}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19 19H5V5h7V3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.6l-9.8 9.8 1.4 1.4L19 6.4V10h2V3h-7z" />
      </svg>
    </button>
  );

  const compactActions = (
    <>
      {favoriteButton}
      <button
        className="icon-btn active"
        type="button"
        onMouseDown={stopCompactInteraction}
        onTouchStart={stopCompactInteraction}
        onClick={requestExpand}
        aria-label={t('winamp.fullscreen')}
        title={t('winamp.fullscreen')}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 5h5V3H3v7h2V5zm14 0v5h2V3h-7v2h5zM5 14H3v7h7v-2H5v-5zm16 0h-2v5h-5v2h7v-7z" />
        </svg>
      </button>
    </>
  );

  const overlayActions = (
    <>
      {transportButton}
      {nextButton}
      {favoriteButton}
      {onDetails && (
        <button
          className="chip"
          onClick={() => current && onDetails()}
          type="button"
          disabled={!current}
        >
          {t('common.info')}
        </button>
      )}
      <button
        className={`chip ${stationHidden ? 'active' : ''}`}
        onClick={() =>
          current &&
          (stationHidden
            ? unhideStationFromRecommendations(current)
            : hideStationFromRecommendations(current))
        }
        type="button"
        disabled={!current}
      >
        {stationHidden ? t('details.showInRecommendations') : t('details.hideFromRecommendations')}
      </button>
      <button
        className="chip"
        onClick={() => current && shareStation(current)}
        type="button"
        disabled={!current}
      >
        {t('common.share')}
      </button>
      {appButton}
      <button className="chip" type="button" onClick={copyTrack} disabled={!canCopyTrackTitle}>
        {t('common.song')}
      </button>
    </>
  );

  const actionStrip = (variant: 'compact' | 'overlay') => (
    <div
      className={`winamp-actions ${variant}`}
      onMouseDown={stopCompactInteraction}
      onTouchStart={stopCompactInteraction}
      onClick={stopCompactInteraction}
    >
      {variant === 'compact' ? compactActions : overlayActions}
    </div>
  );

  const trackLine = (variant: 'compact' | 'overlay') => (
    <button
      className={`winamp-trackline ${variant}`}
      type="button"
      onMouseDown={stopCompactInteraction}
      onTouchStart={stopCompactInteraction}
      onClick={() => {
        if (canCopyTrackTitle) {
          void copyTrack();
        }
      }}
      disabled={!canCopyTrackTitle}
      title={canCopyTrackTitle ? t('winamp.copyTrackTitle') : t('winamp.trackUnavailable')}
      aria-label={canCopyTrackTitle ? `${t('winamp.copyTrackTitle')}: ${trackTitle}` : t('winamp.trackUnavailable')}
    >
      <span className="winamp-trackline-label">
        {displayTrackTitle}
      </span>
    </button>
  );

  const expandedShellStyle = winamp.expanded
    ? expandedLayoutMode === 'mobile'
      ? ({
          position: 'fixed',
          inset: '0',
          bottom: 'auto',
          left: '0',
          right: '0',
          width: '100vw',
          maxWidth: '100vw',
          height: '100vh',
          alignItems: 'stretch',
          justifyContent: 'stretch',
          overflow: 'hidden'
        } satisfies React.CSSProperties)
      : ({
          minHeight: '100%',
          height: '100%',
          alignItems: 'stretch',
          justifyContent: 'stretch'
        } satisfies React.CSSProperties)
    : undefined;

  const expandedMainStyle = winamp.expanded
    ? ({
        flex: '1 1 auto',
        width: '100%',
        height: '100%',
        minHeight: 0,
        alignItems: 'stretch',
        justifyContent: 'flex-start',
        padding:
          expandedLayoutMode === 'mobile'
            ? 'calc(58px + env(safe-area-inset-top)) 8px calc(88px + env(safe-area-inset-bottom))'
            : 'calc(54px + env(safe-area-inset-top)) 10px calc(76px + env(safe-area-inset-bottom))'
      } satisfies React.CSSProperties)
    : undefined;

  const expandedHostStyle = runtimeExpanded
    ? ({
        minHeight: '100%',
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: expandedLayoutMode === 'mobile' ? '2px' : '0',
        paddingBottom: '12px'
      } satisfies React.CSSProperties)
    : undefined;

  const playOverlayQueueStation = (station: StationLite) => {
    playStation(station, {
      playlist: queue.items.length ? queue.items : effectivePlaylist,
      sourceId: queue.sourceId || 'winamp-queue',
      sourceLabel: queue.sourceLabel || t('radio.queueDefault')
    });
  };
  const playOverlayHistoryStation = (station: StationLite) => {
    playStation(station, {
      playlist: playbackHistory.length ? playbackHistory : [station],
      sourceId: 'history',
      sourceLabel: t('playlist.historyTitle')
    });
  };
  const loadingShell = runtimeExpanded && !webampReady ? (
    <div className={`winamp-loading ${winamp.expanded ? 'overlay' : ''}`}>
      {figmaCaptureMode ? (
        t('winamp.figmaPlaceholder')
      ) : webampFailed ? (
        <button
          className="chip"
          type="button"
          title={bootError || undefined}
          onClick={() => setBootCycle((value) => value + 1)}
        >
          {t('winamp.loadingFailed')}
        </button>
      ) : (
        t('winamp.loadingShell')
      )}
    </div>
  ) : null;
  const hostNode = <div className="winamp-host compact" style={expandedHostStyle} ref={compactHostRef} />;
  const liteOverlayHost = (
    <div className="winamp-lite-host">
      <div className="winamp-lite-panel" data-winamp-lite-panel="true">
        <div className="winamp-overlay-card">
          <div className="winamp-overlay-label">{t('winamp.currentStation')}</div>
          <div className="winamp-overlay-title">{current?.name || t('winamp.noStation')}</div>
          <div className="winamp-overlay-copy">
            {player.status === 'buffering'
              ? t('dock.buffering')
              : trackTitle || t('winamp.trackUnavailable')}
          </div>
        </div>
        <div className="winamp-overlay-card">
          <div className="winamp-overlay-label">{t('winamp.nowTuned')}</div>
          <div className="winamp-overlay-title">{queue.sourceLabel || t('radio.queueDefault')}</div>
          <div className="winamp-overlay-copy">
            {t('winamp.queueReady', { count: queue.items.length })}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div
      className={`winamp-compact ${winamp.expanded ? 'fullscreen-ui' : ''}`}
      style={expandedShellStyle}
      data-expanded-layout={winamp.expanded ? expandedLayoutMode : undefined}
      data-winamp-mode={!winamp.expanded ? 'compact' : liteFullscreenMode ? 'lite' : 'full'}
      data-compact-view={!winamp.expanded ? winamp.compactMode : undefined}
      role={winamp.expanded && expandedLayoutMode === 'mobile' ? 'dialog' : undefined}
      aria-modal={winamp.expanded && expandedLayoutMode === 'mobile' ? 'true' : undefined}
    >
      {winamp.expanded ? (
        <Suspense
          fallback={
            <div className="winamp-compact-main" style={expandedMainStyle}>
              {liteFullscreenMode ? liteOverlayHost : hostNode}
              {loadingShell}
            </div>
          }
        >
          <LazyWinampOverlay
            actionStrip={actionStrip('overlay')}
            current={current}
            expandedLayoutMode={expandedLayoutMode}
            host={liteFullscreenMode ? liteOverlayHost : hostNode}
            loading={loadingShell}
            mainStyle={expandedMainStyle}
            onClose={() => winamp.setExpanded(false)}
            onDetails={onDetails}
            onHideStation={() =>
              current &&
              (stationHidden
                ? unhideStationFromRecommendations(current)
                : hideStationFromRecommendations(current))
            }
            onPlayHistoryStation={playOverlayHistoryStation}
            onPlayQueueStation={playOverlayQueueStation}
            onResetLayout={resetExpandedLayout}
            playbackHistory={playbackHistory}
            queue={queue}
            showVisualizer={!liteFullscreenMode}
            stationHidden={stationHidden}
            t={t}
            trackHistory={trackHistory}
            trackLine={trackLine('overlay')}
            visualizer={player.visualizer}
          />
        </Suspense>
      ) : (
        <>
          <div className="winamp-compact-topbar">
            {trackLine('compact')}
            {actionStrip('compact')}
          </div>
        </>
      )}

      {!winamp.expanded ? (
        <div
          className="winamp-compact-main"
          style={expandedMainStyle}
          onClick={handleCompactMainClick}
        >
          {hostNode}
          {loadingShell}
        </div>
      ) : null}
    </div>
  );
};
