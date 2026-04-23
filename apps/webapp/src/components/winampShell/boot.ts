import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { StationLite } from '../../types';
import {
  BOOT_WINDOW_WAIT_MS,
  buildPersistentLayout,
  buildTracks,
  getMainWindowNode,
  getWebampLazyDependencies,
  getWindowById,
  isWindowVisibleInCompactHost,
  isWindowVisibleOnViewport,
  loadWebampCtor,
  resetWebampWindowPlacement,
  syncCompactWindowPlacement,
  toAssetUrl,
  toErrorMessage,
  waitForMainWindow,
  type ResponsiveExpandedMode,
  type WebampInstance
} from './runtime';

type AvailableSkin = {
  name: string;
  url: string;
};

type BootWebampInstanceArgs = {
  mountNode: HTMLElement;
  activeSkinUrl: string;
  availableSkins: AvailableSkin[];
  playablePlaylist: StationLite[];
  isExpanded: () => boolean;
  isCancelled: () => boolean;
  applyExpandedLayout: (mountNode: HTMLElement) => void;
  applyCompactLayout: (mountNode: HTMLElement) => void;
  onClosed: () => void;
};

type BootWebampInstanceResult = {
  instance: WebampInstance;
  unsubscribeWillClose: (() => void) | null;
  unsubscribeClosed: (() => void) | null;
};

export const disposeWebampInstance = (instance: WebampInstance | null | undefined) => {
  if (!instance) return;
  try {
    instance.stop?.();
  } catch {
    // ignore
  }
  try {
    instance.dispose();
  } catch {
    // ignore
  }
};

export const resetBootSurface = ({
  mountNode,
  setBootError,
  setWebampFailed,
  setWebampReady
}: {
  mountNode: HTMLElement;
  setBootError: (value: string | null) => void;
  setWebampFailed: (value: boolean) => void;
  setWebampReady: (value: boolean) => void;
}) => {
  mountNode.innerHTML = '';
  resetWebampWindowPlacement();
  setWebampReady(false);
  setWebampFailed(false);
  setBootError(null);
};

export const bootWebampInstance = async ({
  activeSkinUrl,
  applyCompactLayout,
  applyExpandedLayout,
  availableSkins,
  isCancelled,
  isExpanded,
  mountNode,
  onClosed,
  playablePlaylist
}: BootWebampInstanceArgs): Promise<BootWebampInstanceResult> => {
  const Webamp = await loadWebampCtor();
  if (isCancelled()) {
    throw new Error('cancelled');
  }

  const fallbackSkinUrl = availableSkins[0]?.url || activeSkinUrl;
  const skinCandidates = Array.from(
    new Set([toAssetUrl(activeSkinUrl), toAssetUrl(fallbackSkinUrl)])
  );

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const skinUrl of skinCandidates) {
      for (const useLayout of [true, false]) {
        try {
          const instance = new Webamp({
            initialSkin: {
              url: skinUrl
            },
            ...getWebampLazyDependencies(),
            availableSkins: availableSkins.map((skin) => ({
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
          const ready = await waitForMainWindow(BOOT_WINDOW_WAIT_MS, isCancelled);
          if (!ready) {
            disposeWebampInstance(instance);
            throw new Error('Webamp main window missing after boot');
          }
          if (isCancelled()) {
            disposeWebampInstance(instance);
            throw new Error('cancelled');
          }

          const unsubscribeWillClose = instance.onWillClose?.((cancel) => cancel()) ?? null;
          const unsubscribeClosed = instance.onClose?.(() => {
            if (!isCancelled()) {
              onClosed();
            }
          }) ?? null;

          if (isExpanded()) {
            applyExpandedLayout(mountNode);
          } else {
            let placementAttempt = 0;
            const ensureCompactPlacement = () => {
              if (isCancelled()) return;
              applyCompactLayout(mountNode);
              placementAttempt += 1;
              if (placementAttempt < 6) {
                window.setTimeout(ensureCompactPlacement, 180);
              }
            };
            window.setTimeout(ensureCompactPlacement, 80);
          }

          return {
            instance,
            unsubscribeWillClose,
            unsubscribeClosed
          };
        } catch (error) {
          lastError = error;
          if (isCancelled()) {
            throw error;
          }
          console.error(
            `Winamp init failed (attempt ${attempt + 1}, layout=${useLayout ? 'on' : 'off'})`,
            error
          );
          mountNode.innerHTML = '';
        }
      }
    }

    if (attempt === 2 || isCancelled()) {
      break;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 200 * (attempt + 1)));
  }

  throw new Error(toErrorMessage(lastError));
};

export const recoverExpandedWindows = ({
  beforeSync,
  expandedRecoveryAttemptsRef,
  setBootCycle,
  syncExpandedWindowPlacement,
  winamp
}: {
  beforeSync?: (mode: ResponsiveExpandedMode) => void;
  expandedRecoveryAttemptsRef: MutableRefObject<number>;
  setBootCycle: Dispatch<SetStateAction<number>>;
  syncExpandedWindowPlacement: (mode: ResponsiveExpandedMode) => boolean;
  winamp: {
    expanded: boolean;
    resetLayout: () => void;
    windowVisibility: {
      'equalizer-window': boolean;
      'playlist-window': boolean;
    };
  };
}) => {
  const mainWindow = getWindowById('main-window');
  if (isWindowVisibleOnViewport(mainWindow)) {
    expandedRecoveryAttemptsRef.current = 0;
    return false;
  }

  expandedRecoveryAttemptsRef.current += 1;
  console.warn(
    `Winamp window hidden after boot; recovery attempt ${expandedRecoveryAttemptsRef.current}`
  );
  winamp.resetLayout();
  const mode =
    window.innerWidth <= 760 || window.matchMedia('(max-width: 760px)').matches ? 'mobile' : 'desktop';
  beforeSync?.(mode);
  syncExpandedWindowPlacement(mode);

  if (expandedRecoveryAttemptsRef.current >= 2) {
    setBootCycle((value) => value + 1);
    expandedRecoveryAttemptsRef.current = 0;
  }
  return true;
};

export const recoverCompactWindow = ({
  applyCompactLayout,
  compactRecoveryAttemptsRef,
  mountNode,
  setBootCycle,
  winamp
}: {
  applyCompactLayout: (mountNode: HTMLElement) => void;
  compactRecoveryAttemptsRef: MutableRefObject<number>;
  mountNode: HTMLElement;
  setBootCycle: Dispatch<SetStateAction<number>>;
  winamp: {
    compactMode: 'strip' | 'panel';
    expanded: boolean;
  };
}) => {
  const mainWindow = getMainWindowNode();
  const visibleOnScreen = isWindowVisibleOnViewport(mainWindow);
  const visibleInHost = isWindowVisibleInCompactHost(mainWindow, mountNode);
  if (visibleOnScreen && visibleInHost) {
    compactRecoveryAttemptsRef.current = 0;
    return false;
  }

  compactRecoveryAttemptsRef.current += 1;
  console.warn(
    `Winamp compact window hidden after boot; recovery attempt ${compactRecoveryAttemptsRef.current}`
  );
  applyCompactLayout(mountNode);
  window.setTimeout(() => {
    if (!winamp.expanded) {
      syncCompactWindowPlacement(mountNode, winamp.compactMode);
    }
  }, 110);

  if (compactRecoveryAttemptsRef.current >= 3) {
    setBootCycle((value) => value + 1);
    compactRecoveryAttemptsRef.current = 0;
  }
  return true;
};
