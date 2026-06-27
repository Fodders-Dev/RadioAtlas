import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { subscribeNowPlaying } from './nowPlaying';
import type { StationLite } from '../types';

// A Nightride stream url → stationId «nightride» (see nightrideStationId).
const nightrideStation = (id = 'nightride'): StationLite =>
  ({ url_resolved: `https://stream.nightride.fm/${id}.mp3` }) as StationLite;

// jsdom has no EventSource — stub a minimal one that records construction and
// close() calls so we can assert the shared SSE is actually torn down.
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  closed = false;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  // Push a meta payload through, as nightride.fm/meta would.
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

describe('subscribeNowPlaying (Nightride SSE lifecycle)', () => {
  let originalEventSource: typeof globalThis.EventSource | undefined;

  beforeEach(() => {
    MockEventSource.instances = [];
    originalEventSource = globalThis.EventSource;
    (globalThis as { EventSource: unknown }).EventSource = MockEventSource;
  });

  afterEach(() => {
    (globalThis as { EventSource: unknown }).EventSource = originalEventSource;
  });

  it('opens one shared SSE and CLOSES it when the last listener leaves', () => {
    const stop = subscribeNowPlaying(nightrideStation(), () => {});
    expect(stop).toBeTypeOf('function');
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].closed).toBe(false);

    stop?.();
    // The fix: unsubscribing the last listener tears the socket down so its
    // onerror can't keep reconnecting in the background.
    expect(MockEventSource.instances[0].closed).toBe(true);
  });

  it('keeps the SSE open while OTHER listeners remain, closes it only at zero', () => {
    const stopA = subscribeNowPlaying(nightrideStation(), () => {});
    const stopB = subscribeNowPlaying(nightrideStation(), () => {});
    // Both share the one module-global source.
    expect(MockEventSource.instances).toHaveLength(1);

    stopA?.();
    expect(MockEventSource.instances[0].closed).toBe(false); // B still listening

    stopB?.();
    expect(MockEventSource.instances[0].closed).toBe(true); // size 0 → torn down
  });

  it('re-opens a FRESH SSE on a later subscription', () => {
    const stop1 = subscribeNowPlaying(nightrideStation(), () => {});
    stop1?.();
    expect(MockEventSource.instances).toHaveLength(1);

    // After teardown nightrideSource is null, so a new subscribe must construct
    // a brand-new EventSource rather than reuse the closed one.
    const stop2 = subscribeNowPlaying(nightrideStation(), () => {});
    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1].closed).toBe(false);
    stop2?.();
  });

  it('clears the cache on teardown (no stale track replays to a new subscriber)', () => {
    const stop1 = subscribeNowPlaying(nightrideStation(), () => {});
    // Cache a track for the station, then drop the last listener (clears cache).
    MockEventSource.instances[0].emit([{ station: 'nightride', artist: 'Gunship', title: 'Tech Noir' }]);
    stop1?.();

    let replayed: string | null | undefined;
    const stop2 = subscribeNowPlaying(nightrideStation(), (track) => {
      replayed = track;
    });
    // Cache was cleared → the fresh subscriber is NOT synchronously fed a stale
    // cached track (it would have been «Gunship — Tech Noir» otherwise).
    expect(replayed).toBeUndefined();
    stop2?.();
  });
});
