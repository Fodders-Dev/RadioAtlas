import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { StationLite } from '../types';
import { stationLocation } from '../lib/stationUtils';
import { EQ_BANDS } from '../lib/useAudioPlayer';
import {
  bindWinampTransportBridge,
  getWebampRootNode,
  stopNativeEvent
} from '../lib/winampBridge';
import { useLocale } from '../state/LocaleContext';
import { useRadio } from '../state/RadioContext';

type WebampTrack = {
  url: string;
  metaData: {
    title: string;
    artist: string;
  };
};

type WebampInstance = {
  renderWhenReady: (node: HTMLElement) => Promise<void>;
  dispose: () => void;
  setTracksToPlay?: (tracks: WebampTrack[]) => void;
  setVolume?: (volume: number) => void;
  setBalance?: (balance: number) => void;
  pause?: () => void;
  stop?: () => void;
  onWillClose?: (cb: (cancel: () => void) => void) => () => void;
  onClose?: (cb: () => void) => () => void;
};

type WebampCtor = new (options: Record<string, unknown>) => WebampInstance;
type CompactViewMode = 'strip' | 'panel';
type ExpandedWindowId = 'main-window' | 'equalizer-window' | 'playlist-window';
type ResponsiveExpandedMode = 'mobile' | 'desktop';
type ExpandedViewportBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};
type WinampDevApi = {
  moveExpandedWindow: (id: ExpandedWindowId, deltaX: number, deltaY: number) => boolean;
  resetExpandedLayout: () => void;
};
type ExpandedWindowMetric = {
  id: ExpandedWindowId;
  node: HTMLElement;
  width: number;
  height: number;
};

let webampCtorPromise: Promise<WebampCtor> | null = null;
const MAIN_WINDOW_WIDTH = 275;
const SHADED_WINDOW_HEIGHT = 28;
const FULL_WINDOW_HEIGHT = 116;
const PLAYLIST_WINDOW_HEIGHT = 232;
const EXPANDED_WINDOW_ORDER: ExpandedWindowId[] = [
  'main-window',
  'equalizer-window',
  'playlist-window'
];
const EXPANDED_WINDOW_Z_ORDER: Record<ExpandedWindowId, number> = {
  'main-window': 1,
  'equalizer-window': 2,
  'playlist-window': 3
};
const STRIP_COMPACT_MIN_HEIGHT = 44;
const STRIP_COMPACT_MAX_HEIGHT = 62;
const PANEL_COMPACT_MIN_HEIGHT = 96;
const PANEL_COMPACT_MAX_HEIGHT = 208;
const MIN_COMPACT_SCALE = 0.82;
const MOBILE_EXPANDED_BREAKPOINT = 760;
const COMPACT_TRANSPORT_SELECTOR = [
  '#webamp #previous',
  '#webamp #play',
  '#webamp #pause',
  '#webamp #stop',
  '#webamp #next'
].join(', ');
const COMPACT_INTERACTIVE_SELECTOR = [
  COMPACT_TRANSPORT_SELECTOR,
  '#webamp #shade',
  '#webamp [title="Toggle Windowshade Mode"]',
  '#webamp [title="Volume Bar"]',
  '#webamp [title="Balance"]'
].join(', ');
const BOOT_WINDOW_WAIT_MS = 1800;

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
const toWebampVolume = (value: number) => Math.round(clamp(value, 0, 1) * 100);
const toPlayerVolume = (value: number) => clamp(value / 100, 0, 1);
const SILENT_WEBAMP_TRACK_URL =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
const getSliderValue = (node: Element | null) => {
  if (!node) return null;
  if (node instanceof HTMLInputElement) {
    const directValue = Number(node.value);
    if (Number.isFinite(directValue)) return directValue;
  }
  const ariaValue = Number(node.getAttribute('aria-valuenow') || '');
  if (Number.isFinite(ariaValue)) return ariaValue;
  const valueAttr = Number(node.getAttribute('value') || '');
  return Number.isFinite(valueAttr) ? valueAttr : null;
};

const buildTracks = (playlist: StationLite[]): WebampTrack[] =>
  playlist.map((station) => ({
    // Webamp is a UI shell in this app, so its internal decoder should never own
    // real station networking or bypass the playback engine's proxy policy.
    url: SILENT_WEBAMP_TRACK_URL,
    metaData: {
      title: station.name,
      artist: stationLocation(station)
    }
  }));

const buildPersistentLayout = () => ({
  main: {
    position: { top: 16, left: 16 },
    shadeMode: false
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

  const transportWindow =
    (
      document
        .querySelector(
          '#play, [title="Play"], [title="Pause"], [title="Stop"], [title="Next Track"]'
        )
        ?.closest('.window') as HTMLElement | null
    ) ?? null;
  if (transportWindow) return transportWindow;

  const titleWindow =
    (document.querySelector('[title="Song Title"]')?.closest('.window') as HTMLElement | null) ?? null;
  if (titleWindow) return titleWindow;

  const menu = document.querySelector('[title="Winamp Menu"]') as HTMLElement | null;
  return (
    (menu?.closest('.window') as HTMLElement | null) ??
    (document.querySelector('#webamp .window') as HTMLElement | null)
  );
};

const getWebampWindowNodes = () =>
  Array.from(document.querySelectorAll<HTMLElement>('#webamp .window'));

const getWindowById = (id: string) =>
  (document.querySelector(`#${id}`)?.closest('.window') as HTMLElement | null) ?? null;
const getExpandedWindowId = (windowNode: HTMLElement | null): ExpandedWindowId | null => {
  if (!windowNode) return null;
  if (windowNode.id === 'main-window' || windowNode.querySelector('#main-window')) {
    return 'main-window';
  }
  if (windowNode.id === 'equalizer-window' || windowNode.querySelector('#equalizer-window')) {
    return 'equalizer-window';
  }
  if (windowNode.id === 'playlist-window' || windowNode.querySelector('#playlist-window')) {
    return 'playlist-window';
  }
  return null;
};

const isWindowRenderable = (node: HTMLElement | null) => {
  if (!node) return false;
  const rect = node.getBoundingClientRect();
  return rect.width > 8 && rect.height > 8;
};

const isWindowVisibleOnViewport = (node: HTMLElement | null) => {
  if (!node) return false;
  const style = window.getComputedStyle(node);
  if (style.display === 'none' || style.visibility === 'hidden') {
    return false;
  }
  const rect = node.getBoundingClientRect();
  if (rect.width <= 8 || rect.height <= 8) {
    return false;
  }
  return (
    rect.right > 4 &&
    rect.bottom > 4 &&
    rect.left < window.innerWidth - 4 &&
    rect.top < window.innerHeight - 4
  );
};

const isWindowVisibleInCompactHost = (windowNode: HTMLElement | null, hostNode: HTMLElement | null) => {
  if (!windowNode || !hostNode) return false;
  const windowRect = windowNode.getBoundingClientRect();
  const hostRect = hostNode.getBoundingClientRect();
  if (windowRect.width <= 8 || windowRect.height <= 8) return false;
  if (hostRect.width <= 8 || hostRect.height <= 8) return false;
  const overlapX = Math.max(0, Math.min(windowRect.right, hostRect.right) - Math.max(windowRect.left, hostRect.left));
  const overlapY = Math.max(0, Math.min(windowRect.bottom, hostRect.bottom) - Math.max(windowRect.top, hostRect.top));
  return overlapX >= 20 && overlapY >= 12;
};

const waitForMainWindow = async (
  timeoutMs: number,
  isCancelled: () => boolean
) => {
  const started = Date.now();
  while (!isCancelled() && Date.now() - started < timeoutMs) {
    if (isWindowRenderable(getMainWindowNode())) {
      return true;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 90));
  }
  return isWindowRenderable(getMainWindowNode());
};

const readExpandedAnchorTransform = (anchor: HTMLElement) => {
  const match = anchor.style.transform.match(
    /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/
  );
  return {
    x: match ? Number(match[1]) : 0,
    y: match ? Number(match[2]) : 0,
    scale: match ? Number(match[3]) : Number(anchor.dataset.raExpandedScale || '1') || 1
  };
};

const resolveCompactWindowAnchor = (windowNode: HTMLElement) => {
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

const resolveExpandedWindowAnchor = (windowNode: HTMLElement) => {
  const webampRoot = getWebampRootNode();
  let anchor = (windowNode.parentElement as HTMLElement | null) ?? windowNode;
  if (!webampRoot) {
    return anchor;
  }
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

const getExpandedViewportBounds = (): ExpandedViewportBounds => {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const headerRect = (
    document.querySelector('.winamp-overlay-header') as HTMLElement | null
  )?.getBoundingClientRect();
  const footerRect = (
    document.querySelector('.winamp-overlay-footer') as HTMLElement | null
  )?.getBoundingClientRect();

  const left = 8;
  const right = Math.max(left + 160, viewportWidth - 8);
  const top = Math.max(8, Math.round((headerRect?.bottom ?? 0) + 10));
  const bottom = Math.max(top + 140, Math.round((footerRect?.top ?? viewportHeight) - 10));

  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(160, right - left),
    height: Math.max(140, bottom - top)
  };
};

const resetIntermediateAnchors = (
  windowNode: HTMLElement,
  anchor: HTMLElement,
  marker: 'compact' | 'expanded'
) => {
  if (anchor === windowNode) {
    return;
  }
  const pointerEvents = marker === 'expanded' ? 'auto' : 'none';
  let current = windowNode.parentElement as HTMLElement | null;
  while (current && current !== anchor) {
    current.style.position = 'absolute';
    current.style.inset = '';
    current.style.left = '0px';
    current.style.top = '0px';
    current.style.transformOrigin = 'top left';
    current.style.transform = '';
    current.style.zIndex = '';
    current.style.pointerEvents = pointerEvents;
    if (marker === 'compact') {
      current.dataset.raCompactAnchor = '1';
      delete current.dataset.raExpandedAnchor;
    } else {
      current.dataset.raExpandedAnchor = '1';
      delete current.dataset.raCompactAnchor;
    }
    current = current.parentElement as HTMLElement | null;
  }
};

const placeExpandedWindowAnchor = (
  windowNode: HTMLElement,
  left: number,
  top: number,
  zOrder: number,
  scale: number,
  width: number,
  height: number
) => {
  const anchor = resolveExpandedWindowAnchor(windowNode);
  if (!anchor) return;
  resetIntermediateAnchors(windowNode, anchor, 'expanded');

  anchor.style.position = 'absolute';
  anchor.style.inset = '';
  anchor.style.left = '0px';
  anchor.style.top = '0px';
  anchor.style.transformOrigin = 'top left';
  anchor.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px) scale(${scale})`;
  anchor.style.zIndex = String(1650 + zOrder);
  anchor.style.pointerEvents = 'auto';
  anchor.style.width = `${Math.round(width)}px`;
  anchor.style.height = `${Math.round(height)}px`;
  anchor.dataset.raExpandedAnchor = '1';
  anchor.dataset.raExpandedScale = String(scale);

  if (anchor !== windowNode) {
    windowNode.style.left = '0px';
    windowNode.style.top = '0px';
    windowNode.style.transform = '';
    windowNode.style.pointerEvents = 'auto';
  }
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
  const anchor = windowNode ? resolveCompactWindowAnchor(windowNode) : null;
  if (!windowNode || !anchor) return false;

  setMainWindowShadeMode(viewMode === 'strip');
  enforceCompactWindowVisibility();
  resetIntermediateAnchors(windowNode, anchor, 'compact');
  const mountRect = mountNode.getBoundingClientRect();
  anchor.style.position = 'fixed';
  anchor.style.inset = '';
  anchor.style.left = '0px';
  anchor.style.top = '0px';
  anchor.style.transformOrigin = 'top left';
  anchor.style.transform = '';
  anchor.style.zIndex = '58';
  anchor.style.pointerEvents = 'none';
  anchor.style.overflow = 'hidden';
  anchor.dataset.raCompactAnchor = '1';
  windowNode.style.transformOrigin = 'top left';
  windowNode.style.transform = '';
  windowNode.style.left = '0px';
  windowNode.style.top = '0px';
  windowNode.style.width = `${MAIN_WINDOW_WIDTH}px`;
  windowNode.style.height =
    viewMode === 'panel' ? `${FULL_WINDOW_HEIGHT}px` : `${SHADED_WINDOW_HEIGHT}px`;
  windowNode.style.pointerEvents = 'auto';
  const rawRect = windowNode.getBoundingClientRect();
  const baseWidth = rawRect.width || MAIN_WINDOW_WIDTH;
  const baseHeight =
    rawRect.height || (viewMode === 'panel' ? FULL_WINDOW_HEIGHT : SHADED_WINDOW_HEIGHT);
  const hostRect = mountNode.getBoundingClientRect();
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
  const baseMinHeight =
    viewMode === 'panel' ? PANEL_COMPACT_MIN_HEIGHT : STRIP_COMPACT_MIN_HEIGHT;
  const baseMaxHeight =
    viewMode === 'panel' ? PANEL_COMPACT_MAX_HEIGHT : STRIP_COMPACT_MAX_HEIGHT;
  const availableHeight = Math.max(baseMinHeight, Math.round(maxBottom - minTop));
  const allowedHeight = Math.min(baseMaxHeight, availableHeight);
  const widthScale = Math.max((mountRect.width - 8) / baseWidth, MIN_COMPACT_SCALE);
  const heightScale = allowedHeight / baseHeight;
  const nextScale = Number(clamp(Math.min(widthScale, heightScale), MIN_COMPACT_SCALE, 3.6).toFixed(3));
  const nextWidth = Math.max(1, Math.round(baseWidth * nextScale));
  const rawHeight = Math.max(18, Math.round(baseHeight * nextScale));
  const compactHeight = clamp(
    Math.min(rawHeight, allowedHeight),
    Math.min(baseMinHeight, availableHeight),
    allowedHeight
  );
  const heightPadding = viewMode === 'panel' ? 4 : 0;
  const visualHeight = Math.min(availableHeight, compactHeight + heightPadding);
  const left = hostRect.left + Math.max(0, (hostRect.width - nextWidth) / 2);
  mountNode.style.height = `${visualHeight}px`;
  windowNode.style.transform = `scale(${nextScale})`;

  const finalLeft = Math.round(left);
  const maxTop = Math.max(minTop, maxBottom - visualHeight);
  const finalTop = Math.round(clamp(Math.max(hostRect.top, minTop), minTop, maxTop));
  const finalWidth = Math.round(nextWidth);
  const finalHeight = Math.round(visualHeight);
  const currentLeft = Number.parseFloat(anchor.style.left || Number.NaN);
  const currentTop = Number.parseFloat(anchor.style.top || Number.NaN);
  const currentWidth = Number.parseFloat(anchor.style.width || Number.NaN);
  const currentHeight = Number.parseFloat(anchor.style.height || Number.NaN);
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
    Math.abs(prevHeight - finalHeight) > 1 ||
    !Number.isFinite(currentLeft) ||
    !Number.isFinite(currentTop) ||
    !Number.isFinite(currentWidth) ||
    !Number.isFinite(currentHeight) ||
    Math.abs(currentLeft - finalLeft) > 1 ||
    Math.abs(currentTop - finalTop) > 1 ||
    Math.abs(currentWidth - finalWidth) > 1 ||
    Math.abs(currentHeight - finalHeight) > 1 ||
    anchor.style.transform !== '';
  if (changed) {
    anchor.style.left = `${finalLeft}px`;
    anchor.style.top = `${finalTop}px`;
    anchor.style.transform = '';
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
    delete anchor.dataset.raExpandedScale;
  });

  resetCompactWindowVisibility();
  const windowNode = getMainWindowNode();
  if (windowNode) {
    windowNode.style.transformOrigin = '';
    windowNode.style.transform = '';
    windowNode.style.pointerEvents = '';
    windowNode.style.left = '';
    windowNode.style.top = '';
    windowNode.style.width = '';
    windowNode.style.height = '';
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

const measureExpandedWindowMetric = (windowNode: HTMLElement): ExpandedWindowMetric | null => {
  const id = getExpandedWindowId(windowNode);
  if (!id) return null;
  const rect = windowNode.getBoundingClientRect();
  const anchor = resolveExpandedWindowAnchor(windowNode);
  const scale = Math.max(0.1, Number(anchor?.dataset.raExpandedScale || '1') || 1);
  const fallbackHeight =
    id === 'playlist-window' ? PLAYLIST_WINDOW_HEIGHT : FULL_WINDOW_HEIGHT;

  return {
    id,
    node: windowNode,
    width: Math.max(MAIN_WINDOW_WIDTH, rect.width / scale || MAIN_WINDOW_WIDTH),
    height: Math.max(fallbackHeight, rect.height / scale || fallbackHeight)
  };
};

const getEqSliderValueFromBand = (bandNode: Element | null) => {
  const sliderRoot = bandNode?.firstElementChild as HTMLElement | null;
  const handleNode = sliderRoot?.firstElementChild as HTMLElement | null;
  const transform = handleNode?.style.transform || '';
  const match = transform.match(/translateY\(([-\d.]+)px\)/i);
  const offset = match ? Number(match[1]) : Number.NaN;
  if (!Number.isFinite(offset)) {
    return EQ_CENTER;
  }
  return clamp(Math.round((1 - offset / 51) * 100), 0, 100);
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
  const mainContent = mainWindow.querySelector('#main-window') as HTMLElement | null;
  const current = isWindowShaded();
  if (current === shaded) return;
  const toggleBtn = document.querySelector('[title="Toggle Windowshade Mode"]') as HTMLElement | null;
  if (toggleBtn) {
    toggleBtn.click();
  }
  if (isWindowShaded() !== shaded) {
    mainWindow.classList.toggle('shade', shaded);
    mainContent?.classList.toggle('shade', shaded);
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

const setWindowVisibility = (id: string, toggleTitle: string, visible: boolean) => {
  const isVisible = isWindowVisible(id);
  if (isVisible === visible) return;
  const toggle = document.querySelector(`[title="${toggleTitle}"]`) as HTMLElement | null;
  if (!toggle) return;
  toggle.click();
};

const getResponsiveExpandedMode = () =>
  window.innerWidth < MOBILE_EXPANDED_BREAKPOINT ? 'mobile' : 'desktop';

const ensureExpandedWindowsVisible = (
  mode: ResponsiveExpandedMode,
  applyDefaults: boolean,
  visibility: {
    'equalizer-window': boolean;
    'playlist-window': boolean;
  }
) => {
  setMainWindowShadeMode(false);
  if (applyDefaults) {
    setWindowVisibility(
      'equalizer-window',
      'Toggle Graphical Equalizer',
      visibility['equalizer-window']
    );
    setWindowVisibility(
      'playlist-window',
      'Toggle Playlist Editor',
      mode === 'desktop' && visibility['playlist-window']
    );
  } else {
    ensureWindowVisible('equalizer-window', 'Toggle Graphical Equalizer');
    setWindowVisibility(
      'equalizer-window',
      'Toggle Graphical Equalizer',
      visibility['equalizer-window']
    );
    setWindowVisibility(
      'playlist-window',
      'Toggle Playlist Editor',
      mode === 'desktop' && visibility['playlist-window']
    );
  }
  setMainWindowShadeMode(false);
};

export const WinampPlayerShell = ({
  onDetails
}: {
  onDetails?: () => void;
}) => {
  const { t } = useLocale();
  const {
    player,
    queue,
    winamp,
    nowPlaying,
    playbackHistory,
    playPrevious,
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
  const retryDelayRef = useRef<number | null>(null);
  const expandRetryRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const playlistSignatureRef = useRef('');
  const lastAppliedVolumeRef = useRef<number | null>(null);
  const suppressVolumeSyncUntilRef = useRef(0);
  const expandedRecoveryAttemptsRef = useRef(0);
  const compactRecoveryAttemptsRef = useRef(0);
  const recoveredSkinRef = useRef<string | null>(null);

  const [webampReady, setWebampReady] = useState(false);
  const [webampFailed, setWebampFailed] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootCycle, setBootCycle] = useState(0);
  const [expandedLayoutMode, setExpandedLayoutMode] = useState<ResponsiveExpandedMode>(() =>
    typeof window === 'undefined' ? 'desktop' : getResponsiveExpandedMode()
  );
  const expandedRef = useRef(winamp.expanded);
  const figmaCaptureMode =
    typeof window !== 'undefined' && window.location.hash.includes('figmacapture=');
  const overlayScrollRestoreRef = useRef<number | null>(null);

  const current = player.current;

  useEffect(() => {
    expandedRef.current = winamp.expanded;
    if (winamp.expanded && expandRetryRef.current !== null) {
      window.clearTimeout(expandRetryRef.current);
      expandRetryRef.current = null;
    }
  }, [winamp.expanded]);

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
  const canResume = Boolean(playbackHistory.length || queue.items.length);
  const trackTitle = nowPlaying?.trim() || '';
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
    if (!winamp.expanded || !webampReady) return;
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
      resetExpandedLayout
    };
    return () => {
      delete hostWindow.__radioAtlasWinamp;
    };
  }, [resetExpandedLayout, webampReady, winamp.expanded]);

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

    if (figmaCaptureMode) {
      mountNode.innerHTML = '';
      resetWebampWindowPlacement();
      setWebampReady(false);
      setWebampFailed(false);
      setBootError(null);
      return;
    }

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
      const fallbackSkinUrl = winamp.availableSkins[0]?.url || winamp.activeSkin.url;
      const skinCandidates = Array.from(
        new Set([toAssetUrl(winamp.activeSkin.url), toAssetUrl(fallbackSkinUrl)])
      );

      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        for (const skinUrl of skinCandidates) {
          const layoutModes = [true, false];
          for (const useLayout of layoutModes) {
            try {
              const instance = new Webamp({
                initialSkin: {
                  url: skinUrl
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
              const ready = await waitForMainWindow(BOOT_WINDOW_WAIT_MS, () => cancelled);
              if (!ready) {
                throw new Error('Webamp main window missing after boot');
              }
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
  }, [bootCycle, figmaCaptureMode, winamp.activeSkin.url]);

  useEffect(() => {
    if (!webampReady) return;
    const mountNode = compactHostRef.current;
    if (!mountNode) return;
    if (winamp.expanded) {
      applyExpandedLayout(mountNode);
      return;
    }
    applyCompactLayout(mountNode);
  }, [winamp.compactMode, winamp.expanded, webampReady]);

  useEffect(() => {
    if (winamp.expanded || !webampReady) return;
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
  }, [winamp.expanded, webampReady]);

  useEffect(() => {
    if (winamp.expanded || !webampReady) return;
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
  }, [current?.stationuuid, player.isPlaying, trackTitle, webampReady, winamp.compactMode, winamp.expanded]);

  useEffect(() => {
    if (!winamp.expanded || !webampReady) return;
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
  }, [winamp, winamp.expanded, webampReady]);

  useEffect(() => {
    if (!winamp.expanded || !webampReady) return;

    let cancelled = false;
    const recoverLayout = () => {
      if (cancelled || !winamp.expanded) return;
      const mainWindow = getWindowById('main-window');
      if (isWindowVisibleOnViewport(mainWindow)) {
        expandedRecoveryAttemptsRef.current = 0;
        return;
      }

      expandedRecoveryAttemptsRef.current += 1;
      const mode = getResponsiveExpandedMode();
      console.warn(
        `Winamp window hidden after boot; recovery attempt ${expandedRecoveryAttemptsRef.current}`
      );
      winamp.resetLayout();
      ensureExpandedWindowsVisible(mode, true, winamp.windowVisibility);
      resetCompactWindowVisibility();
      syncExpandedWindowPlacement(mode);

      if (expandedRecoveryAttemptsRef.current >= 2) {
        setBootCycle((value) => value + 1);
        expandedRecoveryAttemptsRef.current = 0;
      }
    };

    const checkA = window.setTimeout(recoverLayout, 320);
    const checkB = window.setTimeout(recoverLayout, 980);

    return () => {
      cancelled = true;
      window.clearTimeout(checkA);
      window.clearTimeout(checkB);
    };
  }, [winamp, winamp.expanded, webampReady, winamp.activeSkin.url]);

  useEffect(() => {
    if (winamp.expanded || !webampReady) return;
    const mountNode = compactHostRef.current;
    if (!mountNode) return;

    let cancelled = false;
    const recoverLayout = () => {
      if (cancelled || winamp.expanded) return;
      const mainWindow = getMainWindowNode();
      const visibleOnScreen = isWindowVisibleOnViewport(mainWindow);
      const visibleInHost = isWindowVisibleInCompactHost(mainWindow, mountNode);
      if (visibleOnScreen && visibleInHost) {
        compactRecoveryAttemptsRef.current = 0;
        return;
      }

      compactRecoveryAttemptsRef.current += 1;
      console.warn(
        `Winamp compact window hidden after boot; recovery attempt ${compactRecoveryAttemptsRef.current}`
      );
      applyCompactLayout(mountNode);
      window.setTimeout(() => {
        if (!cancelled && !winamp.expanded) {
          syncCompactWindowPlacement(mountNode, winamp.compactMode);
        }
      }, 110);

      if (compactRecoveryAttemptsRef.current >= 3) {
        setBootCycle((value) => value + 1);
        compactRecoveryAttemptsRef.current = 0;
      }
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
  }, [winamp, winamp.compactMode, winamp.expanded, webampReady, winamp.activeSkin.url]);

  useEffect(() => {
    const instance = webampRef.current;
    if (!instance || !webampReady || !playablePlaylist.length) return;
    if (playlistSignatureRef.current === playlistSignature) return;

    playlistSignatureRef.current = playlistSignature;
    try {
      instance.setTracksToPlay?.(buildTracks(playablePlaylist));
    } catch (error) {
      console.error('Winamp playlist sync failed', error);
    }
  }, [webampReady, playablePlaylist, playlistSignature]);

  useEffect(() => {
    if (!webampReady) return;
    // Webamp is used as UI shell; keep its internal decoder silent to avoid stale stream bleed-through.
    const instance = webampRef.current;
    try {
      instance?.pause?.();
    } catch {
      // ignore
    }
    try {
      instance?.stop?.();
    } catch {
      // ignore
    }
  }, [webampReady, player.current?.stationuuid, player.isPlaying]);

  useEffect(() => {
    const instance = webampRef.current;
    if (!instance || !webampReady) return;

    const nextVolume = toWebampVolume(player.volume);
    if (lastAppliedVolumeRef.current === nextVolume) return;

    lastAppliedVolumeRef.current = nextVolume;
    suppressVolumeSyncUntilRef.current = Date.now() + 160;
    try {
      instance.setVolume?.(nextVolume);
      instance.setBalance?.(0);
    } catch (error) {
      console.error('Winamp volume sync failed', error);
    }
  }, [player.volume, webampReady]);

  useEffect(() => {
    if (!webampReady) return;

    const onSliderChange = (event: Event) => {
      if (Date.now() < suppressVolumeSyncUntilRef.current) return;
      const target = event.target as HTMLElement | null;
      const webampRoot = getWebampRootNode();
      if (!target || !webampRoot?.contains(target)) return;

      const volumeNode = target.closest('[title="Volume Bar"]');
      if (volumeNode) {
        const value = getSliderValue(volumeNode);
        if (value === null) return;
        const nextVolume = toPlayerVolume(value);
        if (Math.abs(player.volume - nextVolume) < 0.005) return;
        lastAppliedVolumeRef.current = toWebampVolume(nextVolume);
        player.setVolume(nextVolume);
        return;
      }

      const balanceNode = target.closest('[title="Balance"]');
      if (!balanceNode) return;
      const instance = webampRef.current;
      suppressVolumeSyncUntilRef.current = Date.now() + 160;
      try {
        instance?.setBalance?.(0);
      } catch {
        // ignore
      }
    };

    document.addEventListener('input', onSliderChange, true);
    document.addEventListener('change', onSliderChange, true);
    document.addEventListener('mouseup', onSliderChange, true);

    return () => {
      document.removeEventListener('input', onSliderChange, true);
      document.removeEventListener('change', onSliderChange, true);
      document.removeEventListener('mouseup', onSliderChange, true);
    };
  }, [player, player.volume, webampReady]);

  useEffect(() => {
    if (!webampReady) return;

    let frameId: number | null = null;
    let mutationObserver: MutationObserver | null = null;

    const syncEq = () => {
      frameId = null;
      syncExpandedEqStateFromDom();
    };

    const queueEqSync = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(syncEq);
    };

    queueEqSync();

    if (typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(queueEqSync);
      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class']
      });
    }

    document.addEventListener('mouseup', queueEqSync, true);
    document.addEventListener('touchend', queueEqSync, true);
    document.addEventListener('click', queueEqSync, true);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      mutationObserver?.disconnect();
      document.removeEventListener('mouseup', queueEqSync, true);
      document.removeEventListener('touchend', queueEqSync, true);
      document.removeEventListener('click', queueEqSync, true);
    };
  }, [player, player.eq.bands, player.eq.enabled, player.eq.preamp, webampReady]);

  useEffect(() => {
    if (!webampReady) return;
    const mainContent = document.getElementById('main-window') as HTMLElement | null;
    if (!mainContent) return;

    if (window.getComputedStyle(mainContent).position === 'static') {
      mainContent.dataset.raVisualizerPosition = mainContent.style.position || '__empty__';
      mainContent.style.position = 'relative';
    }

    let overlay = mainContent.querySelector('.ra-visualizer-overlay') as HTMLElement | null;
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'ra-visualizer-overlay';
      mainContent.appendChild(overlay);
    }

    return () => {
      overlay?.remove();
      if (mainContent.dataset.raVisualizerPosition !== undefined) {
        const previous = mainContent.dataset.raVisualizerPosition;
        mainContent.style.position = previous === '__empty__' ? '' : previous;
        delete mainContent.dataset.raVisualizerPosition;
      }
    };
  }, [webampReady]);

  useEffect(() => {
    if (!webampReady) return;
    const overlay = document.querySelector('#main-window .ra-visualizer-overlay') as HTMLElement | null;
    if (!overlay) return;

    const desiredBars = player.visualizer.spectrum.length;
    while (overlay.childElementCount < desiredBars) {
      const bar = document.createElement('span');
      bar.className = 'ra-visualizer-overlay-bar';
      overlay.appendChild(bar);
    }
    while (overlay.childElementCount > desiredBars) {
      overlay.lastElementChild?.remove();
    }

    overlay.dataset.active = player.visualizer.active ? 'true' : 'false';
    overlay.dataset.available = player.visualizer.available ? 'true' : 'false';
    Array.from(overlay.children).forEach((child, index) => {
      const bar = child as HTMLElement;
      const level = player.visualizer.spectrum[index] ?? 0;
      bar.style.setProperty('--ra-level', String(level));
    });
  }, [player.visualizer, webampReady]);

  const quietWebampPlayback = () => {
    const instance = webampRef.current;
    try {
      instance?.pause?.();
    } catch {
      // ignore
    }
    try {
      instance?.stop?.();
    } catch {
      // ignore
    }
  };

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
        {canCopyTrackTitle ? trackTitle : t('winamp.trackUnavailable')}
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

  const expandedHostStyle = winamp.expanded
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

  const overlayQueuePreview = queue.items
    .slice(Math.max(queue.currentIndex, 0), Math.max(queue.currentIndex, 0) + 4)
    .filter(Boolean);
  const overlayHistoryPreview = playbackHistory.slice().reverse().slice(0, 4);

  return (
    <div
      className={`winamp-compact ${winamp.expanded ? 'fullscreen-ui' : ''}`}
      style={expandedShellStyle}
      data-expanded-layout={winamp.expanded ? expandedLayoutMode : undefined}
      data-compact-view={!winamp.expanded ? winamp.compactMode : undefined}
      role={winamp.expanded && expandedLayoutMode === 'mobile' ? 'dialog' : undefined}
      aria-modal={winamp.expanded && expandedLayoutMode === 'mobile' ? 'true' : undefined}
    >
      {winamp.expanded ? (
        <>
          {expandedLayoutMode === 'mobile' ? (
            <div
              className="winamp-overlay-backdrop"
              aria-hidden="true"
            />
          ) : null}
          <div className="winamp-overlay-header">
            <div className="winamp-overlay-header-actions">
              {expandedLayoutMode === 'desktop' ? (
                <button className="chip" type="button" onClick={resetExpandedLayout}>
                  {t('winamp.resetLayout')}
                </button>
              ) : null}
              <button className="chip active" type="button" onClick={() => winamp.setExpanded(false)}>
                {t('winamp.collapse')}
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="winamp-compact-topbar">
            {trackLine('compact')}
            {actionStrip('compact')}
          </div>
        </>
      )}

      <div
        className="winamp-compact-main"
        style={expandedMainStyle}
        onClick={!winamp.expanded ? handleCompactMainClick : undefined}
      >
        <div className="winamp-host compact" style={expandedHostStyle} ref={compactHostRef} />
        {winamp.expanded && expandedLayoutMode === 'desktop' ? (
          <aside className="winamp-overlay-sidebar">
            <div className="winamp-overlay-card">
              <div className="winamp-overlay-label">{t('winamp.nowTuned')}</div>
              <div className="winamp-overlay-title">
                {current?.name || queue.items[queue.currentIndex]?.name || t('winamp.noStation')}
              </div>
              <div className="winamp-overlay-copy">
                {queue.sourceLabel || t('radio.queueDefault')} - {t('winamp.queueReady', {
                  count: queue.items.length
                })}
              </div>
            </div>
            <div className="winamp-overlay-card">
              <div className="winamp-overlay-label">{t('winamp.upNext')}</div>
              <div className="winamp-overlay-list">
                {overlayQueuePreview.length ? (
                  overlayQueuePreview.map((station) => (
                    <div className="winamp-overlay-item" key={station.stationuuid}>
                      <strong>{station.name}</strong>
                      <span>{station.country || station.state || t('common.unknown')}</span>
                    </div>
                  ))
                ) : (
                  <div className="winamp-overlay-empty">{t('winamp.buildQueue')}</div>
                )}
              </div>
            </div>
          </aside>
        ) : null}
        {!webampReady && (
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
        )}
      </div>

      {winamp.expanded ? (
        <div className="winamp-overlay-footer">
          <div className="winamp-overlay-summary">
            <div className="winamp-overlay-card">
              <div className="winamp-overlay-label">{t('winamp.currentStation')}</div>
              <div className="winamp-overlay-title">
                {current?.name || queue.items[queue.currentIndex]?.name || t('winamp.noStation')}
              </div>
              <div className="winamp-overlay-copy">
                {queue.sourceLabel || t('radio.queueDefault')} - {t('winamp.queueCount', {
                  count: queue.items.length
                })}
              </div>
            </div>
            <div className="winamp-overlay-card">
              <div className="winamp-overlay-label">{t('winamp.recentSessions')}</div>
              <div className="winamp-overlay-list">
                {overlayHistoryPreview.length ? (
                  overlayHistoryPreview.map((station) => (
                    <div className="winamp-overlay-item" key={`${station.stationuuid}-${station.name}`}>
                      <strong>{station.name}</strong>
                      <span>{station.country || station.state || t('common.unknown')}</span>
                    </div>
                  ))
                ) : (
                  <div className="winamp-overlay-empty">{t('winamp.historyEmpty')}</div>
                )}
              </div>
            </div>
          </div>
          {trackLine('overlay')}
          {actionStrip('overlay')}
        </div>
      ) : null}
    </div>
  );
};
