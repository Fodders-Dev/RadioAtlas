import { useEffect, useRef, useState } from 'react';
import type { NowPlayingSnapshot } from '../../domain/contracts';
import { getApiBase } from '../../lib/apiBase';
import {
  fetchNowPlayingSnapshot,
  shouldUseLowImpactMetadata,
  subscribeNowPlaying
} from '../../lib/nowPlaying';
import { IDLE_NOW_PLAYING_STATE } from './nowPlayingDefaults';
import type { PlaybackContextValue } from './types';

type Player = PlaybackContextValue['player'];

export const useNowPlayingSync = ({
  logDebug,
  player
}: {
  logDebug: (message: string) => void;
  player: Player;
}) => {
  const [nowPlaying, setNowPlaying] = useState<string | null>(null);
  const [nowPlayingStatus, setNowPlayingStatus] = useState<
    'idle' | 'loading' | 'ready' | 'unavailable'
  >('idle');
  const [nowPlayingState, setNowPlayingState] = useState<NowPlayingSnapshot>(IDLE_NOW_PLAYING_STATE);
  const nowPlayingStateRef = useRef(nowPlayingState);

  useEffect(() => {
    nowPlayingStateRef.current = nowPlayingState;
  }, [nowPlayingState]);

  useEffect(() => {
    const station = player.current;
    if (!station || !player.isPlaying) {
      setNowPlaying(null);
      setNowPlayingStatus('idle');
      setNowPlayingState(IDLE_NOW_PLAYING_STATE);
      return;
    }

    let active = true;
    let inFlight = false;
    let attempt = 0;
    let pollTimer: number | null = null;
    const controller = new AbortController();
    const isPageVisible = () =>
      typeof document === 'undefined' || document.visibilityState === 'visible';
    const lowImpactMetadata = shouldUseLowImpactMetadata();
    const metadataPollOverride =
      typeof window !== 'undefined' &&
      typeof (window as typeof window & { __RA_METADATA_POLL_MS__?: number }).__RA_METADATA_POLL_MS__ === 'number'
        ? Math.max(
            100,
            Number(
              (window as typeof window & { __RA_METADATA_POLL_MS__?: number }).__RA_METADATA_POLL_MS__
            )
          )
        : null;
    const basePollMs = metadataPollOverride || (lowImpactMetadata ? 45000 : 30000);
    setNowPlayingStatus('loading');
    setNowPlayingState({
      ...IDLE_NOW_PLAYING_STATE,
      status: 'loading',
      recommendedPollMs: basePollMs
    });

    const applySnapshot = (snapshot: NowPlayingSnapshot) => {
      if (!active) return;
      const previousSnapshot = nowPlayingStateRef.current;
      const preserveFreshSseTrack =
        !snapshot.track &&
        previousSnapshot.track &&
        previousSnapshot.source === 'nightride-sse' &&
        previousSnapshot.updatedAt !== null &&
        Date.now() - previousSnapshot.updatedAt < Math.max(basePollMs * 2, 12000);
      const effectiveSnapshot = preserveFreshSseTrack
        ? {
            ...snapshot,
            track: previousSnapshot.track,
            status: 'ready',
            source: previousSnapshot.source,
            failureKind: null,
            updatedAt: previousSnapshot.updatedAt
          }
        : snapshot;
      nowPlayingStateRef.current = effectiveSnapshot;
      setNowPlayingState(effectiveSnapshot);
      if (effectiveSnapshot.track) {
        attempt = 0;
        setNowPlaying(effectiveSnapshot.track);
        setNowPlayingStatus('ready');
      } else {
        setNowPlaying(null);
        setNowPlayingStatus(effectiveSnapshot.status === 'loading' ? 'loading' : 'unavailable');
      }
    };

    const scheduleNext = (baseMs: number, success: boolean) => {
      if (!active) return;
      const nextBaseDelay = success ? baseMs : Math.min(baseMs * 2 ** Math.min(attempt, 2), 90000);
      const delay = isPageVisible() ? nextBaseDelay : Math.max(nextBaseDelay, 90000);
      if (pollTimer !== null) {
        window.clearTimeout(pollTimer);
      }
      pollTimer = window.setTimeout(() => {
        void update();
      }, delay);
    };

    const unsubscribe = subscribeNowPlaying(station, (track) => {
      applySnapshot({
        track,
        status: track ? 'ready' : 'unavailable',
        source: 'nightride-sse',
        failureKind: track ? null : 'metadata-unavailable',
        recommendedPollMs: basePollMs,
        updatedAt: track ? Date.now() : null
      });
    });

    const update = async () => {
      if (inFlight || controller.signal.aborted) {
        return;
      }
      if (!isPageVisible()) {
        scheduleNext(basePollMs, false);
        return;
      }
      inFlight = true;
      try {
        const snapshot = await fetchNowPlayingSnapshot(station, logDebug, {
          signal: controller.signal,
          lowImpact: lowImpactMetadata
        });
        const effectiveSnapshot = metadataPollOverride
          ? { ...snapshot, recommendedPollMs: basePollMs }
          : snapshot;
        if (effectiveSnapshot.track) {
          logDebug(`Metadata: ${effectiveSnapshot.track}`);
        } else {
          attempt += 1;
          logDebug(
            `Metadata: null (${effectiveSnapshot.failureKind || 'no-source'} / API: ${getApiBase() || 'default'})`
          );
        }
        applySnapshot(effectiveSnapshot);
        scheduleNext(effectiveSnapshot.recommendedPollMs, Boolean(effectiveSnapshot.track));
      } catch (metadataError) {
        if (!controller.signal.aborted) {
          attempt += 1;
          logDebug(
            `Metadata Err: ${
              metadataError instanceof Error ? metadataError.message : String(metadataError)
            }`
          );
          const failedSnapshot: NowPlayingSnapshot = {
            track: null,
            status: 'unavailable',
            source: 'none',
            failureKind: 'unknown',
            recommendedPollMs: basePollMs,
            updatedAt: null
          };
          applySnapshot(failedSnapshot);
          scheduleNext(failedSnapshot.recommendedPollMs, false);
        }
      } finally {
        inFlight = false;
      }
    };

    const handleVisibilityChange = () => {
      if (!isPageVisible() || inFlight || controller.signal.aborted) {
        return;
      }
      if (pollTimer !== null) {
        window.clearTimeout(pollTimer);
        pollTimer = null;
      }
      void update();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    void update();

    return () => {
      active = false;
      controller.abort();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (pollTimer !== null) {
        window.clearTimeout(pollTimer);
      }
      unsubscribe?.();
    };
  }, [logDebug, player.current?.stationuuid, player.isPlaying]);

  return {
    nowPlaying,
    nowPlayingStatus,
    nowPlayingState
  };
};
