import type { NowPlayingSnapshot } from '../../domain/contracts';

export const IDLE_NOW_PLAYING_STATE: NowPlayingSnapshot = {
  track: null,
  status: 'idle',
  source: 'none',
  failureKind: null,
  recommendedPollMs: 30000,
  updatedAt: null
};
