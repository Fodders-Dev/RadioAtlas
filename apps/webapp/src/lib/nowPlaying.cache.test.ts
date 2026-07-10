import { beforeEach, describe, expect, it } from 'vitest';
import { applyStoredTrackFallback } from './nowPlaying';
import type { NowPlayingSnapshot } from '../domain/contracts';

const snap = (over: Partial<NowPlayingSnapshot>): NowPlayingSnapshot => ({
  track: null,
  status: 'unavailable',
  source: 'none',
  failureKind: null,
  recommendedPollMs: 30000,
  updatedAt: null,
  ...over
});

describe('applyStoredTrackFallback (active-player anti-flicker)', () => {
  beforeEach(() => localStorage.clear());

  it('saves a live title, then serves it as last-known on a later empty poll', () => {
    const key = 'station-x';
    applyStoredTrackFallback(key, snap({ track: 'Artist - Song', status: 'ready', source: 'channel-api', updatedAt: Date.now() }));
    const recovered = applyStoredTrackFallback(key, snap({ status: 'unavailable', failureKind: 'metadata-unavailable' }));
    expect(recovered.track).toBe('Artist - Song');
    expect(recovered.source).toBe('cache');
    expect(recovered.status).toBe('ready');
  });

  it('leaves an empty snapshot blank when nothing was ever cached for that station', () => {
    const recovered = applyStoredTrackFallback('never-seen', snap({}));
    expect(recovered.track).toBeNull();
  });
});
