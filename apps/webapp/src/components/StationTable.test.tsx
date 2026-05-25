import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { StationLite } from '../types';

// React's act() needs this flag set, otherwise it logs a "not configured
// to support act" warning under vitest's jsdom environment.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// Mutable holders the mocked context hooks read from. vi.hoisted runs
// before the hoisted vi.mock factories below, avoiding the TDZ trap of
// referencing a module-scope binding inside a hoisted factory.
const ctx = vi.hoisted(() => ({
  playback: { current: null as unknown },
  library: { current: null as unknown }
}));

vi.mock('../state/RadioContext', () => ({
  usePlayback: () => ctx.playback.current,
  useLibrary: () => ctx.library.current
}));
// The row opens a passive now-playing subscription in an effect; this
// test only measures render counts, so stub it to a no-op cleanup.
vi.mock('../lib/nowPlaying', () => ({
  observeStationNowPlaying: () => () => {}
}));
// Deterministic device profile so the lowPower branch can't diverge.
vi.mock('../lib/deviceProfile', () => ({
  getDeviceProfile: () => ({ lowPower: false, reducedMotion: false })
}));

import { StationTable } from './StationTable';
import { LocaleProvider } from '../state/LocaleContext';

// Kept referentially stable across makeLibrary() calls so the row's
// behaviorProfile prop never changes identity on unrelated re-renders —
// mirrors the real library, where behaviorProfile only changes on
// session events, never on a playback tick.
const SHARED_BEHAVIOR_PROFILE = null;

const makeStation = (i: number): StationLite =>
  ({
    stationuuid: `uuid-${i}`,
    name: `Station ${i}`,
    url_resolved: `https://example.com/${i}`,
    homepage: '',
    favicon: '',
    country: 'Testland',
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

const playbackFor = (active: StationLite | null, extra: Record<string, unknown> = {}) => ({
  player: {
    current: active,
    isPlaying: false,
    status: 'idle',
    failure: null,
    toggle: vi.fn()
  },
  nowPlaying: null,
  nowPlayingStatus: 'idle',
  nowPlayingState: { status: 'idle' },
  queue: { items: [] },
  playStation: vi.fn(),
  ...extra
});

const makeLibrary = (favorites: StationLite[]) => ({
  favorites,
  behaviorProfile: SHARED_BEHAVIOR_PROFILE,
  toggleFavorite: vi.fn(),
  hideStationFromRecommendations: vi.fn(),
  unhideStationFromRecommendations: vi.fn(),
  isStationHiddenFromRecommendations: () => false
});

const renderCounts = () => window.__radioatlasRowRenderCounts__ ?? {};

describe('StationTable (T2.11a memo + narrowed context)', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  const buildTree = (stations: StationLite[], nowPlayingMode: 'active-only' | 'viewport') =>
    createElement(
      LocaleProvider,
      null,
      createElement(StationTable, { stations, nowPlayingMode })
    );

  const mount = (stations: StationLite[], nowPlayingMode: 'active-only' | 'viewport') => {
    act(() => {
      root = createRoot(container);
      root.render(buildTree(stations, nowPlayingMode));
    });
  };

  // Build a FRESH element each time so React actually re-renders
  // StationTable (re-rendering an identical element reference bails out
  // before the tree is touched). The memoized rows then decide for
  // themselves whether their props changed.
  const rerender = (stations: StationLite[], nowPlayingMode: 'active-only' | 'viewport') => {
    act(() => {
      root?.render(buildTree(stations, nowPlayingMode));
    });
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    window.__radioatlasRowRenderCounts__ = {};
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    container.remove();
    delete window.__radioatlasRowRenderCounts__;
    vi.clearAllMocks();
  });

  it('re-renders only the active row on a now-playing tick, not the whole list', () => {
    // Below the virtualization threshold so the table renders flat and all
    // rows mount — this isolates the memo contract from the windowing layer
    // (windowing bounds are covered by station-list-virtualization.spec.ts).
    const stations = Array.from({ length: 40 }, (_, i) => makeStation(i));
    ctx.playback.current = playbackFor(stations[0]); // row 0 is the active station
    ctx.library.current = makeLibrary([]);

    mount(stations, 'viewport');
    // Reset the spy after mount + effects settle so we measure only what
    // the tick triggers (mount itself double-renders viewport rows once
    // via the IntersectionObserver fallback in jsdom).
    window.__radioatlasRowRenderCounts__ = {};

    // A now-playing tick: brand-new player object + track, SAME active
    // station, SAME library. Pre-T2.11a every row subscribed to
    // usePlayback()/useLibrary(), so this re-rendered all 40 rows. Now
    // only row 0's activePlayback prop changes.
    ctx.playback.current = playbackFor(stations[0], {
      nowPlaying: 'Artist - Track',
      player: {
        current: stations[0],
        isPlaying: true,
        status: 'playing',
        failure: null,
        toggle: vi.fn()
      }
    });
    rerender(stations, 'viewport');

    const counts = renderCounts();
    expect(Object.keys(counts)).toEqual(['uuid-0']);
    expect(counts['uuid-0']).toBe(1);
  });

  it('re-renders a row when its own favorite state flips, leaving siblings untouched', () => {
    const stations = Array.from({ length: 40 }, (_, i) => makeStation(i));
    ctx.playback.current = playbackFor(null); // nothing playing
    ctx.library.current = makeLibrary([]);

    mount(stations, 'viewport');
    window.__radioatlasRowRenderCounts__ = {};

    // User favorites station 5 → new favorites array → only that row's
    // `liked` boolean flips. Proves the memo isn't over-blocking real
    // per-row changes (and that exactly one row reacts).
    ctx.library.current = makeLibrary([stations[5]]);
    rerender(stations, 'viewport');

    const counts = renderCounts();
    expect(Object.keys(counts)).toEqual(['uuid-5']);
    expect(counts['uuid-5']).toBe(1);
  });
});
