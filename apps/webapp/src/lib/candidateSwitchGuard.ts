/**
 * Should the buffering watchdog be allowed to move to the next candidate?
 *
 * The bug this exists to stop, measured on production over 24 hours: 11 of 33
 * plays ended in `no-playable-candidate` on stations that were alive and served
 * audio in under 300ms when probed. The failure details were
 * `The operation was aborted.` — a DOMException from `audio.play()`, raised by
 * OUR OWN code.
 *
 * The sequence: a slow station emits `waiting`, the watchdog waits its grace and
 * calls the next candidate, that calls `audio.load()`, and the `play()` promise
 * of the CURRENT candidate — still pending, because the station is merely slow —
 * rejects with AbortError. The catch sees a live session, records a candidate
 * failure and advances too. Two walkers then chew through one candidate list on
 * one <audio> element, aborting each other, until the list runs out and the
 * listener is told the station has no playable stream.
 *
 * So: while a play() is in flight the watchdog waits. Not forever — a play()
 * that never settles is exactly the hang the watchdog exists for — but a
 * bounded number of times, after which it proceeds as before.
 */

export const MAX_PLAY_PENDING_DEFERRALS = 2;
/** Short, because this is a re-check of an in-flight promise, not a new grace. */
export const PLAY_PENDING_RECHECK_MS = 2500;

export type CandidateSwitchDecision =
  | { action: 'switch' }
  | { action: 'defer'; recheckMs: number; deferrals: number };

/**
 * How long a FIRST candidate that has produced nothing at all is given before
 * the watchdog looks at it, as opposed to the full 15 s startup grace.
 *
 * The grace exists to protect slow-but-live streams, and the honest way to
 * shorten it was to measure what a healthy start actually costs. Chromium, the
 * direct route, 54 promoted https stations one at a time, 2026-09-01 — of the 24
 * that produced audio, time to the first `currentTime` movement was p50 1602 ms,
 * p90 3100 ms, p95 3702 ms, **max 5915 ms**. A 6000 ms cutoff would have
 * diverted none of them; 8000 leaves a third again of headroom on top.
 *
 * ⚠ That was a home connection, so it is what a healthy start costs on a GOOD
 * route. The reason 8000 is nevertheless safe on a bad one is the predicate
 * below, not the number: this deadline only ever applies to an element that has
 * received NOTHING. A slow stream on a poor route has parsed metadata long
 * before this and is exempt by construction.
 */
export const SILENT_STARTUP_PROBE_MS = 8000;

/**
 * Has anything at all arrived for this candidate?
 *
 * This is the difference between a stalled upstream and a slow one, and it is
 * measurable rather than a guess. In the same run, of the 30 stations that
 * produced no audio within 20 s, **29 still had `readyState === 0`** — nothing
 * parsed, nothing buffered, position never moved. Gamesboro, the station this
 * whole line of work started from, sat exactly there for 25-30 s while trickling
 * ~1.3 KB/s: bytes on the wire, nothing a listener could hear.
 *
 * Takes primitives rather than the element so the decision can be tested without
 * a DOM, and so it cannot accidentally read something else off the audio.
 */
export const hasStreamStartedArriving = ({
  readyState,
  bufferedLength,
  currentTime
}: {
  readyState: number;
  bufferedLength: number;
  currentTime: number;
}): boolean => readyState > 0 || bufferedLength > 0 || currentTime > 0;

export const decideCandidateSwitch = ({
  playPending,
  deferrals
}: {
  playPending: boolean;
  deferrals: number;
}): CandidateSwitchDecision => {
  if (!playPending) return { action: 'switch' };
  if (deferrals >= MAX_PLAY_PENDING_DEFERRALS) return { action: 'switch' };
  return {
    action: 'defer',
    recheckMs: PLAY_PENDING_RECHECK_MS,
    deferrals: deferrals + 1
  };
};
