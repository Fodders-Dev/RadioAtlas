import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { StationLite } from '../../types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ctx = vi.hoisted(() => ({
  playback: { current: null as unknown },
  library: { current: null as unknown },
  track: { current: null as string | null }
}));

vi.mock('../../state/RadioContext', () => ({
  usePlayback: () => ctx.playback.current,
  useLibrary: () => ctx.library.current
}));

// The admission controller is exercised on its own terms; here we only need to
// drive the row's render contract from a known track value.
vi.mock('./useSearchNowPlaying', () => ({
  useSearchNowPlaying: () => ({ rowRef: () => {}, track: ctx.track.current })
}));

import { SearchResultRow } from './SearchResultRow';
import { LocaleProvider } from '../../state/LocaleContext';

const makeStation = (over: Partial<StationLite> = {}): StationLite =>
  ({
    stationuuid: 'uuid-tokyo',
    name: 'Tokyo FM',
    url_resolved: 'https://stream.example.com/tokyo',
    url: 'https://stream.example.com/tokyo',
    homepage: '',
    favicon: '',
    country: 'Japan',
    state: 'Tokyo',
    tags: 'pop,jpop',
    bitrate: 128,
    stationArtwork: '',
    description: '',
    websiteUrl: '',
    scheduleNote: '',
    isClaimed: false,
    isVerified: false,
    promoted: false,
    ...over
  }) as StationLite;

describe('SearchResultRow render contract', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  const mount = (station: StationLite) => {
    act(() => {
      root = createRoot(container);
      root.render(
        createElement(
          LocaleProvider,
          null,
          createElement(SearchResultRow, {
            station,
            stations: [station],
            sourceId: 'search-results',
            nowPlayingEnabled: true
          })
        )
      );
    });
  };

  const setPlayback = (active: StationLite | null, isPlaying: boolean) => {
    ctx.playback.current = {
      player: { current: active, isPlaying, toggle: vi.fn() },
      playStation: vi.fn(),
      shareStation: vi.fn()
    };
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    ctx.track.current = null;
    setPlayback(null, false);
    ctx.library.current = {
      toggleFavorite: vi.fn(),
      isFavorite: () => false,
      playabilityProfile: undefined,
      stationHealthProfile: undefined
    };
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    container.remove();
    vi.clearAllMocks();
  });

  it('renders NOTHING for the track when none is known — no placeholder, no skeleton', () => {
    mount(makeStation());
    expect(container.querySelector('.search-card-track')).toBeNull();
    // Nothing anywhere in the row hints at a missing track.
    expect(container.textContent).not.toMatch(/недоступ|unavailable|—|\.\.\./i);
    // The genre line holds the slot instead.
    expect(container.querySelector('.search-card-tags')?.textContent).toContain('pop');
  });

  it('shows a known track and SUPERSEDES the genre line rather than adding a row', () => {
    ctx.track.current = 'Ryuichi Sakamoto - Merry Christmas Mr. Lawrence';
    mount(makeStation());
    expect(container.querySelector('.search-card-track')?.textContent).toContain(
      'Ryuichi Sakamoto'
    );
    // Constant row height: line 3 is ONE slot, so the tags line must be gone.
    expect(container.querySelector('.search-card-tags')).toBeNull();
  });

  it('renders the LIVE dot ONLY on the row that is audibly playing', () => {
    const station = makeStation();

    mount(station);
    expect(container.querySelector('.search-card-live')).toBeNull();

    act(() => root?.unmount());
    setPlayback(station, false); // selected but paused — not "live"
    mount(station);
    expect(container.querySelector('.search-card-live')).toBeNull();

    act(() => root?.unmount());
    setPlayback(station, true);
    mount(station);
    expect(container.querySelector('.search-card-live')).not.toBeNull();
  });

  it('omits bitrate entirely when it is 0 or absent', () => {
    mount(makeStation({ bitrate: 128 }));
    expect(container.querySelector('.search-card-bitrate')?.textContent).toBe('128 kbps');

    act(() => root?.unmount());
    mount(makeStation({ bitrate: 0 }));
    expect(container.querySelector('.search-card-bitrate')).toBeNull();

    act(() => root?.unmount());
    mount(makeStation({ bitrate: undefined }));
    expect(container.querySelector('.search-card-bitrate')).toBeNull();
  });

  it('omits the location line rather than printing an "unknown location" fallback', () => {
    mount(makeStation({ country: '', state: '' }));
    expect(container.querySelector('.search-card-meta')).toBeNull();
  });

  it('renders no listeners element at all', () => {
    // RadioAtlas has no listener data; votes/clickcount are not a listener
    // count and must never be relabelled as one.
    mount(makeStation());
    expect(container.querySelector('.search-card-listeners')).toBeNull();
    expect(container.textContent).not.toMatch(/слушател|listener/i);
  });

  it('keeps the load-bearing selectors and a visible play button', () => {
    mount(makeStation());
    const row = container.querySelector('.search-station-card');
    expect(row?.classList.contains('station-row')).toBe(true);
    expect(row?.hasAttribute('data-search-station-card')).toBe(true);
    // playHomeStation (23 call sites) needs a .play-btn inside .station-row.
    expect(row?.querySelector('.play-btn')).not.toBeNull();
    expect(row?.querySelector('.search-card-share')).not.toBeNull();
    expect(row?.querySelector('.search-station-card-primary-action')).not.toBeNull();
  });

  it('exposes exactly one accessible play control per row', () => {
    // The full-card overlay used to duplicate the play button's aria-label, so
    // every row announced "Играть: X" twice.
    mount(makeStation());
    const overlay = container.querySelector('.search-station-card-primary-action');
    expect(overlay?.getAttribute('aria-hidden')).toBe('true');
    expect(overlay?.getAttribute('tabindex')).toBe('-1');
    const named = Array.from(container.querySelectorAll('[aria-label]')).filter((node) =>
      /Tokyo FM$/.test(node.getAttribute('aria-label') || '')
    );
    expect(named).toHaveLength(1);
  });

  it('marks the favorite control with aria-pressed', () => {
    mount(makeStation());
    expect(container.querySelector('.search-card-fav')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('shares without starting playback', () => {
    const playStation = vi.fn();
    const toggle = vi.fn();
    ctx.playback.current = {
      player: { current: null, isPlaying: false, toggle },
      playStation,
      shareStation: vi.fn()
    };
    mount(makeStation());
    const share = container.querySelector('.search-card-share') as HTMLButtonElement;
    act(() => {
      share.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(playStation).not.toHaveBeenCalled();
    expect(toggle).not.toHaveBeenCalled();
  });
});
