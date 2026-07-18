import { describe, expect, it } from 'vitest';
import { createPullTracker, PULL_COMMIT_PX, PULL_ENGAGE_PX } from './heroPullExpand';

const AT_TOP = true;
const OFF_TOP = false;

describe('createPullTracker (hero pull-down-to-expand)', () => {
  it('refuses to start when the page is not scrolled to the top', () => {
    const tracker = createPullTracker();
    expect(tracker.start(300, 100, OFF_TOP, 0)).toBe(false);
    expect(tracker.phase()).toBe('idle');
    // …and a move afterwards is inert, so nothing can commit.
    expect(tracker.move(500, 100, OFF_TOP, 50).phase).toBe('idle');
    expect(tracker.release(60).commit).toBe(false);
  });

  it('stays in the dead zone below PULL_ENGAGE_PX so a tap never claims the gesture', () => {
    const tracker = createPullTracker();
    tracker.start(300, 100, AT_TOP, 0);
    const result = tracker.move(300 + PULL_ENGAGE_PX - 1, 100, AT_TOP, 16);
    expect(result.phase).toBe('armed');
    expect(result.progress).toBe(0);
    expect(tracker.release(30).commit).toBe(false);
  });

  it('tracks linear progress once engaged and reports a rubber-banded visual', () => {
    const tracker = createPullTracker();
    tracker.start(300, 100, AT_TOP, 0);
    const half = tracker.move(300 + PULL_COMMIT_PX / 2, 100, AT_TOP, 120);
    expect(half.phase).toBe('tracking');
    expect(half.progress).toBeCloseTo(0.5, 5);
    // Resistance builds: the visual always trails the linear decision value.
    expect(half.visual).toBeGreaterThan(0);
    expect(half.visual).toBeLessThan(half.progress + 0.35);
    expect(half.visual).toBeGreaterThan(half.progress - 0.2);
  });

  it('aborts on net UPWARD travel — that is a page scroll, not a pull', () => {
    const tracker = createPullTracker();
    tracker.start(300, 100, AT_TOP, 0);
    tracker.move(340, 100, AT_TOP, 40);
    const result = tracker.move(280, 100, AT_TOP, 80);
    expect(result.phase).toBe('aborted');
    expect(result.progress).toBe(0);
  });

  it('aborts when the page leaves the top mid-gesture', () => {
    const tracker = createPullTracker();
    tracker.start(300, 100, AT_TOP, 0);
    tracker.move(360, 100, AT_TOP, 40);
    expect(tracker.move(420, 100, OFF_TOP, 80).phase).toBe('aborted');
  });

  it('aborts on horizontal dominance so a rail swipe never engages', () => {
    const tracker = createPullTracker();
    tracker.start(300, 100, AT_TOP, 0);
    // 20px down, 120px sideways — clearly a horizontal rail swipe.
    expect(tracker.move(320, 220, AT_TOP, 40).phase).toBe('aborted');
  });

  it('treats abort as TERMINAL: a gesture cannot re-engage until the next start()', () => {
    const tracker = createPullTracker();
    tracker.start(300, 100, AT_TOP, 0);
    tracker.move(280, 100, AT_TOP, 40); // aborted (upward)
    // The finger now travels a full commit distance downward — irrelevant.
    const result = tracker.move(300 + PULL_COMMIT_PX * 2, 100, AT_TOP, 200);
    expect(result.phase).toBe('aborted');
    expect(tracker.release(220).commit).toBe(false);
  });

  it('only ever commits on release(), never mid-drag', () => {
    const tracker = createPullTracker();
    tracker.start(300, 100, AT_TOP, 0);
    const ready = tracker.move(300 + PULL_COMMIT_PX + 10, 100, AT_TOP, 200);
    // Past the threshold the tracker reports 'ready' — a latch for the detent
    // haptic — but the caller has been given no commit signal yet.
    expect(ready.phase).toBe('ready');
    expect(tracker.release(220).commit).toBe(true);
  });

  it('fires the ready latch exactly once per crossing', () => {
    const tracker = createPullTracker();
    tracker.start(300, 100, AT_TOP, 0);
    expect(tracker.move(300 + PULL_COMMIT_PX + 5, 100, AT_TOP, 200).enteredReady).toBe(true);
    expect(tracker.move(300 + PULL_COMMIT_PX + 20, 100, AT_TOP, 240).enteredReady).toBe(false);
    // Drop back under the line, then cross again — the detent re-arms.
    expect(tracker.move(300 + PULL_COMMIT_PX - 30, 100, AT_TOP, 280).phase).toBe('tracking');
    expect(tracker.move(300 + PULL_COMMIT_PX + 5, 100, AT_TOP, 320).enteredReady).toBe(true);
  });

  it('commits a fast flick well short of the full travel', () => {
    const tracker = createPullTracker();
    tracker.start(300, 100, AT_TOP, 0);
    // ~1.0 px/ms over the tail, 60px of travel — a deliberate flick.
    tracker.move(320, 100, AT_TOP, 20);
    tracker.move(340, 100, AT_TOP, 40);
    tracker.move(360, 100, AT_TOP, 60);
    const release = tracker.release(64);
    expect(release.commit).toBe(true);
  });

  it('does NOT commit a slow short drag that is released below the threshold', () => {
    const tracker = createPullTracker();
    tracker.start(300, 100, AT_TOP, 0);
    tracker.move(330, 100, AT_TOP, 400);
    tracker.move(350, 100, AT_TOP, 900);
    expect(tracker.release(1400).commit).toBe(false);
  });

  it('does NOT commit when the finger rests before lifting (stale tail velocity)', () => {
    const tracker = createPullTracker();
    tracker.start(300, 100, AT_TOP, 0);
    tracker.move(320, 100, AT_TOP, 20);
    tracker.move(355, 100, AT_TOP, 50); // fast so far, but…
    // …a long pause with the finger down, then lift. Not a flick.
    expect(tracker.release(1600).commit).toBe(false);
  });

  it('cancel() (pointercancel — the browser took the gesture for a scroll) never commits', () => {
    const tracker = createPullTracker();
    tracker.start(300, 100, AT_TOP, 0);
    tracker.move(300 + PULL_COMMIT_PX + 40, 100, AT_TOP, 120);
    tracker.cancel();
    expect(tracker.phase()).toBe('idle');
    expect(tracker.release(140).commit).toBe(false);
  });
});
