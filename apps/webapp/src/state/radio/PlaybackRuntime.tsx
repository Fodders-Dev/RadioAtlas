import { useEffect } from 'react';
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

  useEffect(() => {
    onSnapshot({
      player,
      nowPlaying,
      nowPlayingStatus,
      nowPlayingState
    });
  }, [
    nowPlaying,
    nowPlayingState.failureKind,
    nowPlayingState.recommendedPollMs,
    nowPlayingState.source,
    nowPlayingState.status,
    nowPlayingState.track,
    nowPlayingState.updatedAt,
    nowPlayingStatus,
    onSnapshot,
    player,
    player.balance,
    player.current?.stationuuid,
    player.currentTime,
    player.eq.enabled,
    player.eq.preamp,
    player.eq.bands.join(','),
    player.errorMessage,
    player.failure?.kind,
    player.failure?.message,
    player.isPlaying,
    player.status,
    buildTransportSignature(player),
    player.visualizer.active,
    player.visualizer.available,
    player.visualizer.spectrum.join(','),
    player.visualizer.waveform.join(','),
    player.volume
  ]);

  return null;
};
