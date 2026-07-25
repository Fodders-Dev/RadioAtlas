// Horizontal swipe on the player dock: left → next station, right → previous.
// Pure + DI'd so the thresholds and (much more importantly) the ABORT rules are
// unit-testable without a DOM — same convention as heroPullExpand.ts.
//
// #86 — «the radio NEVER auto-switches stations» — is NOT weakened by this. The
// rule forbids the APP changing station on its own (auto-skip on error, autoplay
// of a random pick). A committed swipe is an explicit human request, exactly
// like tapping «следующая», and it walks the QUEUE through the same playNext /
// playPrevious the buttons call. There is no random fallback anywhere below.
//
// TOUCH REALITY (learned the hard way in heroPullExpand.ts, do not re-litigate):
// Chromium's compositor claims a touch drag at ~16px of slop and fires
// `pointercancel` unconditionally, so a passive pointer observer is DEAD on
// touch. The only thing that keeps the stream alive is a NON-PASSIVE `touchmove`
// that calls preventDefault — and we call it ONLY once the horizontal direction
// lock has held, so an ordinary vertical page scroll is never hijacked.
//
// TELEGRAM EDGE GESTURE: a Mini App runs inside a WebView whose own back/forward
// gesture lives at the screen edges, and there is no SDK toggle for the
// horizontal one (disableVerticalSwipes covers only the vertical dismiss). We
// therefore refuse to start a swipe that BEGINS inside EDGE_GUARD_PX of either
// edge, so the platform keeps its gesture and ours never fights it.

/** Below this the gesture is not claimed at all — a tap or jitter passes through. */
export const SWIPE_ENGAGE_PX = 12;
/** Full-commit travel. */
export const SWIPE_COMMIT_PX = 72;
/** |dx| must exceed |dy| * this to read as horizontal intent. */
export const SWIPE_DIRECTION_LOCK = 1.4;
/** A fast flick commits early, at shorter travel than SWIPE_COMMIT_PX. */
export const SWIPE_FLICK_VELOCITY = 0.5; // px/ms across the trailing samples
export const SWIPE_FLICK_MIN_PX = 36;
/** A flick only counts if the finger was still MOVING when it lifted. */
export const SWIPE_FLICK_TAIL_MS = 300;
/** Net VERTICAL travel that proves this is a page scroll, not a swipe. Terminal. */
export const SWIPE_ABORT_VERTICAL_PX = 18;
/** Keep clear of the platform's own edge gestures (Telegram/iOS back-swipe). */
export const EDGE_GUARD_PX = 24;

export type SwipeDirection = 'next' | 'previous';
export type SwipePhase = 'idle' | 'tracking' | 'engaged' | 'aborted';

type Sample = { t: number; x: number };

export type DockSwipeTracker = {
  readonly phase: SwipePhase;
  /** Signed horizontal travel while engaged (negative = leftwards = «next»). */
  readonly dx: number;
  start: (x: number, y: number, t: number, viewportWidth: number) => void;
  move: (x: number, y: number, t: number) => void;
  /** Returns the direction to commit, or null. ALWAYS resets to idle. */
  release: (t: number) => SwipeDirection | null;
  cancel: () => void;
};

export const createDockSwipeTracker = (): DockSwipeTracker => {
  let phase: SwipePhase = 'idle';
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let samples: Sample[] = [];

  const reset = () => {
    phase = 'idle';
    startX = 0;
    startY = 0;
    dx = 0;
    samples = [];
  };

  return {
    get phase() {
      return phase;
    },
    get dx() {
      return phase === 'engaged' ? dx : 0;
    },
    start: (x, y, t, viewportWidth) => {
      reset();
      // Never begin inside the platform's edge-gesture strip.
      if (x <= EDGE_GUARD_PX || x >= viewportWidth - EDGE_GUARD_PX) {
        phase = 'aborted';
        return;
      }
      phase = 'tracking';
      startX = x;
      startY = y;
      samples = [{ t, x }];
    },
    move: (x, y, t) => {
      if (phase !== 'tracking' && phase !== 'engaged') return;
      const totalX = x - startX;
      const totalY = y - startY;
      // A clear vertical intent is terminal: the user is scrolling the page and
      // must keep doing so, no matter how the drag drifts afterwards.
      if (Math.abs(totalY) > SWIPE_ABORT_VERTICAL_PX && Math.abs(totalY) > Math.abs(totalX)) {
        phase = 'aborted';
        return;
      }
      if (phase === 'tracking') {
        if (Math.abs(totalX) < SWIPE_ENGAGE_PX) return;
        // Engage only on a genuinely horizontal drag.
        if (Math.abs(totalX) <= Math.abs(totalY) * SWIPE_DIRECTION_LOCK) return;
        phase = 'engaged';
      }
      dx = totalX;
      samples.push({ t, x });
      if (samples.length > 6) samples.shift();
    },
    release: (t) => {
      const committedPhase = phase;
      const travel = dx;
      const tail = samples[samples.length - 1];
      const head = samples[0];
      reset();
      if (committedPhase !== 'engaged' || !tail || !head) return null;

      const distance = Math.abs(travel);
      let commit = distance >= SWIPE_COMMIT_PX;
      if (!commit && distance >= SWIPE_FLICK_MIN_PX && t - tail.t <= SWIPE_FLICK_TAIL_MS) {
        const elapsed = tail.t - head.t;
        const velocity = elapsed > 0 ? Math.abs(tail.x - head.x) / elapsed : 0;
        commit = velocity >= SWIPE_FLICK_VELOCITY;
      }
      if (!commit) return null;
      // Content moves WITH the finger: dragging left reveals what comes next.
      return travel < 0 ? 'next' : 'previous';
    },
    cancel: reset
  };
};
