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

const VISUALIZER_EMIT_INTERVAL_MS = 240;

const buildTransportSignature = (player: ReturnType<typeof useAudioPlayer>) =>
  [
    player.transport.activeCandidate?.url || '',
    ...player.transport.recentFailures.map((failure) => `${failure.phase}:${failure.message}`)
  ].join('|');

const buildVisualizerSignature = (player: ReturnType<typeof useAudioPlayer>) => {
  const spectrumGroupCount = 6;
  const waveformGroupCount = 4;
  const spectrumGroups = Array.from({ length: spectrumGroupCount }, (_, groupIndex) => {
    const start = Math.floor((groupIndex * player.visualizer.spectrum.length) / spectrumGroupCount);
    const end = Math.max(
      start + 1,
      Math.floor(((groupIndex + 1) * player.visualizer.spectrum.length) / spectrumGroupCount)
    );
    let total = 0;
    for (let cursor = start; cursor < end; cursor += 1) {
      total += player.visualizer.spectrum[cursor] ?? 0;
    }
    return Math.round((total / Math.max(1, end - start)) * 4);
  });
  const waveformGroups = Array.from({ length: waveformGroupCount }, (_, groupIndex) => {
    const start = Math.floor((groupIndex * player.visualizer.waveform.length) / waveformGroupCount);
    const end = Math.max(
      start + 1,
      Math.floor(((groupIndex + 1) * player.visualizer.waveform.length) / waveformGroupCount)
    );
    let total = 0;
    for (let cursor = start; cursor < end; cursor += 1) {
      total += Math.abs(player.visualizer.waveform[cursor] ?? 0);
    }
    return Math.round((total / Math.max(1, end - start)) * 4);
  });

  return [
    player.visualizer.active ? '1' : '0',
    player.visualizer.available ? '1' : '0',
    ...spectrumGroups,
    ...waveformGroups
  ].join('|');
};

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
  const lastVisualizerSignatureRef = useRef('');
  const lastVisualizerEmitAtRef = useRef(0);
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
    nowPlaying || '',
    nowPlayingStatus,
    nowPlayingState.status,
    nowPlayingState.source,
    nowPlayingState.failureKind || '',
    String(nowPlayingState.recommendedPollMs),
    String(nowPlayingState.updatedAt || ''),
    nowPlayingState.track || ''
  ].join('|');
  const visualizerSignature = buildVisualizerSignature(player);

  useEffect(() => {
    latestPlayerRef.current = player;
  }, [player]);

  useEffect(() => {
    const baseChanged = lastBaseSignatureRef.current !== baseSignature;
    const visualizerChanged = lastVisualizerSignatureRef.current !== visualizerSignature;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const shouldEmitVisualizer =
      visualizerChanged &&
      (!latestPlayerRef.current.visualizer.active ||
        now - lastVisualizerEmitAtRef.current >= VISUALIZER_EMIT_INTERVAL_MS);

    if (!baseChanged && !shouldEmitVisualizer) {
      return;
    }

    if (baseChanged) {
      lastBaseSignatureRef.current = baseSignature;
    }

    if (shouldEmitVisualizer) {
      lastVisualizerSignatureRef.current = visualizerSignature;
      lastVisualizerEmitAtRef.current = now;
    }

    const previousSnapshot = lastSnapshotRef.current;
    const nextSnapshot: PlaybackRuntimeSnapshot = {
      player: {
        ...latestPlayerRef.current,
        currentTime: roundedCurrentTime,
        visualizer:
          shouldEmitVisualizer || !previousSnapshot
            ? {
                ...latestPlayerRef.current.visualizer,
                spectrum: [...latestPlayerRef.current.visualizer.spectrum],
                waveform: [...latestPlayerRef.current.visualizer.waveform]
              }
            : previousSnapshot.player.visualizer
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
    roundedCurrentTime,
    visualizerSignature
  ]);

  return null;
};
