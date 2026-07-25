import { useEffect, useRef } from 'react';
import { createDockSwipeTracker, type SwipeDirection } from './dockSwipe';

/**
 * Wires the horizontal dock swipe to the DOM. The state machine lives in
 * dockSwipe.ts; this file only owns listener plumbing, exactly like
 * useHeroPullToExpand does for the vertical pull.
 *
 * TOUCH goes through a NON-PASSIVE `touchmove` (preventDefault once engaged) —
 * a passive pointer observer is dead on touch here, see dockSwipe.ts. MOUSE goes
 * through pointer events, which the compositor never cancels.
 *
 * The element gets `data-swipe-dx` while engaged so CSS can follow the finger;
 * nothing else in the app reads it.
 */
export const useDockSwipe = (
  ref: React.RefObject<HTMLElement | null>,
  onCommit: (direction: SwipeDirection) => void,
  enabled = true
) => {
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled) return undefined;
    const tracker = createDockSwipeTracker();

    // Only the SMALL round controls (play / like / «Ещё» / volume) and real
    // inputs block the swipe — a drag that starts on them is theirs.
    //
    // Deliberately NOT `button` in general: the station name and the track line
    // are themselves buttons and together they span most of the bar, i.e.
    // exactly where a thumb naturally swipes. Blocking them made the gesture
    // unreachable in practice (measured: touchstart+6 moves arrived and the
    // tracker never engaged). Their TAP still works — the tracker only engages
    // past a 12px dead zone, so a tap never becomes a swipe.
    const startsOnControl = (target: EventTarget | null) =>
      target instanceof Element &&
      Boolean(target.closest('.dock-icon-btn, input, a, [role="slider"]'));

    const paint = () => {
      if (tracker.phase === 'engaged') {
        node.dataset.swipeDx = String(Math.round(tracker.dx));
        node.style.setProperty('--swipe-dx', `${Math.round(tracker.dx)}px`);
      } else {
        delete node.dataset.swipeDx;
        node.style.removeProperty('--swipe-dx');
      }
    };

    const finish = (direction: SwipeDirection | null) => {
      paint();
      if (direction) commitRef.current(direction);
    };

    // ---- TOUCH (non-passive; preventDefault only once engaged) --------------
    let touchId: number | null = null;

    const onTouchStart = (event: TouchEvent) => {
      if (touchId !== null || event.touches.length !== 1) {
        if (touchId !== null) {
          tracker.cancel();
          touchId = null;
          paint();
        }
        return;
      }
      const touch = event.touches[0];
      if (!touch || startsOnControl(event.target)) return;
      tracker.start(touch.clientX, touch.clientY, event.timeStamp, window.innerWidth);
      if (tracker.phase === 'tracking') touchId = touch.identifier;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (touchId === null) return;
      const touch = Array.from(event.touches).find((item) => item.identifier === touchId);
      if (!touch) return;
      tracker.move(touch.clientX, touch.clientY, event.timeStamp);
      if (tracker.phase === 'aborted') {
        touchId = null;
        paint();
        return;
      }
      paint();
      // Only here: the direction lock has held and the drag is genuinely
      // horizontal, so the page scroll was never a candidate. Every other case
      // falls through untouched and scrolls normally.
      if (tracker.phase === 'engaged' && event.cancelable) event.preventDefault();
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (touchId === null) return;
      const stillDown = Array.from(event.touches).some((item) => item.identifier === touchId);
      if (stillDown) return;
      touchId = null;
      finish(tracker.release(event.timeStamp));
    };

    const onTouchCancel = () => {
      touchId = null;
      tracker.cancel();
      paint();
    };

    // ---- MOUSE --------------------------------------------------------------
    let pointerId: number | null = null;

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.button !== 0) return;
      if (startsOnControl(event.target)) return;
      tracker.start(event.clientX, event.clientY, event.timeStamp, window.innerWidth);
      if (tracker.phase === 'tracking') pointerId = event.pointerId;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (pointerId === null || event.pointerId !== pointerId) return;
      tracker.move(event.clientX, event.clientY, event.timeStamp);
      if (tracker.phase === 'aborted') {
        pointerId = null;
        paint();
        return;
      }
      paint();
    };

    const onPointerUp = (event: PointerEvent) => {
      if (pointerId === null || event.pointerId !== pointerId) return;
      pointerId = null;
      finish(tracker.release(event.timeStamp));
    };

    const onPointerCancel = () => {
      pointerId = null;
      tracker.cancel();
      paint();
    };

    node.addEventListener('touchstart', onTouchStart, { passive: true });
    node.addEventListener('touchmove', onTouchMove, { passive: false });
    node.addEventListener('touchend', onTouchEnd);
    node.addEventListener('touchcancel', onTouchCancel);
    node.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);

    return () => {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('touchcancel', onTouchCancel);
      node.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      tracker.cancel();
      delete node.dataset.swipeDx;
      node.style.removeProperty('--swipe-dx');
    };
  }, [enabled, ref]);
};
