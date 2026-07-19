import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isFreshNowPlayingTrack, observeStationNowPlaying } from './nowPlaying';
import type { NowPlayingSnapshot } from '../domain/contracts';
import type { StationLite } from '../types';

/**
 * Guards the two changes that fail SILENTLY if they are wrong:
 *
 *  1. `pollingListeners` — get this wrong and a station that appears in the
 *     search results stops refreshing its metadata. Entries are keyed by
 *     station and the playing station is essentially always also a search row,
 *     so a per-entry boolean instead of a per-listener set would switch off the
 *     wrong thing. Nothing visual would reveal it.
 *  2. `resolveOnce` — must never subscribe, never schedule a repoll, and must
 *     probe when the only "known" track is a stale cached one.
 */

const makeStation = (id: string): StationLite =>
  ({
    stationuuid: id,
    name: `Station ${id}`,
    url_resolved: `https://stream.example.com/${id}`,
    url: `https://stream.example.com/${id}`,
    homepage: '',
    favicon: '',
    country: '',
    state: '',
    tags: '',
    stationArtwork: '',
    description: '',
    websiteUrl: '',
    scheduleNote: '',
    isClaimed: false,
    isVerified: false,
    promoted: false
  }) as StationLite;

const snap = (over: Partial<NowPlayingSnapshot>): NowPlayingSnapshot => ({
  track: null,
  status: 'unavailable',
  source: 'none',
  failureKind: null,
  recommendedPollMs: 30_000,
  updatedAt: null,
  ...over
});

describe('isFreshNowPlayingTrack (anti-fabrication gate)', () => {
  it('accepts a live track', () => {
    expect(
      isFreshNowPlayingTrack(
        snap({ track: 'A - B', status: 'ready', source: 'icy-stream', updatedAt: Date.now() })
      )
    ).toBe(true);
  });

  it('accepts a very recent cached track', () => {
    expect(
      isFreshNowPlayingTrack(
        snap({ track: 'A - B', status: 'ready', source: 'cache', updatedAt: Date.now() - 60_000 })
      )
    ).toBe(true);
  });

  it('REJECTS a day-old cached track even though it is stamped ready', () => {
    // applyStoredTrackFallback resurrects tracks up to 14 days old and marks
    // them status:'ready'. Rendering that as «сейчас играет» is fabrication.
    expect(
      isFreshNowPlayingTrack(
        snap({
          track: 'A - B',
          status: 'ready',
          source: 'cache',
          updatedAt: Date.now() - 24 * 60 * 60 * 1000
        })
      )
    ).toBe(false);
  });

  it('rejects an empty snapshot', () => {
    expect(isFreshNowPlayingTrack(snap({}))).toBe(false);
  });
});

describe('observeStationNowPlaying scheduling', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    // Keep every probe off the network: the scheduling contract is what is
    // under test, not the fetch itself.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a resolveOnce listener never schedules a repoll timer', async () => {
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const stop = observeStationNowPlaying(makeStation('resolve-once'), () => {}, {
      resolveOnce: true
    });
    await vi.advanceTimersByTimeAsync(50);
    // The only timers a resolveOnce row may create are fetch timeouts, never a
    // 60s/120s refresh schedule.
    const scheduled = setTimeoutSpy.mock.calls.map((call) => Number(call[1]) || 0);
    expect(scheduled.some((delay) => delay >= 60_000)).toBe(false);
    stop();
  });

  it('a passive listener never schedules a repoll timer', async () => {
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const stop = observeStationNowPlaying(makeStation('passive'), () => {}, { passive: true });
    await vi.advanceTimersByTimeAsync(50);
    const scheduled = setTimeoutSpy.mock.calls.map((call) => Number(call[1]) || 0);
    expect(scheduled.some((delay) => delay >= 60_000)).toBe(false);
    stop();
  });

  it('a resolveOnce listener on the SAME station does not disable a full listener’s polling', async () => {
    // The regression this exists for: one shared entry per station, and the
    // playing station is always also a search row.
    const station = makeStation('shared');
    const stopFull = observeStationNowPlaying(station, () => {});
    const stopRow = observeStationNowPlaying(station, () => {}, { resolveOnce: true });

    await vi.advanceTimersByTimeAsync(50);
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    // Let the in-flight probe settle so the entry reaches its scheduling path.
    await vi.advanceTimersByTimeAsync(30_000);

    stopRow();
    await vi.advanceTimersByTimeAsync(30_000);
    // The full listener is still attached, so a refresh schedule must still be
    // reachable for it.
    const scheduled = setTimeoutSpy.mock.calls.map((call) => Number(call[1]) || 0);
    expect(scheduled.some((delay) => delay >= 60_000)).toBe(true);
    stopFull();
  });

  it('unsubscribing the last listener does not throw and releases the entry', async () => {
    const stop = observeStationNowPlaying(makeStation('release'), () => {}, { resolveOnce: true });
    expect(() => stop()).not.toThrow();
    await vi.advanceTimersByTimeAsync(10);
  });
});
