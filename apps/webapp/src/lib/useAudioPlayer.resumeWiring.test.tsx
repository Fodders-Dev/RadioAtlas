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
  let clockOffset = 0;
  /** Every station the player attached a source for, in order. */
  let candidateStarts: string[] = [];
  const origCreateElement = document.createElement.bind(document);
  const realNow = Date.now.bind(Date);

  /**
   * ⚠ Time has to be controllable, and the first version of this file proved
   * why by getting it wrong: it hid the page for 20 ms and called the result
   * «survived». `judgeBackgroundPlayback` returns `unknown` for anything under
   * BACKGROUND_JUDGE_MIN_MS (10 s), so that test never reached the branch in
   * its own name — it asserted the `unknown` path twice under two titles.
   *
   * Moving the clock rather than sleeping lets all three verdicts be reached
   * deliberately, and named honestly.
   */
  const hideFor = async (ms: number) => {
    setVisibility('hidden');
    clockOffset += ms;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  };

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
    clockOffset = 0;
    candidateStarts = [];
    // ⚠ Installed BEFORE anything mounts. Fake timers only capture timers
    // created after installation, so enabling them inside a test left the stall
    // watchdog's `setInterval` real — it never fired in the fake window and the
    // «no automatic sound» gate passed with the suppression removed. Caught by
    // mutation, not by reading.
    //
    // `shouldAdvanceTime` keeps the ordinary `await new Promise(setTimeout)`
    // helpers working while still allowing deliberate jumps.
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1 });
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + clockOffset);

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
    vi.useRealTimers();
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
    candidateStarts.push(station.stationuuid);
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

  it('SURVIVED: a background the audio played through changes nothing', async () => {
    const get = mount();
    await startPlaying(get);

    // A real 60s background with the position advancing across it. Under the
    // 10s floor this branch is unreachable, which is what the previous version
    // of this test silently asserted instead.
    await hideFor(60_000);
    position = 70;
    const loadsBefore = loadCalls;
    setVisibility('visible');

    expect(loadCalls, 'a survived stream must not be reattached').toBe(loadsBefore);
    expect(paused, 'and must not be paused').toBe(false);

    // And it owes nothing: an ordinary pause/play stays ordinary.
    await act(async () => {
      await get().toggle();
    });
    const loadsAfterPause = loadCalls;
    await act(async () => {
      await get().toggle();
    });
    expect(loadCalls, 'survived owes no reconnect').toBe(loadsAfterPause);
    expect(get().current?.stationuuid).toBe('uuid-paradise');
  });

  it('DIED: a long background with a frozen position owes a reconnect', async () => {
    const get = mount();
    await startPlaying(get);

    // 60s away, position never moved -> advancedMs 0 against hiddenMs 60000.
    await hideFor(60_000);
    setVisibility('visible');

    await act(async () => {
      await get().toggle();
    });
    const loadsBefore = loadCalls;
    await act(async () => {
      await get().toggle();
    });
    expect(loadCalls, 'a died background owes a reconnect').toBeGreaterThan(loadsBefore);
    expect(get().current?.stationuuid).toBe('uuid-paradise');
  });

  it('UNKNOWN: too short to judge still owes a reconnect, because unjudged is not healthy', async () => {
    const get = mount();
    await startPlaying(get);

    // Under the floor on purpose: an OS can drop a socket in five seconds.
    await hideFor(4_000);
    setVisibility('visible');

    await act(async () => {
      await get().toggle();
    });
    const loadsBefore = loadCalls;
    await act(async () => {
      await get().toggle();
    });
    expect(loadCalls, 'unknown must not be treated as healthy').toBeGreaterThan(loadsBefore);
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

  /**
   * ⚠ Station identity alone does NOT make a token safe.
   *
   * It stops A's debt being spent on B. It does not stop A's OLD debt being
   * spent on a NEW start of A: leave A backgrounded, switch to B, switch back,
   * and the stale token matches again by station. Per-cycle state has to die
   * with its cycle, or `cycleId` is decoration.
   */
  it('does not resurrect a stale cycle when the listener returns to the same station', async () => {
    const get = mount();
    await startPlaying(get);

    // A owes a recovery after an unresolved background.
    setVisibility('hidden');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    setVisibility('visible');

    // Away to B, which never produces audio, then deliberately back to A.
    await act(async () => {
      await get().playStation(stationB);
    });
    await act(async () => {
      await get().playStation(station);
    });
    paused = false;
    position = 100;
    act(() => {
      audio?.dispatchEvent(new Event('playing'));
    });

    // An ordinary pause/play on this FRESH start of A.
    await act(async () => {
      await get().toggle();
    });
    const loadsBefore = loadCalls;
    await act(async () => {
      await get().toggle();
    });

    expect(
      loadCalls,
      'a new deliberate start of A must not inherit the old cycle debt'
    ).toBe(loadsBefore);
    expect(get().current?.stationuuid).toBe('uuid-paradise');
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

  /**
   * ⚠ Gap found in audit: the recovery token gates `toggle()`, but the watchdog,
   * the reconnect timers and the native media events live on their own and can
   * reach `playCandidateAtIndex` without consulting it. «No automatic sound»
   * has to hold against ALL of them, not only against the visibility handler.
   */
  /**
   * ⚠ STRICT GATE, replacing a diagnostic that could not fail.
   *
   * The earlier version asserted `acrossWatchdog >= shortWait`, which is true
   * whether or not anything starts playing. It recorded the defect instead of
   * forbidding it.
   *
   * The defect: after a background return where the element is frozen but NOT
   * paused, the silent-stall watchdog reconnected on its own ~3s later.
   * `paused === false` proves neither continuous audio nor that the listener
   * wants sound now — they may have gone to a music service, played something
   * there, and come back to browse finds. Radio reappearing is a surprise.
   *
   * Time is advanced rather than waited on, so the watchdog interval is crossed
   * deliberately instead of by sleeping.
   */
  it('starts no audio of its own before the explicit Play, across real timers', async () => {
    const get = mount();
    await startPlaying(get);
    await hideFor(60_000);
    setVisibility('visible');

    const playsAfterReturn = playCalls;
    const loadsAfterReturn = loadCalls;

    // Well past the 3s watchdog interval and its 9s threshold, with the
    // position frozen — the state most likely to provoke a recovery.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(playCalls, 'nothing may start audio before the listener asks').toBe(playsAfterReturn);
    expect(loadCalls, 'and nothing may reattach the source either').toBe(loadsAfterReturn);

    // And the listener's own Play still works afterwards.
    await act(async () => {
      await get().toggle();
    });
    await act(async () => {
      await get().toggle();
    });
    expect(loadCalls, 'the explicit Play must still reconnect').toBeGreaterThan(loadsAfterReturn);
  });

  it('leaves a healthy surviving stream completely alone', async () => {
    const get = mount();
    await startPlaying(get);
    await hideFor(60_000);
    position = 70;
    setVisibility('visible');

    const before = { plays: playCalls, loads: loadCalls, paused };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    // No pause, no reattach, no extra play on a stream that is demonstrably fine.
    expect(playCalls).toBe(before.plays);
    expect(loadCalls).toBe(before.loads);
    expect(paused, 'a surviving stream must not be paused').toBe(before.paused);
  });

  /**
   * ⚠ STRICT GATE, replacing `station === null || station === A` — an assertion
   * that explicitly permitted the loss it was supposed to catch.
   *
   * A native `error` that exhausts every candidate used to null both `current`
   * and `pending`, so the listener lost the source AND the retry control
   * (`toggle()` returned early on a missing station).
   */
  it('keeps the source and a working retry after a native error exhausts every candidate', async () => {
    const get = mount();
    await startPlaying(get);
    await hideFor(60_000);
    setVisibility('visible');

    const queueBefore = candidateStarts.slice();
    if (audio) audio.play = () => Promise.reject(new Error('no route to host'));
    await act(async () => {
      audio?.dispatchEvent(new Event('error'));
      await new Promise((r) => setTimeout(r, 300));
    });

    const shown = get().current ?? get().pending;
    expect(shown?.stationuuid, 'the source must still be on screen').toBe('uuid-paradise');
    expect(get().status, 'and the error must be honest').toBe('error');
    // `current` stays null: it means ON AIR, and nothing is on air.
    expect(get().current, 'nothing may claim to be broadcasting').toBeNull();

    // The listener's control works and reconnects THAT station.
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
    expect(loadCalls, 'the retry must actually reattach').toBeGreaterThan(loadsBefore);
    expect(
      (get().current ?? get().pending)?.stationuuid,
      'and it must be the same station'
    ).toBe('uuid-paradise');
    // Nothing walked the queue on the way.
    expect(candidateStarts.every((id) => id === 'uuid-paradise')).toBe(true);
    expect(queueBefore.every((id) => id === 'uuid-paradise')).toBe(true);
  });
});
