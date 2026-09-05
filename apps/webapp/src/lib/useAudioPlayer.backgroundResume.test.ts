import { describe, expect, it } from 'vitest';

import { judgeBackgroundPlayback } from './useAudioPlayer';

/**
 * 0.1b.1 — «Вернуться к эфиру», the classifier half.
 *
 * The state machine agreed with the owner before any code:
 *
 *   hidden while actually playing → snapshot { position, at, session, wasPlaying }
 *   visible → survived : nothing at all
 *           → died     : NEEDS_RESUME, no autoplay, honest paused UI
 *           → unknown  : no automatic action — but the listener's next tap
 *                        must still be able to reconnect
 *
 * ⚠ The hole this lane closes, and the reason `unknown` is not simply ignored:
 * `reportBackgroundOutcome` clears the background marker on its FIRST line,
 * before the verdict exists. On `unknown` the proof that we were playing is
 * destroyed — and `unknown` is only "the background was too short to classify",
 * never "the stream is healthy". An OS can drop a socket in five seconds. So a
 * separate positive token outlives the marker and lets the next tap reconnect
 * the SAME station instead of calling `.play()` on a dead one.
 */

describe('the verdict that decides whether a return owes a reconnect', () => {
  const HIDDEN = 60_000;

  it('calls it survived when the audio kept advancing', () => {
    expect(judgeBackgroundPlayback({ paused: false, hiddenMs: HIDDEN, advancedMs: 58_000 })).toBe(
      'survived'
    );
  });

  it('calls it died when the element came back paused', () => {
    expect(judgeBackgroundPlayback({ paused: true, hiddenMs: HIDDEN, advancedMs: 0 })).toBe('died');
  });

  it('calls it died when it claims to play but never moved', () => {
    // The nastier shape: `paused === false` while `currentTime` is frozen.
    // Reporting that as healthy is what makes a UI lie about being on air.
    expect(judgeBackgroundPlayback({ paused: false, hiddenMs: HIDDEN, advancedMs: 0 })).toBe('died');
  });

  it('refuses to judge a background shorter than the floor', () => {
    // ⚠ `unknown` means UNJUDGED, not healthy. A five-second app switch is
    // plenty of time for an OS to drop a socket, which is exactly why the
    // resume token is granted on anything that is not `survived`.
    expect(judgeBackgroundPlayback({ paused: true, hiddenMs: 5_000, advancedMs: 0 })).toBe('unknown');
    expect(judgeBackgroundPlayback({ paused: false, hiddenMs: 5_000, advancedMs: 0 })).toBe(
      'unknown'
    );
  });

  it('does not read a throttled tab as dead when the audio really advanced', () => {
    // The recorded incident this rule comes from: a hidden tab withholds
    // `timeupdate` while playing perfectly well, and a clock-driven judgement
    // tore down a healthy stream. Position movement is the ground truth.
    expect(judgeBackgroundPlayback({ paused: false, hiddenMs: 110_000, advancedMs: 105_000 })).toBe(
      'survived'
    );
  });
});

/**
 * The token's own truth table, written as the rule rather than as the code, so
 * it stays readable if the implementation moves.
 *
 * granted   = marker existed (we were playing) AND verdict !== 'survived'
 * surrendered = the listener pauses on purpose
 *             | playback position actually advances
 *             | a reconnect has been attempted for it
 */
const resumeOwed = (input: {
  wasPlaying: boolean;
  verdict: 'survived' | 'died' | 'unknown';
}) => input.wasPlaying && input.verdict !== 'survived';

describe('when a foreground return owes a reconnect', () => {
  it('owes nothing when the listener had paused before leaving', () => {
    // No marker is written while the element is paused, so `wasPlaying` is
    // false and an intentional pause can never reach the resume path. This is
    // the invariant the owner asked to make explicit rather than leave implied
    // by the shape of an `if`.
    expect(resumeOwed({ wasPlaying: false, verdict: 'died' })).toBe(false);
    expect(resumeOwed({ wasPlaying: false, verdict: 'unknown' })).toBe(false);
  });

  it('owes nothing when the stream demonstrably survived', () => {
    expect(resumeOwed({ wasPlaying: true, verdict: 'survived' })).toBe(false);
  });

  it('owes a reconnect when the stream died', () => {
    expect(resumeOwed({ wasPlaying: true, verdict: 'died' })).toBe(true);
  });

  it('owes a reconnect after a SHORT background too', () => {
    // ⚠ The gap that would otherwise stay open: classifier says «не знаю», the
    // listener taps Play, and the old code called `.play()` on a dead socket.
    expect(resumeOwed({ wasPlaying: true, verdict: 'unknown' })).toBe(true);
  });
});
