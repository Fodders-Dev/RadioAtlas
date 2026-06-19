import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useSleepTimer, type SleepTimerControls } from './sleepTimer';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe('useSleepTimer (auto-stop)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const mount = (onElapse: () => void) => {
    let latest: SleepTimerControls | null = null;
    const Probe = () => {
      latest = useSleepTimer(onElapse);
      return null;
    };
    act(() => {
      root.render(createElement(Probe));
    });
    return () => latest as SleepTimerControls;
  };

  it('fires onElapse exactly once when the duration elapses, then deactivates', () => {
    const onElapse = vi.fn();
    const api = mount(onElapse);
    act(() => api().start(15));
    expect(api().active).toBe(true);
    expect(onElapse).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(15 * 60_000));
    expect(onElapse).toHaveBeenCalledTimes(1);
    expect(api().active).toBe(false);

    // No double-fire after it has elapsed.
    act(() => vi.advanceTimersByTime(5 * 60_000));
    expect(onElapse).toHaveBeenCalledTimes(1);
  });

  it('cancel() stops the timer without ever firing', () => {
    const onElapse = vi.fn();
    const api = mount(onElapse);
    act(() => api().start(30));
    act(() => vi.advanceTimersByTime(10 * 60_000));
    act(() => api().cancel());
    expect(api().active).toBe(false);
    act(() => vi.advanceTimersByTime(60 * 60_000));
    expect(onElapse).not.toHaveBeenCalled();
  });

  it('counts down while active', () => {
    const api = mount(() => {});
    act(() => api().start(15));
    const first = api().remainingMs;
    act(() => vi.advanceTimersByTime(60_000));
    expect(api().remainingMs).toBeLessThan(first);
    expect(api().remainingMs).toBeGreaterThan(0);
  });
});
