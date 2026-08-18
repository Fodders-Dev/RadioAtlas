import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { NowPlayingSnapshot } from '../domain/contracts';
import type { StationLite } from '../types';
import type { HomeRailModule } from '../lib/homeSurface';

/**
 * The shelf where somebody picks their first station ever now says what is
 * playing on it. Three things have to stay true, and every one of them fails
 * silently:
 *
 *  1. **No track → no line.** ~40% of stations never emit a title. A reserved
 *     row, a dash, or «недоступно» would turn the most valuable shelf into six
 *     apologies (lib/nowPlayingLine.ts documents why).
 *  2. **A stale cached track is not «now playing».** The 14-day localStorage
 *     cache stamps resurrected tracks `status: 'ready'`, so a status check would
 *     happily present last Tuesday's song as live. That is fabrication, which
 *     this project does not do.
 *  3. **Only the shelf that opted in probes at all.** Every previewing tile
 *     costs a metadata slot; a default-on preview would put the whole Home page
 *     on the metadata queue.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock('../lib/useCompactLayout', () => ({ useCompactLayout: () => false }));
vi.mock('../state/RadioContext', () => ({
  useLibrary: () => ({ playabilityProfile: null, stationHealthProfile: null })
}));

const reported: Array<{ name: string; meta: Record<string, unknown> }> = [];
vi.mock('../lib/productAnalytics', () => ({
  reportProductEvent: (name: string, meta: Record<string, unknown>) => {
    reported.push({ name, meta });
  }
}));

const observed = new Map<string, (snapshot: NowPlayingSnapshot) => void>();
const observeOptions: Array<Record<string, unknown> | undefined> = [];

vi.mock('../lib/nowPlaying', async (importOriginal) => {
  // isFreshNowPlayingTrack stays REAL — it is the anti-fabrication gate and a
  // stub of it would make point 2 above untestable.
  const actual = await importOriginal<typeof import('../lib/nowPlaying')>();
  return {
    ...actual,
    observeStationNowPlaying: (
      station: StationLite,
      listener: (snapshot: NowPlayingSnapshot) => void,
      options?: Record<string, unknown>
    ) => {
      observed.set(station.stationuuid, listener);
      observeOptions.push(options);
      return () => observed.delete(station.stationuuid);
    }
  };
});

import { HomeRail } from './homeCards';
import { LocaleProvider } from '../state/LocaleContext';

const makeStation = (i: number): StationLite =>
  ({
    stationuuid: `uuid-${i}`,
    name: `Station ${i}`,
    url_resolved: `https://example.com/${i}`,
    homepage: '',
    favicon: '',
    country: 'Testland',
    state: '',
    tags: 'jazz',
    stationArtwork: '',
    description: '',
    websiteUrl: '',
    scheduleNote: '',
    isClaimed: false,
    isVerified: false,
    promoted: false
  }) as StationLite;

const railModule = (stations: StationLite[]): HomeRailModule => ({
  id: 'rail-1',
  titleKey: 'home.tryNowTitle',
  copyKey: 'home.railCopy',
  sourceId: 'src-rail',
  accent: 'primary',
  label: null,
  stations
});

const snap = (over: Partial<NowPlayingSnapshot>): NowPlayingSnapshot => ({
  track: null,
  status: 'unavailable',
  source: 'none',
  failureKind: null,
  recommendedPollMs: 30_000,
  updatedAt: null,
  ...over
});

describe('the now-playing line on the «Попробуйте сейчас» shelf', () => {
  let container: HTMLDivElement;
  let root: Root;

  const mount = (node: ReactNode) =>
    act(() => root.render(createElement(LocaleProvider, { children: node })));

  const renderRail = (props: Record<string, unknown> = {}) =>
    mount(
      createElement(HomeRail, {
        module: railModule([1, 2, 3].map(makeStation)),
        currentStationId: null,
        activeTrack: null,
        isFavorite: () => false,
        onPlay: vi.fn(),
        onToggleFavorite: vi.fn(),
        onExplore: vi.fn(),
        ...props
      })
    );

  const lines = () => Array.from(container.querySelectorAll('.home-station-now'));
  const tileFor = (id: string) => container.querySelector<HTMLElement>(`[data-home-station="${id}"]`);

  beforeEach(() => {
    observed.clear();
    observeOptions.length = 0;
    reported.length = 0;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('shows nothing until a real track arrives', () => {
    renderRail({ showNowPlaying: true });
    expect(lines()).toHaveLength(0);

    act(() => observed.get('uuid-2')?.(snap({ status: 'unavailable' })));
    // Probed, nothing came back — which is simply how a lot of radio works.
    expect(lines()).toHaveLength(0);
  });

  it('shows the track, and only on the tile it belongs to', () => {
    renderRail({ showNowPlaying: true });
    act(() =>
      observed.get('uuid-2')?.(
        snap({ track: 'Beach House - Space Song', status: 'ready', source: 'icy-stream', updatedAt: Date.now() })
      )
    );

    expect(lines()).toHaveLength(1);
    expect(tileFor('uuid-2')!.querySelector('.home-station-now-text')!.textContent).toBe(
      'Beach House - Space Song'
    );
    expect(tileFor('uuid-1')!.querySelector('.home-station-now')).toBeNull();
    // The station name and location must survive — the track is an addition,
    // not a replacement for what the card is.
    expect(tileFor('uuid-2')!.querySelector('.home-station-title')!.textContent).toContain(
      'Station 2'
    );
    expect(tileFor('uuid-2')!.querySelector('.home-station-meta')).not.toBeNull();
  });

  it('refuses a day-old cached track instead of passing it off as live', () => {
    renderRail({ showNowPlaying: true });
    act(() =>
      observed.get('uuid-3')?.(
        snap({
          track: 'Something From Last Tuesday',
          // What applyStoredTrackFallback produces: stamped ready, from cache.
          status: 'ready',
          source: 'cache',
          updatedAt: Date.now() - 24 * 60 * 60 * 1000
        })
      )
    );
    expect(lines()).toHaveLength(0);
  });

  it('never probes on a shelf that did not ask', () => {
    renderRail();
    expect(observed.size).toBe(0);
    expect(lines()).toHaveLength(0);
  });

  it('asks for one resolution, never an ongoing poll', () => {
    renderRail({ showNowPlaying: true });
    expect(observeOptions).toHaveLength(3);
    for (const options of observeOptions) {
      expect(options).toMatchObject({ resolveOnce: true });
    }
  });

  it('uses what the player already knows for the station being listened to', () => {
    renderRail({
      showNowPlaying: true,
      currentStationId: 'uuid-1',
      activeTrack: 'Miles Davis - So What'
    });

    expect(tileFor('uuid-1')!.querySelector('.home-station-now-text')!.textContent).toBe(
      'Miles Davis - So What'
    );
    // ...and spends no metadata slot doing it.
    expect(observed.has('uuid-1')).toBe(false);
    expect(observed.has('uuid-2')).toBe(true);
  });

  it('reports how much of the shelf actually came alive', () => {
    vi.useFakeTimers();
    try {
      renderRail({ showNowPlaying: true });
      act(() =>
        observed.get('uuid-1')?.(
          snap({ track: 'A - B', status: 'ready', source: 'icy-stream', updatedAt: Date.now() })
        )
      );
      act(() => observed.get('uuid-2')?.(snap({ status: 'unavailable' })));
      act(() => observed.get('uuid-3')?.(snap({ status: 'unavailable' })));

      expect(reported).toHaveLength(0);
      act(() => vi.advanceTimersByTime(10_000));

      expect(reported).toHaveLength(1);
      expect(reported[0]).toMatchObject({
        name: 'home_now_playing_preview',
        meta: { previewed: 3, shown: 1 }
      });

      // Once per shelf, not once per tick.
      act(() => vi.advanceTimersByTime(60_000));
      expect(reported).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports nothing at all from a shelf that does not preview', () => {
    vi.useFakeTimers();
    try {
      renderRail();
      act(() => vi.advanceTimersByTime(60_000));
      expect(reported).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('names the line for a screen reader, since a bare dot means nothing spoken', () => {
    renderRail({ showNowPlaying: true });
    act(() =>
      observed.get('uuid-1')?.(
        snap({ track: 'A - B', status: 'ready', source: 'icy-stream', updatedAt: Date.now() })
      )
    );
    expect(tileFor('uuid-1')!.querySelector('.home-station-now')!.textContent).toContain(
      'Сейчас играет'
    );
  });
});
