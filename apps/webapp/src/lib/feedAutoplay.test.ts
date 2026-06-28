import { describe, expect, it } from 'vitest';
import { createAutoplaySettler } from './feedAutoplay';

// Manual timer scheduler — the settler keeps at most one pending timer, so
// flush() = "the scroll went quiet for settleMs".
const manualTimers = () => {
  let seq = 0;
  const pending = new Map<number, () => void>();
  return {
    setTimer: (callback: () => void) => {
      const id = (seq += 1);
      pending.set(id, callback);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (handle: ReturnType<typeof setTimeout>) => {
      pending.delete(handle as unknown as number);
    },
    flush: () => {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((cb) => cb());
    },
    count: () => pending.size
  };
};

describe('createAutoplaySettler', () => {
  it('a fast swipe through 3 cards plays ONCE (the card you stop on)', () => {
    const plays: number[] = [];
    const timers = manualTimers();
    const settler = createAutoplaySettler({
      settleMs: 220,
      onSettle: (i) => plays.push(i),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer
    });

    settler.notify(0);
    settler.notify(1);
    settler.notify(2);
    expect(timers.count()).toBe(1); // earlier timers were cleared
    expect(plays).toEqual([]); // nothing played mid-swipe

    timers.flush(); // scroll settled on card 2
    expect(plays).toEqual([2]);
  });

  it('two deliberate landings play twice', () => {
    const plays: number[] = [];
    const timers = manualTimers();
    const settler = createAutoplaySettler({
      settleMs: 200,
      onSettle: (i) => plays.push(i),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer
    });

    settler.notify(0);
    timers.flush();
    settler.notify(1);
    timers.flush();
    expect(plays).toEqual([0, 1]);
  });

  it('re-reporting the settled card does not replay it', () => {
    const plays: number[] = [];
    const timers = manualTimers();
    const settler = createAutoplaySettler({
      settleMs: 200,
      onSettle: (i) => plays.push(i),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer
    });

    settler.notify(2);
    timers.flush();
    settler.notify(2); // IntersectionObserver re-fires for the same card
    expect(timers.count()).toBe(0); // no new timer armed
    timers.flush();
    expect(plays).toEqual([2]);
  });

  it('swiping back to a card before it settles plays the final resting card', () => {
    const plays: number[] = [];
    const timers = manualTimers();
    const settler = createAutoplaySettler({
      settleMs: 200,
      onSettle: (i) => plays.push(i),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer
    });

    settler.notify(1);
    settler.notify(0); // swiped back before settle
    timers.flush();
    expect(plays).toEqual([0]);
  });

  it('reset() lets the same card play again (re-entering the feed)', () => {
    const plays: number[] = [];
    const timers = manualTimers();
    const settler = createAutoplaySettler({
      settleMs: 200,
      onSettle: (i) => plays.push(i),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer
    });

    settler.notify(0);
    timers.flush();
    settler.reset();
    settler.notify(0);
    timers.flush();
    expect(plays).toEqual([0, 0]);
  });

  it('cancel() drops a pending play', () => {
    const plays: number[] = [];
    const timers = manualTimers();
    const settler = createAutoplaySettler({
      settleMs: 200,
      onSettle: (i) => plays.push(i),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer
    });

    settler.notify(3);
    settler.cancel();
    expect(timers.count()).toBe(0);
    timers.flush();
    expect(plays).toEqual([]);
  });
});
