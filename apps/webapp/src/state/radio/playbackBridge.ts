import type { NowPlayingSnapshot } from '../../domain/contracts';
import type { useAudioPlayer } from '../../lib/useAudioPlayer';

const DEFAULT_EQ_CENTER = 50;
const DEFAULT_EQ_BAND_COUNT = 10;
const DEFAULT_VISUALIZER_BARS = 24;

export type PlaybackRuntimeSnapshot = {
  player: ReturnType<typeof useAudioPlayer>;
  nowPlaying: string | null;
  nowPlayingStatus: 'idle' | 'loading' | 'ready' | 'unavailable';
  nowPlayingState: NowPlayingSnapshot;
};

const createDefaultEqBands = () =>
  Array.from({ length: DEFAULT_EQ_BAND_COUNT }, () => DEFAULT_EQ_CENTER);
const createEmptyVisualizer = () => Array.from({ length: DEFAULT_VISUALIZER_BARS }, () => 0);

export const createPlaybackPlayerPlaceholder = (): ReturnType<typeof useAudioPlayer> => ({
  current: null,
  status: 'idle',
  isPlaying: false,
  failure: null,
  volume: 0.8,
  balance: 0,
  currentTime: 0,
  eq: {
    enabled: true,
    preamp: DEFAULT_EQ_CENTER,
    bands: createDefaultEqBands()
  },
  visualizer: {
    active: false,
    available: false,
    spectrum: createEmptyVisualizer(),
    waveform: createEmptyVisualizer()
  },
  errorMessage: null,
  transport: {
    activeCandidate: null,
    recentFailures: []
  },
  setVolume: () => {},
  setBalance: () => {},
  setEqBand: () => {},
  setEqEnabled: () => {},
  setEqPreamp: () => {},
  resetEq: () => {},
  playStation: async () => ({
    ok: false,
    error: 'Audio engine unavailable'
  }),
  toggle: async () => false,
  stop: () => {}
});
