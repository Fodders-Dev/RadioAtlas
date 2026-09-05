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
  /**
   * Every source URL the player actually attached, in order, OBSERVED at the
   * moment `load()` runs.
   *
   * ⚠ This replaces an array the test filled in by hand inside its own
   * `startPlaying()` helper. That version could only ever contain the station
   * the helper had just written into it, so «nothing walked the queue» was a
   * tautology: it re-read the test's own bookkeeping and would have stayed
   * green while the player attached Berlin, a podcast, or nothing at all.
   *
   * `getAttribute('src')` rather than `el.src`, because jsdom resolves the
   * property against the document base and the raw attribute is what
   * `attachSource` actually set.
   */
  let sourceAttachments: string[] = [];
  const attachedStations = () =>
    sourceAttachments.map((url) =>
      url.includes('paradise') ? 'uuid-paradise' : url.includes('berlin') ? 'uuid-berlin' : url
    );
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
    sourceAttachments = [];
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
          // The observation, taken from the element rather than from the test.
          const src = el.getAttribute('src');
          if (src) sourceAttachments.push(src);
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

  /**
   * Swap what `play()` does while KEEPING the call counting. Tests that
   * reassign `audio.play` wholesale lose `playCalls`, and a counter that
   * silently stops moving reads as «ничего не запускалось».
   */
  const setPlay = (impl: () => Promise<void>) => {
    if (!audio) return;
    audio.play = () => {
      playCalls += 1;
      return impl().then(() => {
        paused = false;
      });
    };
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
  /**
   * ⚠ SPLIT from one test that proved neither half.
   *
   * The single «keeps the source and a working retry» test fired a native
   * `error` while the debt stood UNAUTHORISED. `tryNextCandidate` refused at
   * the door, so the walk never reached the rejecting `play()` — the test named
   * candidate exhaustion and measured suppression. And it read exhaustion off
   * `candidateStarts`, which the test had filled in itself.
   *
   * Two different states, so two tests. This one is «запрещено».
   */
  it('a FORBIDDEN walk is not an exhausted one: a native error changes nothing', async () => {
    const get = mount();
    await startPlaying(get);
    await hideFor(60_000);
    setVisibility('visible');

    const attachmentsBefore = sourceAttachments.length;
    setPlay(() => Promise.reject(new Error('no route to host')));
    await act(async () => {
      audio?.dispatchEvent(new Event('error'));
      await vi.advanceTimersByTimeAsync(300);
    });

    // Nothing was tried, because nothing was allowed to be tried.
    expect(sourceAttachments.length, 'a held walk attaches nothing').toBe(attachmentsBefore);
    // ⚠ And — the point of the split — the listener is NOT told their station
    // is unplayable. `false` used to mean both "held" and "spent", so the error
    // handler tore the station off the air and painted «нет доступного потока»
    // over a stream nothing had proven was broken.
    expect(get().status, 'a held walk is not an error state').not.toBe('error');
    expect(
      (get().current ?? get().pending)?.stationuuid,
      'and the station stays exactly where it was'
    ).toBe('uuid-paradise');
  });

  /**
   * ⚠ And this one is «разрешено, но кандидаты кончились» — reached through the
   * listener's own control, with every attachment observed.
   */
  it('keeps the source and a working retry after a PERMITTED attempt exhausts every candidate', async () => {
    const get = mount();
    await startPlaying(get);
    await hideFor(60_000);
    setVisibility('visible');

    // The listener asks: Pause (the only control on screen), then Play. That
    // authorises this debt, and the attempt succeeds at the element level.
    await act(async () => {
      await get().toggle();
    });
    await act(async () => {
      await get().toggle();
    });
    const attachmentsAfterTap = sourceAttachments.length;
    expect(attachmentsAfterTap, 'the tap reconnected').toBeGreaterThan(0);

    // Now the route dies under a permitted attempt. The walk is allowed to run
    // and genuinely runs out of candidates.
    setPlay(() => Promise.reject(new Error('no route to host')));
    await act(async () => {
      audio?.dispatchEvent(new Event('error'));
      await vi.advanceTimersByTimeAsync(300);
    });

    // ⚠ A DIFFERENT url, not merely one more `load()`. «Кандидаты кончились»
    // is only true if the walk actually moved through them, and a reattach of
    // the same source would satisfy a bare count.
    const walked = sourceAttachments.slice(attachmentsAfterTap);
    expect(walked, 'a permitted walk really tries the NEXT candidate').toContain(
      'https://stream.test/paradise-alt'
    );
    expect(get().status, 'and only then is the error honest').toBe('error');
    // `current` stays null: it means ON AIR, and nothing is on air.
    expect(get().current, 'nothing may claim to be broadcasting').toBeNull();
    expect(get().pending?.stationuuid, 'the source must still be on screen').toBe('uuid-paradise');

    // The listener's control works and reconnects THAT station.
    setPlay(() => Promise.resolve());
    const attachmentsBeforeRetry = sourceAttachments.length;
    await act(async () => {
      await get().toggle();
    });
    expect(
      sourceAttachments.length,
      'the retry must actually reattach'
    ).toBeGreaterThan(attachmentsBeforeRetry);
    expect(
      (get().current ?? get().pending)?.stationuuid,
      'and it must be the same station'
    ).toBe('uuid-paradise');
    // ⚠ Observed, not bookkept: every source the element was ever given belongs
    // to the station the listener asked for. Nothing walked the queue.
    expect(new Set(attachedStations())).toEqual(new Set(['uuid-paradise']));
  });

  /**
   * ⚠ `play()` RESOLVING is not proof of audio, and this is the test that was
   * promised for it.
   *
   * Production showed the shape twice in one night: `paused: false`,
   * `currentTime` frozen at 0, the dock reading «Буферизация». If the debt were
   * closed on `resumed.ok`, the next Play would fall through to the branch that
   * only reattaches when `audio.src` is EMPTY — a bare `.play()` on a source
   * that has never produced a sample.
   *
   * Mutation: clearing `backgroundResumeEligibleRef` right after the `resumed`
   * await in `toggle` reddens the final assertion.
   */
  it('a resolved play() with a frozen position leaves the NEXT Play still able to reconnect', async () => {
    const get = mount();
    await startPlaying(get);
    await hideFor(60_000);
    setVisibility('visible');
    const frozenAt = position;

    // First recovery: the element accepts the request and reports playing...
    await act(async () => {
      await get().toggle();
    });
    await act(async () => {
      await get().toggle();
    });
    expect(paused, 'the element claims to be playing').toBe(false);
    // ...and the position never moves. No `timeupdate` is dispatched, so
    // nothing proved anything. This is the exact production shape: `paused:
    // false` over a `currentTime` that has not advanced a sample.
    expect(position, 'no audio was produced').toBe(frozenAt);

    // Ordinary Pause, then Play.
    await act(async () => {
      await get().toggle();
    });
    const attachmentsBefore = sourceAttachments.length;
    await act(async () => {
      await get().toggle();
    });

    expect(
      sourceAttachments.length,
      'an unproven stream must still reconnect, not resume'
    ).toBeGreaterThan(attachmentsBefore);
    expect(attachedStations().at(-1)).toBe('uuid-paradise');
  });

  /**
   * ⚠ ITEM 1: permission belongs to ONE recovery cycle.
   *
   * The boolean this replaces had no expiry. Pressing Play once, getting no
   * progress, leaving the app and coming back granted an AUTOMATIC recovery on
   * the strength of a tap that belonged to the previous cycle — a permission
   * outliving what it permitted.
   *
   * Mutation: drop the `cycleId` comparison from `recoveryAuthorizationCovers`
   * and the second return starts audio on its own.
   */
  it('does not carry one cycle’s permission into the next background return', async () => {
    const get = mount();
    await startPlaying(get);

    // Cycle 1: away, back, and the listener explicitly asks for the reconnect.
    await hideFor(60_000);
    setVisibility('visible');
    await act(async () => {
      await get().toggle();
    });
    await act(async () => {
      await get().toggle();
    });
    expect(paused, 'the explicit Play was carried out').toBe(false);
    // ⚠ The element REPORTS playing, and the position still never moves — the
    // production shape this whole lane exists for.
    //
    // Dispatching this is load bearing, and its absence made the first version
    // of this test unfalsifiable: `candidateHasPlayedRef` is only set in
    // `handlePlaying`, and the stall watchdog requires both `hasPlayed` and a
    // status that is not 'paused'. Without the event the watchdog was disabled
    // for reasons that have nothing to do with the permission, so removing the
    // `cycleId` comparison left this test green. Caught by mutation.
    act(() => {
      audio?.dispatchEvent(new Event('playing'));
    });

    // Still no progress, so the debt is still open — and the app goes away
    // again. This raises a NEW debt for a cycle nobody has authorised.
    await hideFor(60_000);
    setVisibility('visible');

    const playsAfterReturn = playCalls;
    const attachmentsAfterReturn = sourceAttachments.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(
      playCalls,
      'the second return must be asked for again, not inherit the first tap'
    ).toBe(playsAfterReturn);
    expect(sourceAttachments.length, 'and nothing may reattach either').toBe(
      attachmentsAfterReturn
    );

    // The listener can still ask, and it still works.
    await act(async () => {
      await get().toggle();
    });
    await act(async () => {
      await get().toggle();
    });
    expect(sourceAttachments.length, 'the new explicit Play reconnects').toBeGreaterThan(
      attachmentsAfterReturn
    );
  });

  /**
   * ⚠ ITEM 2: a debt on A may not freeze B.
   *
   * `automaticPlaybackSuppressed` used to ask only «есть ли токен», so an
   * unresolved debt on Radio Paradise blocked the candidate failover of a
   * station the listener had just explicitly started. The check in `toggle`
   * cannot help: the listener reached B through `playStation`, not through the
   * play/pause control.
   *
   * Mutation: make `unresolvedRecoveryDebt` return the raw ref without
   * `canSpendRecoveryToken` and B never reaches its second candidate.
   */
  it('lets an explicitly started station fail over while another station’s debt is open', async () => {
    const get = mount();
    await startPlaying(get);

    // A owes a recovery, and nobody has authorised it.
    await hideFor(60_000);
    setVisibility('visible');

    // B is started explicitly, and its first candidate refuses.
    let refusals = 1;
    setPlay(() => {
      if (refusals > 0) {
        refusals -= 1;
        return Promise.reject(new Error('no route to host'));
      }
      return Promise.resolve();
    });
    const attachmentsBefore = sourceAttachments.length;
    await act(async () => {
      await get().playStation(stationB);
    });

    const berlinAttachments = attachedStations()
      .slice(attachmentsBefore)
      .filter((id) => id === 'uuid-berlin');
    expect(
      berlinAttachments.length,
      "B must be allowed to walk its own candidates despite A's debt"
    ).toBeGreaterThan(1);
    expect(paused, 'and B must end up playing').toBe(false);
    expect(get().pending?.stationuuid ?? get().current?.stationuuid).toBe('uuid-berlin');
  });

  /**
   * ⚠ ITEM 3: the sleep timer and the headphone-unplug guard revoke too.
   *
   * `toggle()`'s pause branch cleared the old boolean; `pause()` did not. So
   * «a deliberate pause withdraws the permission» was untrue for two of the
   * three ways to pause, and a native `error` after one of them walked to the
   * next candidate and started the radio again — after a sleep timer, or into
   * the phone's speaker once the headphones were out.
   *
   * Mutation: remove the revocation from `pause()` and this reddens.
   */
  it('a sleep-timer pause withdraws the permission an explicit Play granted', async () => {
    const get = mount();
    await startPlaying(get);
    await hideFor(60_000);
    setVisibility('visible');

    // The listener authorises a recovery; it is accepted but proves nothing.
    await act(async () => {
      await get().toggle();
    });
    await act(async () => {
      await get().toggle();
    });
    expect(paused, 'the authorised attempt is running').toBe(false);

    // The sleep timer fires (the same entry point as the headphone guard).
    act(() => {
      get().pause();
    });
    expect(paused, 'the element is paused').toBe(true);

    const playsAfterPause = playCalls;
    const attachmentsAfterPause = sourceAttachments.length;
    setPlay(() => Promise.resolve());
    await act(async () => {
      audio?.dispatchEvent(new Event('error'));
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(playCalls, 'nothing may restart the radio after a deliberate pause').toBe(
      playsAfterPause
    );
    expect(sourceAttachments.length, 'and nothing may reattach a source').toBe(
      attachmentsAfterPause
    );
    expect(paused, 'it must still be paused').toBe(true);
  });

  /**
   * ⚠ ITEM 3, second half: permission checked at the DOOR is not permission at
   * the moment of sound.
   *
   * `playCandidateAtIndex` awaits — `attachSource` can await a dynamic `hls.js`
   * import, the audio graph awaits its context, and `play()` itself is a
   * promise. A pause landing inside that window used to find an attempt already
   * cleared for takeoff.
   *
   * Here the revocation happens INSIDE the first candidate's rejection, so the
   * walk is mid-flight when permission disappears.
   *
   * Mutation: remove the check at the top of the loop in `playCandidateAtIndex`
   * and the walk carries on to the second candidate.
   */
  it('stops a walk already in flight when the permission is withdrawn mid-attempt', async () => {
    const get = mount();
    await startPlaying(get);
    await hideFor(60_000);
    setVisibility('visible');

    let revokeOnNextPlay = false;
    setPlay(() =>
      Promise.resolve().then(() => {
        if (revokeOnNextPlay) {
          revokeOnNextPlay = false;
          // The sleep timer fires while this candidate is still settling.
          get().pause();
        }
        throw new Error('no route to host');
      })
    );

    // The only control on screen, then the explicit Play that authorises.
    await act(async () => {
      await get().toggle();
    });
    const attachmentsBefore = sourceAttachments.length;
    revokeOnNextPlay = true;
    await act(async () => {
      await get().toggle();
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(
      sourceAttachments.length - attachmentsBefore,
      'exactly one candidate was attached before the permission went away'
    ).toBe(1);
    expect(paused, 'and the element stays paused').toBe(true);
  });
});
