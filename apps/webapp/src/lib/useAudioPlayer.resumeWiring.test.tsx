import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { useAudioPlayer } from './useAudioPlayer';
import type { StationLite } from '../types';

/**
 * 0.1b.1 — the WIRING, driven by a real `visibilitychange` on a mounted hook.
 *
 * ⚠ This file exists because the background path had no wiring coverage at all:
 * the only background test drove the pure `judgeBackgroundPlayback` with
 * hand-built objects and never dispatched an event, so nothing asserted what
 * the handler does to an actual `<audio>` element. A bug could live in the
 * handler forever and the suite would stay green — which is what happened.
 *
 * The contract under test:
 *   - a resume that this foreground return owes must RECONNECT (reattach the
 *     source), never `.play()` a socket the OS already dropped;
 *   - an intentional pause before leaving must never reach that path;
 *   - a survived background must change nothing;
 *   - the station identity must be untouched no matter what happens.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock('./apiAvailability', () => ({
  checkApiAvailability: () => Promise.resolve(false),
  markApiUnavailable: () => {}
}));
vi.mock('./observability', () => ({ reportClientEvent: () => {} }));
vi.mock('./apiBase', () => ({ getApiBase: () => '' }));

const stationB: StationLite = {
  stationuuid: 'uuid-berlin',
  name: 'Berlin Pulse',
  url_resolved: 'https://stream.test/berlin',
  url: 'https://stream.test/berlin-alt',
  country: 'Germany',
  tags: 'techno'
} as StationLite;

const station: StationLite = {
  stationuuid: 'uuid-paradise',
  name: 'Radio Paradise',
  url_resolved: 'https://stream.test/paradise',
  url: 'https://stream.test/paradise-alt',
  country: 'United States',
  tags: 'eclectic'
} as StationLite;

describe('returning to the app after the stream may have died', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let audio: HTMLAudioElement | null = null;
  let loadCalls = 0;
  let playCalls = 0;
  let paused = true;
  let position = 0;
  const origCreateElement = document.createElement.bind(document);

  const setVisibility = (value: 'hidden' | 'visible') => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    audio = null;
    loadCalls = 0;
    playCalls = 0;
    paused = true;
    position = 0;

    vi.spyOn(document, 'createElement').mockImplementation(((tag: string, opts?: unknown) => {
      const el = origCreateElement(tag as 'audio', opts as undefined);
      if (tag === 'audio') {
        audio = el as HTMLAudioElement;
        el.load = () => {
          loadCalls += 1;
        };
        Object.defineProperty(el, 'paused', { get: () => paused, configurable: true });
        // Driven by hand: the whole question is what the code does when the
        // element claims one thing and the position says another.
        Object.defineProperty(el, 'currentTime', {
          get: () => position,
          set: (v: number) => {
            position = v;
          },
          configurable: true
        });
        el.play = () => {
          playCalls += 1;
          paused = false;
          return Promise.resolve();
        };
        el.pause = () => {
          paused = true;
          // ⚠ A real element FIRES this. Without it React's `isPlaying` stays
          // true, `toggle()` takes its pause branch a second time, and the test
          // silently measures nothing — the same shape of self-inflicted false
          // pass as setting `paused` by hand.
          el.dispatchEvent(new Event('pause'));
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
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    vi.restoreAllMocks();
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

  const startPlaying = async (get: () => ReturnType<typeof useAudioPlayer>) => {
    await act(async () => {
      await get().playStation(station);
    });
    // The element is on air and the position is moving.
    paused = false;
    position = 10;
    act(() => {
      audio?.dispatchEvent(new Event('playing'));
    });
  };

  it('reconnects rather than resuming a dead socket after a background death', async () => {
    const get = mount();
    await startPlaying(get);
    const before = get().current?.stationuuid;

    setVisibility('hidden');
    // The OS kills the stream: paused, and the position never moved.
    // ⚠ Dispatch the `pause` EVENT, not just the flag. Setting `paused = true`
    // by hand leaves React's `isPlaying` true, `toggle()` then takes its pause
    // branch, and the test measures nothing — which is exactly what the first
    // draft of this did. A real OS pause fires the event.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    paused = true;
    act(() => {
      audio?.dispatchEvent(new Event('pause'));
    });
    setVisibility('visible');

    const loadsBefore = loadCalls;
    const playsBefore = playCalls;
    await act(async () => {
      await get().toggle();
    });

    // ⚠ The whole point: a reattach, not a bare `.play()` on the old source.
    expect(loadCalls, 'the resume must reattach the source').toBeGreaterThan(loadsBefore);
    expect(playCalls, 'and it may only play AFTER reattaching').toBeGreaterThan(playsBefore);
    // And the station never moved.
    expect(get().current?.stationuuid ?? before).toBe('uuid-paradise');
  });

  it('never enters the resume path when the listener paused on purpose', async () => {
    const get = mount();
    await startPlaying(get);

    // A deliberate pause BEFORE leaving: no background marker is written at
    // all, because the handler only records while the element is playing.
    await act(async () => {
      await get().toggle();
    });
    expect(paused).toBe(true);

    setVisibility('hidden');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    setVisibility('visible');

    const loadsBefore = loadCalls;
    await act(async () => {
      await get().toggle();
    });
    // Resuming an intentional pause must not tear the stream down and rebuild
    // it — that would re-fetch on every ordinary play after an app switch.
    expect(loadCalls, 'an intentional pause owes no reconnect').toBe(loadsBefore);
  });

  it('changes nothing when the stream survived the background', async () => {
    const get = mount();
    await startPlaying(get);

    setVisibility('hidden');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    // Still playing, and the position advanced across the gap.
    position = 400;
    const loadsBefore = loadCalls;
    setVisibility('visible');

    expect(loadCalls, 'a survived stream must not be reattached').toBe(loadsBefore);
    expect(paused, 'and must not be paused').toBe(false);
    expect(get().current?.stationuuid).toBe('uuid-paradise');
  });

  it('keeps the same station even when every candidate fails', async () => {
    const get = mount();
    await startPlaying(get);
    setVisibility('hidden');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    paused = true;
    act(() => {
      audio?.dispatchEvent(new Event('pause'));
    });
    setVisibility('visible');

    // Every attempt from here on refuses.
    if (audio) audio.play = () => Promise.reject(new Error('no route to host'));

    await act(async () => {
      await get().toggle();
    });

    // ⚠ Berlin Pulse must be impossible: a failed recovery may not walk the
    // queue, the feed, or anything else. The listener asked for Radio Paradise.
    expect(get().current?.stationuuid).toBe('uuid-paradise');
  });

  /**
   * ⚠ THE test of this lane, and the path the UI actually forces.
   *
   * On a `died` verdict where the element still reports `paused === false` —
   * the OS froze the socket without pausing it — `handlePause` never fired, so
   * `isPlaying` is true and the ONLY control on screen is Pause. The listener
   * cannot reach Play without pressing Pause first.
   *
   * If that press surrendered the recovery token, the next Play fell straight
   * through to a bare `.play()` on the dead source. The mutation test on the
   * direct Play path could never see it, because the direct path is not the one
   * a person can walk.
   */
  it('survives the Pause the UI forces before Play is even reachable', async () => {
    const get = mount();
    await startPlaying(get);

    setVisibility('hidden');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    // Frozen, NOT paused: no `pause` event, so the UI still shows Pause.
    setVisibility('visible');
    expect(paused, 'the element still claims to be playing').toBe(false);

    // The only thing the listener can press.
    await act(async () => {
      await get().toggle();
    });
    expect(paused, 'that press pauses it').toBe(true);

    const loadsBefore = loadCalls;
    await act(async () => {
      await get().toggle();
    });
    expect(loadCalls, 'the following Play must RECONNECT, not resume a corpse').toBeGreaterThan(
      loadsBefore
    );
    expect(get().current?.stationuuid).toBe('uuid-paradise');
  });

  it('does not carry the recovery debt of one station onto another', async () => {
    const get = mount();
    await startPlaying(get);

    setVisibility('hidden');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    setVisibility('visible');

    // Switch before any `timeupdate` could resolve the cycle.
    await act(async () => {
      await get().playStation(stationB);
    });
    paused = false;
    position = 5;
    act(() => {
      audio?.dispatchEvent(new Event('playing'));
    });

    await act(async () => {
      await get().toggle();
    });
    const loadsBefore = loadCalls;
    await act(async () => {
      await get().toggle();
    });

    // ⚠ Station A's debt must not be spent on B's transport. A bare boolean
    // token would have reconnected here for no reason.
    expect(loadCalls, "B owes nothing for A's background").toBe(loadsBefore);
    expect(get().current?.stationuuid).toBe('uuid-berlin');
  });

  it('lets real progress resolve an ambiguous cycle', async () => {
    const get = mount();
    await startPlaying(get);

    setVisibility('hidden');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    // Short background -> `unknown`, so eligibility is granted defensively.
    setVisibility('visible');

    // Then the stream demonstrably produces audio.
    position = 42;
    act(() => {
      audio?.dispatchEvent(new Event('timeupdate'));
    });

    // From here Pause/Play is ordinary again: no reconnect, no re-fetch.
    await act(async () => {
      await get().toggle();
    });
    const loadsBefore = loadCalls;
    await act(async () => {
      await get().toggle();
    });
    expect(loadCalls, 'a proven-healthy stream owes no reconnect').toBe(loadsBefore);
  });

  it('lets a FAILED reconnect be retried on the same station', async () => {
    const get = mount();
    await startPlaying(get);
    setVisibility('hidden');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    paused = true;
    act(() => {
      audio?.dispatchEvent(new Event('pause'));
    });
    setVisibility('visible');

    // First recovery attempt fails outright.
    if (audio) audio.play = () => Promise.reject(new Error('no route'));
    await act(async () => {
      await get().toggle();
    });

    // The stream comes back; the listener taps again.
    if (audio) {
      audio.play = () => {
        playCalls += 1;
        paused = false;
        return Promise.resolve();
      };
    }
    const loadsBefore = loadCalls;
    await act(async () => {
      await get().toggle();
    });
    // ⚠ A failed reconnect must not downgrade the next tap to a bare `.play()`
    // on the source that just failed — that would make the second attempt
    // strictly worse than the first.
    expect(loadCalls, 'the retry must reconnect again').toBeGreaterThan(loadsBefore);
    expect(get().current?.stationuuid).toBe('uuid-paradise');
  });
});
