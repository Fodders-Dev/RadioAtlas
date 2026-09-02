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
