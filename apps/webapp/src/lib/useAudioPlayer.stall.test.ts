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

// The case production found before any test did. A hidden tab throttles or
// withholds `timeupdate`, so the msSinceProgress clock goes stale while the
// audio plays on; the first watchdog tick after the listener returns then sees
// minutes of "no progress" and tears down a healthy stream.
//
// Observed 2026-08-15 18:07:56: `audio_visibility_change` (visible) and
// `audio_silent_stall` in the same second, after ~2 minutes hidden, followed by
// a reconnect — four such stalls and six reconnects in that one session.
describe('shouldRecoverFromSilentStall: a backgrounded tab is not a stall', () => {
  it('does NOT recover when the playback position has moved, however stale the clock', () => {
    expect(
      shouldRecoverFromSilentStall({ ...base, positionMoved: true, msSinceProgress: 120_000 })
    ).toBe(false);
  });

  it('still recovers a genuinely flat position past the threshold', () => {
    expect(shouldRecoverFromSilentStall({ ...base, positionMoved: false })).toBe(true);
  });

  it('treats an unspecified position as flat, so existing callers are unchanged', () => {
    expect(shouldRecoverFromSilentStall(base)).toBe(true);
  });
});
