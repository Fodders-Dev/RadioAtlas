import { useEffect, type MutableRefObject } from 'react';
import { getWebampRootNode } from '../../lib/winampBridge';
import type { useAudioPlayer } from '../../lib/useAudioPlayer';
import type { StationLite } from '../../types';
import {
  LIVE_STREAM_FAKE_DURATION_SECONDS,
  buildTracks,
  getSliderValue,
  toPlayerVolume,
  toWebampBalance,
  toWebampVolume,
  type WebampInstance
} from './runtime';

type Player = ReturnType<typeof useAudioPlayer>;

type UseWinampTransportSyncArgs = {
  player: Player;
  playablePlaylist: StationLite[];
  playlistSignature: string;
  playlistSignatureRef: MutableRefObject<string>;
  webampReady: boolean;
  webampRef: MutableRefObject<WebampInstance | null>;
  lastElapsedTimeSyncRef: MutableRefObject<number | null>;
  lastAppliedVolumeRef: MutableRefObject<number | null>;
  lastAppliedBalanceRef: MutableRefObject<number | null>;
  suppressVolumeSyncUntilRef: MutableRefObject<number>;
  syncExpandedEqStateFromDom: () => void;
  activeSkinUrl: string;
};

export const useWinampTransportSync = ({
  activeSkinUrl,
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
}: UseWinampTransportSyncArgs) => {
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
  }, [playablePlaylist, playlistSignature, playlistSignatureRef, webampReady, webampRef]);

  useEffect(() => {
    if (!webampReady) return;
    const instance = webampRef.current;
    const status = instance?.store?.getState?.()?.media?.status;
    if (!instance) return;

    if (!player.current) {
      lastElapsedTimeSyncRef.current = null;
      if (status && status !== 'STOPPED') {
        try {
          instance.stop?.();
        } catch {
          // ignore
        }
      }
      return;
    }

    if (player.isPlaying) {
      if (status !== 'PLAYING') {
        try {
          instance.play?.();
        } catch {
          // ignore
        }
      }
      return;
    }

    if (status === 'PLAYING') {
      try {
        instance.pause?.();
      } catch {
        // ignore
      }
    }
  }, [lastElapsedTimeSyncRef, player.current?.stationuuid, player.isPlaying, player.currentTime, webampReady, webampRef]);

  useEffect(() => {
    const instance = webampRef.current;
    if (!instance?.store?.dispatch || !instance.store.getState || !webampReady) return;

    const nextElapsed = Math.max(0, Math.floor(player.currentTime));
    if (lastElapsedTimeSyncRef.current === nextElapsed) return;

    lastElapsedTimeSyncRef.current = nextElapsed;
    const currentTrackId = instance.store.getState().playlist?.currentTrack;
    const scrubPosition =
      LIVE_STREAM_FAKE_DURATION_SECONDS > 0
        ? Math.min(100, (nextElapsed / LIVE_STREAM_FAKE_DURATION_SECONDS) * 100)
        : 0;
    try {
      instance.store.dispatch({
        type: 'UPDATE_TIME_ELAPSED',
        elapsed: nextElapsed
      });
      if (currentTrackId !== null && currentTrackId !== undefined) {
        instance.store.dispatch({
          type: 'SET_MEDIA_DURATION',
          id: currentTrackId,
          duration: LIVE_STREAM_FAKE_DURATION_SECONDS
        });
      }
      instance.store.dispatch({
        type: 'SET_SCRUB_POSITION',
        position: scrubPosition
      });
    } catch (error) {
      console.error('Winamp elapsed time sync failed', error);
    }
  }, [lastElapsedTimeSyncRef, player.currentTime, webampReady, webampRef]);

  useEffect(() => {
    const instance = webampRef.current;
    if (!instance?.store?.dispatch || !instance.store.getState || !webampReady) return;

    const timeMode = instance.store.getState().media?.timeMode;
    if (timeMode !== 'REMAINING') return;

    try {
      instance.store.dispatch({
        type: 'TOGGLE_TIME_MODE'
      });
    } catch (error) {
      console.error('Winamp time mode sync failed', error);
    }
  }, [activeSkinUrl, webampReady, webampRef]);

  useEffect(() => {
    const instance = webampRef.current;
    if (!instance || !webampReady) return;

    const nextVolume = toWebampVolume(player.volume);
    if (lastAppliedVolumeRef.current === nextVolume) return;

    lastAppliedVolumeRef.current = nextVolume;
    suppressVolumeSyncUntilRef.current = Date.now() + 160;
    try {
      instance.setVolume?.(nextVolume);
    } catch (error) {
      console.error('Winamp volume sync failed', error);
    }
  }, [lastAppliedVolumeRef, player.volume, suppressVolumeSyncUntilRef, webampReady, webampRef]);

  useEffect(() => {
    const instance = webampRef.current;
    if (!instance || !webampReady) return;

    const nextBalance = toWebampBalance(player.balance);
    if (lastAppliedBalanceRef.current === nextBalance) return;

    lastAppliedBalanceRef.current = nextBalance;
    suppressVolumeSyncUntilRef.current = Date.now() + 160;
    try {
      instance.setBalance?.(nextBalance);
    } catch (error) {
      console.error('Winamp balance sync failed', error);
    }
  }, [lastAppliedBalanceRef, player.balance, suppressVolumeSyncUntilRef, webampReady, webampRef]);

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
      const value = getSliderValue(balanceNode);
      if (value === null) return;
      const nextBalance = toWebampBalance(value);
      if (Math.abs(player.balance - nextBalance) < 0.5) return;
      lastAppliedBalanceRef.current = nextBalance;
      player.setBalance(nextBalance);
    };

    document.addEventListener('input', onSliderChange, true);
    document.addEventListener('change', onSliderChange, true);
    document.addEventListener('mouseup', onSliderChange, true);

    return () => {
      document.removeEventListener('input', onSliderChange, true);
      document.removeEventListener('change', onSliderChange, true);
      document.removeEventListener('mouseup', onSliderChange, true);
    };
  }, [
    lastAppliedBalanceRef,
    lastAppliedVolumeRef,
    player,
    player.balance,
    player.volume,
    suppressVolumeSyncUntilRef,
    webampReady
  ]);

  useEffect(() => {
    if (!webampReady) return;

    let frameId: number | null = null;
    let mutationObserver: MutationObserver | null = null;
    let intervalId: number | null = null;

    const syncEq = () => {
      frameId = null;
      syncExpandedEqStateFromDom();
    };

    const queueEqSync = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(syncEq);
    };

    queueEqSync();
    intervalId = window.setInterval(queueEqSync, 120);

    if (typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(queueEqSync);
      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class']
      });
    }

    document.addEventListener('input', queueEqSync, true);
    document.addEventListener('change', queueEqSync, true);
    document.addEventListener('mouseup', queueEqSync, true);
    document.addEventListener('touchend', queueEqSync, true);
    document.addEventListener('click', queueEqSync, true);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
      mutationObserver?.disconnect();
      document.removeEventListener('input', queueEqSync, true);
      document.removeEventListener('change', queueEqSync, true);
      document.removeEventListener('mouseup', queueEqSync, true);
      document.removeEventListener('touchend', queueEqSync, true);
      document.removeEventListener('click', queueEqSync, true);
    };
  }, [player, player.eq.bands, player.eq.enabled, player.eq.preamp, syncExpandedEqStateFromDom, webampReady]);

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

  return {
    quietWebampPlayback: () => {
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
    }
  };
};
