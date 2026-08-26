import { describe, expect, it } from 'vitest';
import { judgeBackgroundPlayback } from './useAudioPlayer';

/**
 * Whether playback survives a trip to the background is the question that decides
 * whether a native app is ever worth building — radio is listened to with the
 * phone in a pocket, and a Trusted Web Activity would not change the answer,
 * because it runs the same web engine. Until now only the DEPARTURE was recorded
 * (`audio_background_resume_attempt`), never the outcome.
 *
 * Everything here is judged from POSITION MOVEMENT, never wall clock: a hidden
 * tab throttles timers and withholds `timeupdate` while the audio plays on, so a
 * clock-driven judgement would report healthy playback as dead and send us
 * chasing a bug that does not exist.
 */
const alive = { paused: false, hiddenMs: 30_000, advancedMs: 30_000 };

describe('judgeBackgroundPlayback', () => {
  it('calls it survived when position kept up with the time spent hidden', () => {
    expect(judgeBackgroundPlayback(alive)).toBe('survived');
  });

  it('calls it died when the element came back paused', () => {
    expect(judgeBackgroundPlayback({ ...alive, paused: true })).toBe('died');
  });

  it('calls it died when position did not move at all', () => {
    expect(judgeBackgroundPlayback({ ...alive, advancedMs: 0 })).toBe('died');
  });

  it('calls it died when the stream stopped partway through', () => {
    // Away for 30s, only 8s of audio played: it died about a quarter of the way in.
    expect(judgeBackgroundPlayback({ ...alive, advancedMs: 8_000 })).toBe('died');
  });

  it('still calls it survived through a rebuffer, which is not a death', () => {
    // 30s away, 24s of audio — a few seconds of rebuffering. Counting this as a
    // death would invent a failure out of a stream doing its job.
    expect(judgeBackgroundPlayback({ ...alive, advancedMs: 24_000 })).toBe('survived');
  });

  it('refuses to judge a trip too short to mean anything', () => {
    // Flicking to another app and straight back can show no measurable movement
    // even when nothing is wrong — so it is recorded as neither outcome, rather
    // than being counted as a death and poisoning the ratio.
    expect(judgeBackgroundPlayback({ paused: false, hiddenMs: 4_000, advancedMs: 0 })).toBe('unknown');
    expect(judgeBackgroundPlayback({ paused: true, hiddenMs: 900, advancedMs: 0 })).toBe('unknown');
  });

  it('does judge once the trip is long enough', () => {
    expect(judgeBackgroundPlayback({ paused: false, hiddenMs: 10_001, advancedMs: 10_000 })).toBe(
      'survived'
    );
    expect(judgeBackgroundPlayback({ paused: false, hiddenMs: 10_001, advancedMs: 0 })).toBe('died');
  });
});
