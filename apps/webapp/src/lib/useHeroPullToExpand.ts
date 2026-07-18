import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPullTracker, type PullPhase } from './heroPullExpand';
import { getDeviceProfile } from './deviceProfile';
import { supportsSwipeControl, triggerSelectionHaptic } from './telegram';

// DOM binding for the Home hero's pull-down-to-expand gesture.
//
// READ heroPullExpand.ts's header first. The one-line version: a passive
// pointer-event observer CANNOT implement this on touch, because Chromium fires
// `pointercancel` ~16px into any vertical touch drag whether or not the page can
// scroll that way. So:
//
//   TOUCH  -> non-passive `touchmove`, preventDefault ONLY once engaged.
//   MOUSE  -> pointer events (the compositor never steals a mouse drag).
//
// Both drive the same pure tracker, so the thresholds and abort rules are
// identical and unit-tested once.
//
// Listeners are bound to the SCREEN ROOT and hit-tested against PULL_ZONE rather
// than attached per-element. That is deliberate: the grabber handle
// (.home-feed-hero) is a sibling of the hero card, not a descendant, and binding
// per-element previously left the one element that visually reads as the handle
// completely inert. One root listener covers both, and any future affordance.
const PULL_ZONE = '.home-hero-card, .home-feed-hero';

const atPageTop = () => {
  if (typeof window === 'undefined') return false;
  // `<= 0`, not `=== 0`: rubber-band overscroll reports negative / sub-pixel
  // values. The page scroller is the DOCUMENT here — .app-main's overflow rule
  // is dead CSS (that element is never rendered), which is why every e2e uses
  // window.scrollTo / window.scrollY.
  return window.scrollY <= 0;
};

// A gesture that starts on a control belongs to that control — otherwise the
// pull swallows the hero's play / favourite / refresh buttons.
//
// `.home-feed-entry` is EXEMPT: it is a button, but it is also the visible drag
// handle («Потяни вниз»), so it must be pullable. A tap on it still activates
// it normally — we only claim the gesture past the dead zone, and a tap never
// gets there.
const startsOnControl = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return false;
  const control = target.closest(
    'button, a, input, select, textarea, [role="button"], [contenteditable]'
  );
  if (!control) return false;
  return !control.closest('.home-feed-entry');
};

const inPullZone = (target: EventTarget | null) =>
  target instanceof Element && Boolean(target.closest(PULL_ZONE));

export type HeroPullToExpand = {
  /**
   * Goes on the Home screen root. Owns `--hero-pull` / `data-hero-pull` and
   * hosts every gesture listener (see PULL_ZONE above).
   */
  surfaceRef: (node: HTMLElement | null) => void;
  pullPhase: PullPhase;
};

export const useHeroPullToExpand = (onCommit: () => void): HeroPullToExpand => {
  const tracker = useMemo(() => createPullTracker(), []);
  const surfaceNode = useRef<HTMLElement | null>(null);
  const frame = useRef<number | null>(null);
  const pendingProgress = useRef(0);
  // Discrete phase only — it changes at most a couple of times per gesture. The
  // CONTINUOUS progress is NOT React state: a setState per move would re-render
  // the whole Home surface (hero + every rail) each frame inside a WebView that
  // is already running a live audio visualiser.
  const [pullPhase, setPullPhase] = useState<PullPhase>('idle');
  // Bumped by the surface callback-ref so the non-passive listener effect
  // re-binds once the screen element exists (a plain ref cannot be an effect dep).
  const [surfaceEpoch, setSurfaceEpoch] = useState(0);

  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  // prefers-reduced-motion / low-power: skip the follow transform entirely. The
  // gesture still COMMITS — reduced motion asks for less motion, not less
  // function — and `data-hero-pull` still drives the non-motion "ready" hint so
  // the gesture is never feedback-less.
  const follow = useMemo(() => !getDeviceProfile().reducedMotion, []);
  // Only the TOUCH path is gated on Telegram: on a pre-7.7 client the vertical
  // swipe-to-minimise wins and the drag would feel broken. The mouse drag and
  // the button stay available there.
  const touchEnabled = useMemo(() => supportsSwipeControl(), []);

  const writeProgress = useCallback(
    (value: number) => {
      if (!follow) return;
      pendingProgress.current = value;
      if (frame.current !== null) return;
      frame.current = window.requestAnimationFrame(() => {
        frame.current = null;
        surfaceNode.current?.style.setProperty('--hero-pull', String(pendingProgress.current));
      });
    },
    [follow]
  );

  const clearProgress = useCallback(() => {
    pendingProgress.current = 0;
    if (frame.current !== null) {
      window.cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    // Written unconditionally (even when `follow` is false) so a value can never
    // be left stranded: homeReference.css kills transitions under
    // prefers-reduced-motion, so a stale --hero-pull would stick as a hard jump.
    surfaceNode.current?.style.setProperty('--hero-pull', '0');
  }, []);

  const commit = useCallback(() => {
    clearProgress();
    setPullPhase('idle');
    triggerSelectionHaptic();
    // Same function the «Лента» button calls, invoked from the SAME event turn
    // (never an effect) — so the gesture and the button are #86-identical by
    // construction and rerollFeedSeed cannot double-fire under StrictMode.
    onCommitRef.current();
  }, [clearProgress]);

  useEffect(() => () => clearProgress(), [clearProgress]);

  useEffect(() => {
    const node = surfaceNode.current;
    if (!node) return undefined;

    // Shared teardown. Every exit path routes through here, so `data-hero-pull`
    // can never strand at 'ready' (which would also freeze transitions on every
    // Home child via the [data-hero-pull='ready'] > * rule).
    const standDown = () => {
      clearProgress();
      setPullPhase('idle');
    };

    const applyMove = (result: ReturnType<typeof tracker.move>) => {
      if (result.phase === 'aborted') {
        standDown();
        return false;
      }
      if (result.phase !== 'tracking' && result.phase !== 'ready') return false;
      if (result.enteredReady) triggerSelectionHaptic();
      setPullPhase(result.phase);
      writeProgress(result.visual);
      return true;
    };

    // ---- TOUCH ------------------------------------------------------------
    // The `touchmove` listener MUST be non-passive: preventDefault is the only
    // thing that stops the compositor claiming the drag and killing the gesture.
    let touchId: number | null = null;

    const onTouchStart = (event: TouchEvent) => {
      if (!touchEnabled) return;
      if (touchId !== null || event.touches.length !== 1) {
        // A second finger arrived (pinch/zoom) — this is not our gesture.
        if (touchId !== null) {
          tracker.cancel();
          touchId = null;
          standDown();
        }
        return;
      }
      const touch = event.touches[0];
      if (!inPullZone(event.target) || startsOnControl(event.target)) return;
      if (tracker.start(touch.clientY, touch.clientX, atPageTop(), event.timeStamp)) {
        touchId = touch.identifier;
      }
    };

    const onTouchMove = (event: TouchEvent) => {
      if (touchId === null) return;
      const touch = Array.from(event.touches).find((item) => item.identifier === touchId);
      if (!touch) return;
      const result = tracker.move(touch.clientY, touch.clientX, atPageTop(), event.timeStamp);
      const engaged = applyMove(result);
      if (result.phase === 'aborted') {
        touchId = null;
        return;
      }
      // ONLY here, and only once engaged past the dead zone: the page is at the
      // top, the direction lock has held, and the user is pulling down. Every
      // other case falls through untouched and scrolls normally (constraint E).
      if (engaged && event.cancelable) event.preventDefault();
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (touchId === null) return;
      const stillDown = Array.from(event.touches).some((item) => item.identifier === touchId);
      if (stillDown) return;
      touchId = null;
      const { commit: shouldCommit } = tracker.release(event.timeStamp);
      standDown();
      if (shouldCommit) commit();
    };

    const onTouchCancel = () => {
      if (touchId === null) return;
      touchId = null;
      tracker.cancel();
      standDown();
    };

    // ---- MOUSE ------------------------------------------------------------
    // Pointer events, and once a drag starts the moves/ups are watched on the
    // WINDOW rather than the hero. A drag that begins low in the hero (where a
    // thumb or cursor naturally rests) leaves the element within a few frames;
    // element-scoped listeners silently dropped those gestures, and a release
    // outside the element stranded `data-hero-pull` at 'ready' indefinitely.
    let mouseId: number | null = null;

    const endMouse = (commitCheck: ((now: number) => boolean) | null, now: number) => {
      mouseId = null;
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerCancel);
      const shouldCommit = commitCheck ? commitCheck(now) : false;
      standDown();
      if (shouldCommit) commit();
    };

    function onWindowPointerMove(event: PointerEvent) {
      if (mouseId === null || event.pointerId !== mouseId) return;
      const result = tracker.move(event.clientY, event.clientX, atPageTop(), event.timeStamp);
      applyMove(result);
      if (result.phase === 'aborted') endMouse(null, event.timeStamp);
    }

    function onWindowPointerUp(event: PointerEvent) {
      if (mouseId === null || event.pointerId !== mouseId) return;
      endMouse((now) => tracker.release(now).commit, event.timeStamp);
    }

    function onWindowPointerCancel(event: PointerEvent) {
      if (mouseId === null || event.pointerId !== mouseId) return;
      tracker.cancel();
      endMouse(null, event.timeStamp);
    }

    const onPointerDown = (event: PointerEvent) => {
      // Touch is handled above; pen behaves like touch on most digitisers, so
      // only mouse takes this path.
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      if (!inPullZone(event.target) || startsOnControl(event.target)) return;
      if (!tracker.start(event.clientY, event.clientX, atPageTop(), event.timeStamp)) return;
      mouseId = event.pointerId;
      window.addEventListener('pointermove', onWindowPointerMove);
      window.addEventListener('pointerup', onWindowPointerUp);
      window.addEventListener('pointercancel', onWindowPointerCancel);
    };

    node.addEventListener('touchstart', onTouchStart, { passive: true });
    node.addEventListener('touchmove', onTouchMove, { passive: false });
    node.addEventListener('touchend', onTouchEnd, { passive: true });
    node.addEventListener('touchcancel', onTouchCancel, { passive: true });
    node.addEventListener('pointerdown', onPointerDown);

    return () => {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('touchcancel', onTouchCancel);
      node.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerCancel);
      tracker.cancel();
    };
  }, [clearProgress, commit, surfaceEpoch, touchEnabled, tracker, writeProgress]);

  const surfaceRef = useCallback((node: HTMLElement | null) => {
    if (surfaceNode.current === node) return;
    surfaceNode.current = node;
    setSurfaceEpoch((value) => value + 1);
  }, []);

  return { surfaceRef, pullPhase };
};
