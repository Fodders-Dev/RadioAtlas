import { describe, expect, it, vi } from 'vitest';
import { createPwaPlaybackSession, isInstalledStandalone } from './pwaPlaybackSession';

const setup = (initial: unknown = 'auto', eligible = true) => {
  let category = initial;
  const writes: unknown[] = [];
  const session = {
    get type() { return category; },
    set type(value: unknown) { writes.push(value); category = value; }
  };
  const record = vi.fn();
  const controller = createPwaPlaybackSession({
    isEligible: () => eligible,
    getAudioSession: () => session,
    record
  });
  return { controller, writes, record, getCategory: () => category, session };
};

describe('installed PWA playback category ownership', () => {
  it('acquires synchronously once per interval and retains through repeated acquire calls', () => {
    const state = setup();
    state.controller.acquire();
    state.controller.acquire();
    expect(state.writes).toEqual(['playback']);
    expect(state.getCategory()).toBe('playback');
    expect(state.record).toHaveBeenCalledWith('pwa_playback_category_acquire', 'acquired');
  });

  it('does not claim an existing playback category or change other values', () => {
    for (const initial of ['playback', 'ambient', null]) {
      const state = setup(initial);
      state.controller.acquire();
      expect(state.writes).toEqual([]);
    }
  });

  it('does not write when the caller is an ordinary tab or a non-Apple browser', () => {
    const state = setup('auto', false);
    state.controller.acquire();
    expect(state.writes).toEqual([]);
    expect(state.controller.getStatus()).toBe('ineligible');
  });

  it('attempts only once when assignment is ignored or throws', () => {
    const ignored = setup();
    Object.defineProperty(ignored.session, 'type', { get: () => 'auto', set: vi.fn() });
    ignored.controller.acquire();
    ignored.controller.acquire();
    expect(ignored.record).toHaveBeenCalledTimes(1);
    expect(ignored.controller.getStatus()).toBe('write-ignored');

    const throwing = setup();
    Object.defineProperty(throwing.session, 'type', { get: () => 'auto', set: () => { throw Error('ignored'); } });
    expect(() => throwing.controller.acquire()).not.toThrow();
  });

  it('restores only an owned unchanged override and starts a fresh interval after release', () => {
    const state = setup();
    state.controller.acquire();
    state.controller.release();
    expect(state.getCategory()).toBe('auto');
    expect(state.writes).toEqual(['playback', 'auto']);
    expect(state.controller.getStatus()).toBe('restored');
    state.controller.acquire();
    expect(state.writes).toEqual(['playback', 'auto', 'playback']);
  });

  it('preserves another writer change and contains failures from optional APIs and diagnostics', () => {
    const state = setup();
    state.controller.acquire();
    const externalSetter = vi.fn();
    Object.defineProperty(state.session, 'type', { get: () => 'ambient', set: externalSetter });
    state.controller.release();
    expect(state.controller.getStatus()).toBe('external-change');
    expect(state.writes).toEqual(['playback']);
    expect(externalSetter).not.toHaveBeenCalled();

    const broken = createPwaPlaybackSession({
      isEligible: () => { throw Error('partial API'); },
      getAudioSession: () => null,
      record: () => { throw Error('diagnostic failed'); }
    });
    expect(() => broken.acquire()).not.toThrow();
    expect(() => broken.release()).not.toThrow();
  });

  it('distinguishes unknown original, failed write, unknown readback, and unknown restore', () => {
    const unreadable = setup();
    Object.defineProperty(unreadable.session, 'type', { configurable: true, get: () => { throw Error('unreadable'); } });
    unreadable.controller.acquire();
    expect(unreadable.controller.getStatus()).toBe('original-unknown');

    const failedWrite = setup();
    Object.defineProperty(failedWrite.session, 'type', { configurable: true, get: () => 'auto', set: () => { throw Error('write failed'); } });
    failedWrite.controller.acquire();
    expect(failedWrite.controller.getStatus()).toBe('write-failed');

    let reads = 0;
    const unknownReadback = setup();
    Object.defineProperty(unknownReadback.session, 'type', {
      configurable: true,
      get: () => { reads += 1; if (reads > 1) throw Error('readback unknown'); return 'auto'; },
      set: vi.fn()
    });
    unknownReadback.controller.acquire();
    expect(unknownReadback.controller.getStatus()).toBe('readback-unknown');

    const unknownRestore = setup();
    unknownRestore.controller.acquire();
    Object.defineProperty(unknownRestore.session, 'type', { configurable: true, get: () => { throw Error('restore read'); } });
    unknownRestore.controller.release();
    expect(unknownRestore.controller.getStatus()).toBe('restore-unknown');

    const alreadyPlayback = setup('playback');
    alreadyPlayback.controller.acquire();
    alreadyPlayback.controller.release();
    expect(alreadyPlayback.controller.getStatus()).toBe('already-playback');
    expect(alreadyPlayback.writes).toEqual([]);
  });

  it('labels a readable unsupported original category as skipped and playback as already active', () => {
    const skipped = setup('ambient');
    skipped.controller.acquire();
    expect(skipped.controller.getStatus()).toBe('skipped-type');
    const already = setup('playback');
    already.controller.acquire();
    expect(already.controller.getStatus()).toBe('already-playback');
  });

  it('recognizes standalone via either supported signal and contains throwing getters', () => {
    const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    expect(isInstalledStandalone()).toBe(true);
    matchMedia.mockReturnValue({ matches: false } as MediaQueryList);
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'standalone');
    Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });
    expect(isInstalledStandalone()).toBe(true);
    Object.defineProperty(navigator, 'standalone', descriptor || { configurable: true, value: undefined });
    matchMedia.mockRestore();
  });
});
