import { describe, expect, it } from 'vitest';

import {
  MAX_PLAY_PENDING_DEFERRALS,
  PLAY_PENDING_RECHECK_MS,
  SILENT_STARTUP_PROBE_MS,
  decideCandidateSwitch,
  hasStreamStartedArriving
} from './candidateSwitchGuard';

/**
 * Production, 24 hours: 11 of 33 plays ended in `no-playable-candidate`, and the
 * failure details were `The operation was aborted.` — raised by our own
 * `audio.load()` on top of a `play()` that had not settled yet. The stations
 * involved were alive and answered in under 300ms when probed.
 */

describe('decideCandidateSwitch', () => {
  it('switches immediately when no play is in flight', () => {
    expect(decideCandidateSwitch({ playPending: false, deferrals: 0 })).toEqual({
      action: 'switch'
    });
  });

  it('holds while a play is pending, because tearing it down is the bug', () => {
    expect(decideCandidateSwitch({ playPending: true, deferrals: 0 })).toEqual({
      action: 'defer',
      recheckMs: PLAY_PENDING_RECHECK_MS,
      deferrals: 1
    });
  });

  it('gives up holding rather than waiting on a promise that never settles', () => {
    // The watchdog exists for hangs; a play() that never resolves is one, so the
    // guard must not turn into a way of never recovering.
    const decision = decideCandidateSwitch({
      playPending: true,
      deferrals: MAX_PLAY_PENDING_DEFERRALS
    });
    expect(decision).toEqual({ action: 'switch' });
  });

  it('bounds the total wait it can add', () => {
    // Two deferrals of 2.5s each: a slow station gets five extra seconds to
    // start, and a hung one costs five seconds before the watchdog proceeds.
    expect(MAX_PLAY_PENDING_DEFERRALS * PLAY_PENDING_RECHECK_MS).toBeLessThanOrEqual(6000);
  });

  it('walks the whole deferral ladder and then switches', () => {
    let deferrals = 0;
    const actions: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const decision = decideCandidateSwitch({ playPending: true, deferrals });
      actions.push(decision.action);
      if (decision.action === 'defer') deferrals = decision.deferrals;
    }
    expect(actions).toEqual(['defer', 'defer', 'switch', 'switch']);
  });
});

/**
 * The other half of the same watchdog: telling a STALLED upstream from a slow
 * one, so the first stops costing a listener 25-30 seconds of silence and the
 * second keeps every millisecond of grace it has today.
 *
 * Measured 2026-09-01 in Chromium over the direct route, 54 promoted https
 * stations one at a time with a 20 s budget:
 *   - of the 24 that produced audio, time to first `currentTime` movement was
 *     p50 1602 ms, p90 3100 ms, p95 3702 ms, max 5915 ms;
 *   - of the 30 that produced none, 29 still had `readyState === 0`.
 */
describe('hasStreamStartedArriving', () => {
  const nothing = { readyState: 0, bufferedLength: 0, currentTime: 0 };

  it('is false when nothing at all has arrived — the stalled signature', () => {
    // 29 of the 30 stations that never played looked exactly like this, and so
    // did Gamesboro for 25-30 s while trickling ~1.3 KB/s: bytes on the wire,
    // nothing a listener could hear.
    expect(hasStreamStartedArriving(nothing)).toBe(false);
  });

  it('is true as soon as metadata is parsed, which is what "slow but live" looks like', () => {
    expect(hasStreamStartedArriving({ ...nothing, readyState: 1 })).toBe(true);
  });

  it('is true on a buffered range even with readyState still 0', () => {
    // Belt and braces: the three signals are ORed on purpose, because any one of
    // them means the route works and only the speed is in question.
    expect(hasStreamStartedArriving({ ...nothing, bufferedLength: 1 })).toBe(true);
  });

  it('is true once the position has moved at all', () => {
    expect(hasStreamStartedArriving({ ...nothing, currentTime: 0.01 })).toBe(true);
  });
});

describe('SILENT_STARTUP_PROBE_MS', () => {
  it('clears the slowest healthy start that was actually measured', () => {
    // max was 5915 ms. A probe at or below that would divert a station that was
    // going to play, to the proxy, at our bandwidth.
    expect(SILENT_STARTUP_PROBE_MS).toBeGreaterThan(5915);
  });

  it('is well short of the full startup grace it shortens', () => {
    // The grace is 15000 ms in useAudioPlayer, and the point of this constant is
    // that a stream which produced NOTHING should not sit through all of it.
    expect(SILENT_STARTUP_PROBE_MS).toBeLessThan(15000);
  });

  it('leaves room for the pending-play deferrals on top of it', () => {
    // The early deadline is not the whole wait: a play() still in flight can add
    // two rechecks after it. That total is what a listener actually experiences.
    const worstCase = SILENT_STARTUP_PROBE_MS + MAX_PLAY_PENDING_DEFERRALS * PLAY_PENDING_RECHECK_MS;
    expect(worstCase).toBeLessThan(15000);
  });
});
