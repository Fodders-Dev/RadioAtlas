import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { useAudioPlayer } from './useAudioPlayer';
import { PLAY_PENDING_RECHECK_MS } from './candidateSwitchGuard';
import type { StationLite } from '../types';

/**
 * The wiring test for the bug that cost a third of all plays.
 *
 * `decideCandidateSwitch` is covered on its own, but the defect was never in the
 * decision — it was that nobody asked. A slow station emits `waiting`, the
 * buffering watchdog fires, calls the next candidate, and that calls
 * `audio.load()` on top of a `play()` that has not settled. The play rejects
 * with AbortError, the catch records a dead candidate, and the watchdog and the
 * candidate loop then walk the same list against each other until it is empty
 * and the listener is told the station has no playable stream — on a station
 * that answers in 88ms.
 *
 * So this test drives the real hook with a `play()` that never resolves, and
 * asserts on `load()`: not called again while the play is in flight, called once
 * the guard runs out of patience, because a promise that never settles is the
 * hang the watchdog exists for.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock('./apiAvailability', () => ({
  checkApiAvailability: () => Promise.resolve(false),
  markApiUnavailable: () => {}
}));
vi.mock('./observability', () => ({ reportClientEvent: () => {} }));
vi.mock('./apiBase', () => ({ getApiBase: () => '' }));

const station: StationLite = {
  stationuuid: 'uuid-slow',
  name: 'Slow But Alive FM',
  // Two streams, because the real case had several candidates: with one, the
  // watchdog has nowhere to move and the test would prove nothing.
  url_resolved: 'https://stream.test/slow',
  url: 'https://stream.test/slow-alternate',
  country: 'Japan',
  tags: 'jazz'
} as StationLite;

describe('the buffering watchdog and an in-flight play()', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let audio: HTMLAudioElement | null = null;
  let loadCalls = 0;
  let releasePlay: (() => void) | null = null;
  const origCreateElement = document.createElement.bind(document);

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    audio = null;
    loadCalls = 0;
    releasePlay = null;

    vi.spyOn(document, 'createElement').mockImplementation(((tag: string, opts?: unknown) => {
      const el = origCreateElement(tag as 'audio', opts as undefined);
      if (tag === 'audio') {
        audio = el as HTMLAudioElement;
        // jsdom implements neither, and both are the subject here.
        el.load = () => {
          loadCalls += 1;
        };
        // `paused` has to be driven by hand, and getting this wrong makes the
        // whole file lie: handleWaiting bails on its first line when the element
        // is paused, so with jsdom's default (always paused, because a mocked
        // play() never clears it) every `waiting` event below would be ignored
        // and both tests would pass while asserting nothing.
        let paused = true;
        Object.defineProperty(el, 'paused', { get: () => paused, configurable: true });
        el.play = () => {
          paused = false;
          return new Promise<void>((resolve) => {
            releasePlay = () => resolve();
          });
        };
        el.pause = () => {
          paused = true;
        };
      }
      return el;
    }) as typeof document.createElement);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
    container.remove();
  });

  const mount = () => {
    let api: ReturnType<typeof useAudioPlayer> | null = null;
    const Host = () => {
      api = useAudioPlayer({});
      return null;
    };
    act(() => {
      root = createRoot(container);
      root.render(createElement(Host));
    });
    return () => api!;
  };

  it('does not tear down a play that has not settled yet', async () => {
    const api = mount();
    act(() => {
      void api().playStation(station);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    const loadsAfterAttach = loadCalls;
    expect(loadsAfterAttach).toBeGreaterThan(0);
    expect(releasePlay, 'play() should be in flight').not.toBeNull();

    // The station is slow, not broken: the browser says `waiting`, and the
    // watchdog's grace elapses while play() is still pending.
    act(() => {
      audio?.dispatchEvent(new Event('waiting'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(
      loadCalls,
      'the watchdog attached a new source while play() was pending — this is the AbortError'
    ).toBe(loadsAfterAttach);
  });

  it('still recovers when the play promise never settles at all', async () => {
    const api = mount();
    act(() => {
      void api().playStation(station);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    const loadsAfterAttach = loadCalls;

    act(() => {
      audio?.dispatchEvent(new Event('waiting'));
    });
    // Grace, then both deferrals, then the guard gives up: the watchdog must be
    // allowed through, or a hung promise would wedge playback forever.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });

    expect(loadCalls).toBeGreaterThan(loadsAfterAttach);
  });
});
