import type { StationLite } from '../../types';
import { stationLocation } from '../../lib/stationUtils';
import { EQ_BANDS } from '../../lib/useAudioPlayer';
import { getSilentAudioUrl } from '../../lib/silentAudio';
import { getWebampRootNode } from '../../lib/winampBridge';
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
  setSkinFromUrl?: (url: string) => Promise<void> | void;
  play?: () => void;
  setVolume?: (volume: number) => void;
  setBalance?: (balance: number) => void;
  store?: {
    dispatch?: (action: { type: string; [key: string]: unknown }) => void;
    getState?: () => {
      playlist?: {
        currentTrack?: number | null;
      };
      media?: {
        status?: 'STOPPED' | 'PLAYING' | 'PAUSED' | 'ENDED';
        timeMode?: 'ELAPSED' | 'REMAINING';
      };
    };
  };
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
  getStoreState: () => unknown;
  dispatchStoreAction: (action: { type: string; [key: string]: unknown }) => void;
};
type ExpandedWindowMetric = {
  id: ExpandedWindowId;
  node: HTMLElement;
  width: number;
  height: number;
};

let webampCtorPromise: Promise<WebampCtor> | null = null;
let webampZipPromise: Promise<unknown> | null = null;
let webampMetadataPromise: Promise<unknown> | null = null;
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

const getWebampLazyDependencies = () => ({
  requireJSZip: () => {
    if (!webampZipPromise) {
      webampZipPromise = import('jszip').then((mod) => mod.default ?? mod);
    }
    return webampZipPromise as Promise<any>;
  },
  requireMusicMetadata: () => {
    if (!webampMetadataPromise) {
      webampMetadataPromise = import('./musicMetadataStub');
    }
    return webampMetadataPromise as Promise<any>;
  }
});

const LEGACY_WEBAMP_MODULE_URL = '/vendor/webamp/webamp.lazy-bundle.min.mjs';

const loadWebampCtor = async () => {
  if (!webampCtorPromise) {
    webampCtorPromise = import(/* @vite-ignore */ LEGACY_WEBAMP_MODULE_URL).then(
      (mod) => mod.default as unknown as WebampCtor
    );
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
const toWebampBalance = (value: number) => Math.round(clamp(value, -100, 100));
const LIVE_STREAM_FAKE_DURATION_SECONDS = 60 * 60 * 12;
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

const formatElapsedTime = (value: number) => {
  const safeSeconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const buildTracks = (playlist: StationLite[]): WebampTrack[] =>
  playlist.map((station) => ({
    // Webamp stays on a same-origin silent asset so its own transport/timer/status
    // remain alive without touching real station networking.
    url: getSilentAudioUrl(),
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

export type {
  CompactViewMode,
  ExpandedViewportBounds,
  ExpandedWindowId,
  ExpandedWindowMetric,
  ResponsiveExpandedMode,
  WebampCtor,
  WebampInstance,
  WebampTrack,
  WinampDevApi
};

export {
  BOOT_WINDOW_WAIT_MS,
  COMPACT_INTERACTIVE_SELECTOR,
  COMPACT_TRANSPORT_SELECTOR,
  EXPANDED_WINDOW_ORDER,
  EXPANDED_WINDOW_Z_ORDER,
  FULL_WINDOW_HEIGHT,
  LIVE_STREAM_FAKE_DURATION_SECONDS,
  MAIN_WINDOW_WIDTH,
  MIN_COMPACT_SCALE,
  MOBILE_EXPANDED_BREAKPOINT,
  PANEL_COMPACT_MAX_HEIGHT,
  PANEL_COMPACT_MIN_HEIGHT,
  PLAYLIST_WINDOW_HEIGHT,
  SHADED_WINDOW_HEIGHT,
  STRIP_COMPACT_MAX_HEIGHT,
  STRIP_COMPACT_MIN_HEIGHT,
  buildPersistentLayout,
  buildTracks,
  canonicalTrackUrl,
  clamp,
  ensureExpandedWindowsVisible,
  enforceCompactWindowVisibility,
  formatElapsedTime,
  getEqSliderValueFromBand,
  getExpandedViewportBounds,
  getExpandedWindowId,
  getMainWindowNode,
  getResponsiveExpandedMode,
  getSliderValue,
  getWebampWindowNodes,
  getWindowById,
  isWindowRenderable,
  isWindowShaded,
  isWindowVisible,
  isWindowVisibleInCompactHost,
  isWindowVisibleOnViewport,
  getWebampLazyDependencies,
  loadWebampCtor,
  measureExpandedWindowMetric,
  placeExpandedWindowAnchor,
  readExpandedAnchorTransform,
  resetCompactWindowVisibility,
  resetIntermediateAnchors,
  resetWebampWindowPlacement,
  resolveCompactWindowAnchor,
  resolveExpandedWindowAnchor,
  setMainWindowShadeMode,
  setWindowVisibility,
  syncCompactWindowPlacement,
  toAssetUrl,
  toErrorMessage,
  toPlayerVolume,
  toWebampBalance,
  toWebampVolume,
  waitForMainWindow
};
