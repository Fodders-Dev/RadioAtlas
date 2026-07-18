// Pull-down-to-expand state machine for the Home hero: the gesture that grows
// «Рекомендуем / Сейчас играет» into the fullscreen «Лента». Pure + DI'd so the
// thresholds and (much more importantly) the ABORT rules are unit-testable
// without a DOM — same convention as createAutoplaySettler in feedAutoplay.ts.
//
// THE SAFETY PRINCIPLE (read this before touching anything below):
//
// An EARLIER version of this file claimed that at `window.scrollY <= 0` a
// downward drag produces no scroll, so the gesture could be observed with fully
// passive listeners and `pointercancel` would only ever mean "the user really
// meant to scroll". THAT IS FALSE, and it made the gesture completely dead on
// touch. Chromium's compositor claims a vertical touch drag at touch slop
// (~16px) whether or not the scroller can actually move in that direction, and
// fires `pointercancel` unconditionally. Measured with CDP Input.dispatchTouchEvent
// at 393x800/hasTouch, page at scrollY 0, dragging DOWN on an element with
// `touch-action: auto`:
//     pointerdown -> pointermove -> pointermove -> POINTERCANCEL (2 moves, 24px)
// `overscroll-behavior-y: contain` does NOT prevent it, and neither does
// `touch-action: pan-up` (both measured — still cancelled after 2 moves). Only
// `touch-action: none` (which would make Home's largest element a scroll dead
// zone — unacceptable, constraint E) or a non-passive `touchmove` that calls
// preventDefault keeps the stream alive.
//
// So the real contract is the standard pull-to-refresh shape, implemented in
// useHeroPullToExpand.ts:
//   * TOUCH goes through non-passive `touchmove`. We call preventDefault ONLY
//     once the tracker is engaged (past the dead zone) AND the page is at top
//     AND the direction lock has held. Before that we touch nothing, so an
//     ordinary scroll is never hijacked — measured: an upward drag at page top
//     scrolls normally (prevented=0, scrollY 0 -> 153) and a downward drag while
//     scrolled scrolls normally (600 -> 447).
//   * `touch-action` on the hero stays `auto`. The preventDefault is what claims
//     the gesture, so we never have to widen or narrow the CSS contract.
//   * MOUSE goes through pointer events (never cancelled by the compositor).
//
// Constraint E is therefore satisfied by the ENGAGEMENT RULE, not by the absence
// of preventDefault. Do not "simplify" this back to passive listeners.
//
// Second structural guarantee, unchanged: COMMIT ONLY EVER HAPPENS ON
// `release()`. There is no mid-gesture commit anywhere, so a gesture the user
// backs out of can always be aborted by dragging back up or lifting early.

// Dead zone. Below this the gesture is not claimed at all — a tap, a jitter, or
// the first pixels of a page scroll must pass through untouched.
export const PULL_ENGAGE_PX = 10;
// Full-commit travel for the pointer (touch drag / mouse drag).
export const PULL_COMMIT_PX = 104;
// Net UPWARD travel that proves this is a page scroll, not a pull. Terminal.
export const PULL_ABORT_UP_PX = 6;
// |dx| > |dy| * this ⇒ horizontal intent (a rail swipe) ⇒ terminal abort.
export const PULL_DIRECTION_LOCK = 1.2;
// A fast flick commits early, at much shorter travel than PULL_COMMIT_PX.
export const PULL_FLICK_VELOCITY = 0.55; // px/ms across the trailing samples
export const PULL_FLICK_MIN_PX = 44;
// A flick only counts if the finger was still MOVING when it lifted. Longer than
// this since the last sample ⇒ the finger rested, so the full travel is required.
export const PULL_FLICK_TAIL_MS = 320;

// How many trailing (t, y) samples feed the flick-velocity estimate. Velocity is
// measured over the TAIL, not `now - startedAt`: a user who rests a finger on the
// card and then flicks is a real, common motion that an elapsed-time heuristic
// gets wrong.
const VELOCITY_SAMPLES = 5;
// Rubber-band curvature for the VISUAL progress (see below).
const VISUAL_RESISTANCE = 1.6;

export type PullPhase = 'idle' | 'armed' | 'tracking' | 'ready' | 'aborted';

export type PullMove = {
  phase: PullPhase;
  // Linear 0..1 travel / PULL_COMMIT_PX. Drives the DECISION.
  progress: number;
  // Asymptotic rubber-band curve of the same travel. Drives the TRANSFORM, so
  // resistance builds and crossing the threshold reads as a detent.
  visual: number;
  // True exactly once per crossing into 'ready' — the single-fire haptic latch.
  enteredReady: boolean;
};

export type PullRelease = {
  commit: boolean;
  progress: number;
};

export type PullTracker = {
  /** Returns false when the gesture is refused outright (page is not at top). */
  start: (y: number, x: number, atPageTop: boolean, now: number) => boolean;
  move: (y: number, x: number, atPageTop: boolean, now: number) => PullMove;
  /** Terminal. `commit === true` ⇒ the caller should open the feed. */
  release: (now: number) => PullRelease;
  cancel: () => void;
  phase: () => PullPhase;
};

const rubberBand = (raw: number) => Math.min(1, 1 - Math.exp(-raw * VISUAL_RESISTANCE));

export const createPullTracker = (): PullTracker => {
  let phase: PullPhase = 'idle';
  let startY = 0;
  let startX = 0;
  let progress = 0;
  let peak = 0;
  let readyLatched = false;
  let samples: Array<{ t: number; y: number }> = [];

  const reset = (next: PullPhase) => {
    phase = next;
    progress = 0;
    peak = 0;
    readyLatched = false;
    samples = [];
  };

  const abortResult = (): PullMove => {
    // 'aborted' is TERMINAL: it cannot re-engage until the next start(). Without
    // this, a scroll that briefly dips back under the abort threshold would
    // re-arm the pull mid-scroll and open the feed under the user's finger.
    reset('aborted');
    return { phase: 'aborted', progress: 0, visual: 0, enteredReady: false };
  };

  const velocity = () => {
    if (samples.length < 2) return 0;
    const first = samples[0];
    const last = samples[samples.length - 1];
    const dt = last.t - first.t;
    if (dt <= 0) return 0;
    return (last.y - first.y) / dt;
  };

  return {
    start: (y, x, atPageTop, now) => {
      if (!atPageTop) {
        reset('idle');
        return false;
      }
      reset('armed');
      startY = y;
      startX = x;
      samples = [{ t: now, y }];
      return true;
    },

    move: (y, x, atPageTop, now) => {
      if (phase === 'aborted' || phase === 'idle') {
        return { phase, progress: 0, visual: 0, enteredReady: false };
      }

      const dy = y - startY;
      const dx = x - startX;

      // Three terminal aborts, all meaning "the user is doing something else":
      //   1. net upward travel        → this is a page scroll
      //   2. the page left the top    → momentum / anchor jump / a nested
      //                                 scroller stole the gesture. Re-checked
      //                                 on EVERY move, independently of
      //                                 pointercancel (belt and braces).
      //   3. horizontal dominance     → a rail swipe, not a pull
      if (dy < -PULL_ABORT_UP_PX) return abortResult();
      if (!atPageTop) return abortResult();
      if (Math.abs(dx) > Math.abs(dy) * PULL_DIRECTION_LOCK) return abortResult();

      samples.push({ t: now, y });
      if (samples.length > VELOCITY_SAMPLES) samples.shift();

      if (dy < PULL_ENGAGE_PX) {
        return { phase: 'armed', progress: 0, visual: 0, enteredReady: false };
      }

      peak = Math.max(peak, dy);
      progress = dy / PULL_COMMIT_PX;
      const visual = rubberBand(progress);

      if (progress >= 1) {
        const enteredReady = !readyLatched;
        readyLatched = true;
        phase = 'ready';
        return { phase, progress: Math.min(1, progress), visual, enteredReady };
      }

      // Dropped back under the line — release the haptic latch so pulling past
      // it again re-fires the detent.
      readyLatched = false;
      phase = 'tracking';
      return { phase, progress, visual, enteredReady: false };
    },

    release: (now) => {
      const engaged = phase === 'tracking' || phase === 'ready';
      const settled = Math.min(1, progress);
      if (!engaged) {
        reset('idle');
        return { commit: false, progress: 0 };
      }
      // `now` participates only through the trailing samples; a stale finger
      // (long pause before lifting) has near-zero tail velocity and therefore
      // must reach the full travel to commit.
      const tail = samples.length ? now - samples[samples.length - 1].t : Number.POSITIVE_INFINITY;
      const flick = tail <= PULL_FLICK_TAIL_MS && velocity() >= PULL_FLICK_VELOCITY;
      const commit = progress >= 1 || (flick && peak >= PULL_FLICK_MIN_PX);
      reset('idle');
      return { commit, progress: settled };
    },

    cancel: () => reset('idle'),
    phase: () => phase
  };
};

// ---------------------------------------------------------------------------
// The WHEEL / trackpad path was REMOVED on purpose. Do not reintroduce it
// without reading this.
//
// It accumulated upward wheel deltas at page top and opened the feed at 260px.
// That is ~3 standard wheel notches (deltaY 100 each), and the sequence-start
// gate granted eligibility to any sequence that merely BEGAN at scrollY 0 — so
// the single most ordinary desktop motion there is ("I am at the top of Home and
// I keep wheeling up") opened a fullscreen surface, and, when the player was
// idle, resolveFeedEntry's `autoplayInitial: true` branch STARTED AUDIO. Two
// independent reviewers reproduced it at 515px, the owner's own Telegram Desktop
// width; the arithmetic is unambiguous (3 x 100 >= 260, gap > 320ms => fresh,
// eligible sequence).
//
// The failure is not a tuning problem: a wheel has no "release", so there is no
// moment at which the user can be said to have COMMITTED rather than merely
// scrolled, and no threshold separates "deliberate" from "enthusiastic". Every
// other entry point does have one — the pointer/touch drag commits only on
// release, and the «Лента» button commits on click. Desktop is covered by BOTH
// of those (mouse drag on the hero or its grip, and the button), so removing the
// wheel path costs no reachability on any platform.
