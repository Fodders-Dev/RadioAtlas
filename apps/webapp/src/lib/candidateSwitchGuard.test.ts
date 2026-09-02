import { describe, expect, it } from 'vitest';

import {
  MAX_PLAY_PENDING_DEFERRALS,
  PLAY_PENDING_RECHECK_MS,
  decideCandidateSwitch
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
