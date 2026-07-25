import { describe, expect, it } from 'vitest';
import {
  createDockSwipeTracker,
  EDGE_GUARD_PX,
  SWIPE_COMMIT_PX,
  SWIPE_ENGAGE_PX
} from './dockSwipe';

const W = 390; // viewport width used by every case below

describe('createDockSwipeTracker', () => {
  it('commits «next» on a deliberate leftward drag', () => {
    const tracker = createDockSwipeTracker();
    tracker.start(200, 700, 0, W);
    tracker.move(160, 702, 60);
    tracker.move(120, 704, 120);
    expect(tracker.phase).toBe('engaged');
    expect(tracker.release(140)).toBe('next');
  });

  it('commits «previous» on a deliberate rightward drag', () => {
    const tracker = createDockSwipeTracker();
    tracker.start(150, 700, 0, W);
    tracker.move(200, 700, 60);
    tracker.move(240, 702, 120);
    expect(tracker.release(140)).toBe('previous');
  });

  it('a TAP commits nothing', () => {
    const tracker = createDockSwipeTracker();
    tracker.start(200, 700, 0, W);
    tracker.move(202, 701, 40);
    expect(tracker.phase).toBe('tracking'); // never engaged
    expect(tracker.release(60)).toBeNull();
  });

  it('a short drag below the commit distance does nothing', () => {
    const tracker = createDockSwipeTracker();
    tracker.start(200, 700, 0, W);
    // Engaged (past the dead zone) but well under SWIPE_COMMIT_PX, and slow
    // enough that the flick path cannot rescue it.
    tracker.move(200 - (SWIPE_ENGAGE_PX + 6), 700, 400);
    tracker.move(200 - (SWIPE_COMMIT_PX - 20), 700, 1400);
    expect(tracker.release(1500)).toBeNull();
  });

  it('a fast FLICK commits below the full distance', () => {
    const tracker = createDockSwipeTracker();
    tracker.start(200, 700, 0, W);
    tracker.move(180, 700, 20);
    tracker.move(155, 700, 40); // 45px in 40ms ≈ 1.1px/ms
    expect(tracker.release(50)).toBe('next');
  });

  it('a VERTICAL scroll aborts terminally — even if the drag later turns sideways', () => {
    // The owner scrolls the page with a finger that happens to start on the dock:
    // that must never change his station, and drifting horizontally afterwards
    // must not resurrect the gesture.
    const tracker = createDockSwipeTracker();
    tracker.start(200, 700, 0, W);
    tracker.move(202, 660, 60); // clearly vertical
    expect(tracker.phase).toBe('aborted');
    tracker.move(90, 655, 120); // now a big horizontal drift
    expect(tracker.release(160)).toBeNull();
  });

  it('a diagonal drag that is mostly vertical never engages', () => {
    const tracker = createDockSwipeTracker();
    tracker.start(200, 700, 0, W);
    tracker.move(180, 660, 60); // dx 20, dy 40
    expect(tracker.release(100)).toBeNull();
  });

  it('refuses to start inside the platform edge-gesture strip', () => {
    // Telegram's WebView owns the horizontal edge swipe and there is no SDK
    // toggle for it, so a gesture that STARTS there is not ours to take.
    const left = createDockSwipeTracker();
    left.start(EDGE_GUARD_PX - 4, 700, 0, W);
    left.move(120, 700, 80);
    expect(left.release(120)).toBeNull();

    const right = createDockSwipeTracker();
    right.start(W - EDGE_GUARD_PX + 4, 700, 0, W);
    right.move(W - 160, 700, 80);
    expect(right.release(120)).toBeNull();
  });

  it('cancel() drops the gesture and release() then commits nothing', () => {
    const tracker = createDockSwipeTracker();
    tracker.start(200, 700, 0, W);
    tracker.move(120, 700, 80);
    tracker.cancel();
    expect(tracker.phase).toBe('idle');
    expect(tracker.release(120)).toBeNull();
  });

  it('release() always resets, so a second gesture starts clean', () => {
    const tracker = createDockSwipeTracker();
    tracker.start(200, 700, 0, W);
    tracker.move(120, 700, 80);
    expect(tracker.release(120)).toBe('next');
    expect(tracker.phase).toBe('idle');
    expect(tracker.dx).toBe(0);
    expect(tracker.release(200)).toBeNull();
  });
});
