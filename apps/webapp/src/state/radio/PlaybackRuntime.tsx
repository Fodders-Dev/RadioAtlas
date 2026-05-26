import { useEffect, useRef } from 'react';
import type { NowPlayingSnapshot } from '../../domain/contracts';
import { useAudioPlayer } from '../../lib/useAudioPlayer';
import { useNowPlayingSync } from './useNowPlayingSync';

type PlaybackRuntimeSnapshot = {
  player: ReturnType<typeof useAudioPlayer>;
  nowPlaying: string | null;
  nowPlayingStatus: 'idle' | 'loading' | 'ready' | 'unavailable';
  nowPlayingState: NowPlayingSnapshot;
};

type PlaybackRuntimeProps = {
  logDebug: (message: string) => void;
  onSnapshot: (snapshot: PlaybackRuntimeSnapshot) => void;
};

const buildTransportSignature = (player: ReturnType<typeof useAudioPlayer>) =>
  [
    player.transport.activeCandidate?.url || '',
    ...player.transport.recentFailures.map((failure) => `${failure.phase}:${failure.message}`)
  ].join('|');

export const PlaybackRuntime = ({ logDebug, onSnapshot }: PlaybackRuntimeProps) => {
  const player = useAudioPlayer({
    onEvent: logDebug
  });
  const { nowPlaying, nowPlayingStatus, nowPlayingState } = useNowPlayingSync({
    logDebug,
    player
  });
  const latestPlayerRef = useRef(player);
  const lastBaseSignatureRef = useRef('');
  const lastSnapshotRef = useRef<PlaybackRuntimeSnapshot | null>(null);
  const roundedCurrentTime = Math.max(0, Math.floor(player.currentTime));
  const baseSignature = [
    player.current?.stationuuid || '',
    player.status,
    player.isPlaying ? '1' : '0',
    player.volume.toFixed(3),
    String(player.balance),
    String(roundedCurrentTime),
    player.eq.enabled ? '1' : '0',
    String(player.eq.preamp),
    player.eq.bands.join(','),
    player.errorMessage || '',
    player.failure?.kind || '',
    player.failure?.message || '',
    buildTransportSignature(player),
    // Visualizer is now a low-frequency boolean pair — spectrum/waveform
    // are pushed via player.subscribeVisualizer, NOT React state — so it
    // no longer drives ~30 Hz re-renders/snapshots. (T2.1)
    player.visualizer.active ? '1' : '0',
    player.visualizer.available ? '1' : '0',
    nowPlaying || '',
    nowPlayingStatus,
    nowPlayingState.status,
    nowPlayingState.source,
    nowPlayingState.failureKind || '',
    String(nowPlayingState.recommendedPollMs),
    String(nowPlayingState.updatedAt || ''),
    nowPlayingState.track || ''
  ].join('|');

  useEffect(() => {
    latestPlayerRef.current = player;
  }, [player]);

  useEffect(() => {
    if (lastBaseSignatureRef.current === baseSignature && lastSnapshotRef.current) {
      return;
    }
    lastBaseSignatureRef.current = baseSignature;

    const nextSnapshot: PlaybackRuntimeSnapshot = {
      player: {
        ...latestPlayerRef.current,
        currentTime: roundedCurrentTime
      },
      nowPlaying,
      nowPlayingStatus,
      nowPlayingState
    };

    lastSnapshotRef.current = nextSnapshot;
    onSnapshot(nextSnapshot);
  }, [
    baseSignature,
    onSnapshot,
    nowPlaying,
    nowPlayingState,
    nowPlayingStatus,
    roundedCurrentTime
  ]);

  return null;
};
