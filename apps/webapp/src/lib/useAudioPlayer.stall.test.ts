import { describe, expect, it } from 'vitest';
import { shouldRecoverFromSilentStall } from './useAudioPlayer';

// The silent-stall watchdog's trigger logic. It must recover a station that went
// quiet (currentTime flat while unpaused) WITHOUT firing over-eagerly during
// pause, startup, or an in-flight recovery — those are handled elsewhere.
const base = {
  paused: false,
  hasPlayed: true,
  hasStation: true,
  recovering: false,
  status: 'playing' as const,
  msSinceProgress: 10_000,
  thresholdMs: 9_000
};

describe('shouldRecoverFromSilentStall', () => {
  it('recovers when playing and playback position has been flat past the threshold', () => {
    expect(shouldRecoverFromSilentStall(base)).toBe(true);
  });

  it('does NOT recover before the threshold (a normal buffer hiccup)', () => {
    expect(shouldRecoverFromSilentStall({ ...base, msSinceProgress: 5_000 })).toBe(false);
  });

  it('does NOT recover when paused (user / sleep timer / headphone unplug)', () => {
    expect(shouldRecoverFromSilentStall({ ...base, paused: true })).toBe(false);
    expect(shouldRecoverFromSilentStall({ ...base, status: 'paused' })).toBe(false);
  });

  it('does NOT recover during startup, before the first audio has played', () => {
    expect(shouldRecoverFromSilentStall({ ...base, hasPlayed: false })).toBe(false);
  });

  it('does NOT double-recover while a rebuffer/reconnect is already in flight', () => {
    expect(shouldRecoverFromSilentStall({ ...base, recovering: true })).toBe(false);
  });

  it('does NOT recover with no active station, or in idle/error states', () => {
    expect(shouldRecoverFromSilentStall({ ...base, hasStation: false })).toBe(false);
    expect(shouldRecoverFromSilentStall({ ...base, status: 'idle' })).toBe(false);
    expect(shouldRecoverFromSilentStall({ ...base, status: 'error' })).toBe(false);
  });

  it('uses the default threshold when none is passed', () => {
    expect(shouldRecoverFromSilentStall({ ...base, thresholdMs: undefined, msSinceProgress: 20_000 })).toBe(true);
    expect(shouldRecoverFromSilentStall({ ...base, thresholdMs: undefined, msSinceProgress: 1_000 })).toBe(false);
  });
});
