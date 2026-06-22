import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { StationLite } from '../types';

// React's act() needs this flag, otherwise it warns under vitest's jsdom env.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// T2.20 drops decorations from the desktop (non-dense) Home; pin the layout to
// desktop so the hero + its (removed) metrics row are the ones under test.
vi.mock('../lib/useCompactLayout', () => ({ useCompactLayout: () => false }));

// Phase B-PR2: HomeStationTile reads the playability/health profiles via
// useLibrary to compute its status badge. These tiles render outside a
// RadioProvider here, so stub the hook with empty profiles (no signals →
// badge 'none' → nothing rendered, so the tile-count/click tests are unchanged).
vi.mock('../state/RadioContext', () => ({
  useLibrary: () => ({ playabilityProfile: null, stationHealthProfile: null })
}));

import { HomeHeroCard, HomeRail } from './homeCards';
import { LocaleProvider } from '../state/LocaleContext';
import { ruDictionary } from '../state/locales/ru';
import { enDictionary } from '../state/locales/en';
import type { HomeHeroModule, HomeRailModule } from '../lib/homeSurface';

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

const heroModule = (station: StationLite | null): HomeHeroModule => ({
  titleKey: 'home.heroEyebrow',
  copyKey: 'home.heroDescription',
  sourceId: 'src-hero',
  accent: 'primary',
  label: null,
  station,
  companionStations: [],
  querySuggestion: ''
});

const railModule = (stations: StationLite[]): HomeRailModule => ({
  id: 'rail-1',
  titleKey: 'home.railTitle',
  copyKey: 'home.railCopy',
  sourceId: 'src-rail',
  accent: 'primary',
  label: null,
  stations
});

describe('Home cards density (T2.20)', () => {
  let container: HTMLDivElement;
  let root: Root;

  const mount = (node: ReactNode) =>
    act(() => root.render(createElement(LocaleProvider, { children: node })));

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('HomeHeroCard no longer renders the СТРАН/ЯЗЫКОВ/ЖАНРОВ metrics row', () => {
    mount(
      createElement(HomeHeroCard, {
        module: heroModule(makeStation(1)),
        isActive: false,
        activeTrack: null,
        liked: false,
        refreshing: false,
        onPlay: vi.fn(),
        onToggleFavorite: vi.fn(),
        onExplore: vi.fn(),
        onRefresh: vi.fn()
      })
    );

    // The card still renders (structure preserved)...
    expect(container.querySelector('.home-hero-card')).not.toBeNull();
    // ...but the decorative catalogue-stats pills are gone.
    expect(container.querySelector('.home-hero-metrics')).toBeNull();
    expect(container.querySelector('.home-metric-pill')).toBeNull();
  });

  it('HomeRail renders one data-home-station tile per station', () => {
    const stations = [1, 2, 3, 4, 5].map(makeStation);
    mount(
      createElement(HomeRail, {
        module: railModule(stations),
        currentStationId: null,
        activeTrack: null,
        isFavorite: () => false,
        onPlay: vi.fn(),
        onToggleFavorite: vi.fn(),
        onExplore: vi.fn()
      })
    );

    // The e2e density gate counts [data-home-station]; lock the contract that
    // every rail station emits exactly one such tile.
    expect(container.querySelectorAll('[data-home-station]')).toHaveLength(stations.length);
  });

  it('T_mobile_1 B: a click anywhere on the tile triggers onPlay, the heart only toggles favourite', () => {
    const stations = [1, 2, 3].map(makeStation);
    const onPlay = vi.fn();
    const onToggleFavorite = vi.fn();
    mount(
      createElement(HomeRail, {
        module: railModule(stations),
        currentStationId: null,
        activeTrack: null,
        isFavorite: () => false,
        onPlay,
        onToggleFavorite,
        onExplore: vi.fn()
      })
    );

    const tiles = container.querySelectorAll<HTMLElement>('[data-home-station]');
    expect(tiles.length).toBe(3);

    // Click the tile root (not the inner buttons) → onPlay once with this station.
    act(() => tiles[0]!.click());
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay.mock.calls[0]?.[0]?.stationuuid).toBe('uuid-1');
    expect(onToggleFavorite).not.toHaveBeenCalled();

    // Click the heart inside the next tile — favourite toggles, play does NOT fire
    // (the like button stopPropagation prevents the tile-level onPlay from firing).
    const heart = tiles[1]!.querySelector<HTMLButtonElement>('.home-action-btn-like');
    expect(heart).not.toBeNull();
    act(() => heart!.click());
    expect(onToggleFavorite).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledTimes(1); // still 1 — no double-fire from the heart

    // Click the visible play icon inside the third tile — onPlay called once
    // (not twice — stopPropagation prevents the article handler from re-firing).
    const playBtn = tiles[2]!.querySelector<HTMLButtonElement>('.home-action-btn-play');
    expect(playBtn).not.toBeNull();
    act(() => playBtn!.click());
    expect(onPlay).toHaveBeenCalledTimes(2);
    expect(onPlay.mock.calls[1]?.[0]?.stationuuid).toBe('uuid-3');
  });

  it('T_mobile_1 B: tile root is keyboard-actionable (role=button, tabIndex=0, aria-label)', () => {
    const stations = [1].map(makeStation);
    mount(
      createElement(HomeRail, {
        module: railModule(stations),
        currentStationId: null,
        activeTrack: null,
        isFavorite: () => false,
        onPlay: vi.fn(),
        onToggleFavorite: vi.fn(),
        onExplore: vi.fn()
      })
    );
    const tile = container.querySelector<HTMLElement>('[data-home-station]')!;
    expect(tile.getAttribute('role')).toBe('button');
    expect(tile.getAttribute('tabindex')).toBe('0');
    // aria-label carries the station name (locale fallback to key in jsdom is OK,
    // the important contract is "the name is in the accessible name").
    const ariaLabel = tile.getAttribute('aria-label') || '';
    expect(ariaLabel).toContain('Station 1');
  });

  it('T_audit_3 F1: spotlight titles carry no {placeholder} (HomeRail renders t() without vars)', () => {
    // HomeRail renders t(module.titleKey) with no interpolation vars, so any
    // {country}/{genre} in these locale values would leak literally. The value
    // is surfaced via the label chip instead, so the titles must be placeholder-
    // free in BOTH locales.
    for (const dict of [ruDictionary, enDictionary]) {
      expect(dict.home.countrySpotlightTitle).not.toMatch(/[{}]/);
      expect(dict.home.genreSpotlightTitle).not.toMatch(/[{}]/);
    }
    // The dropped-placeholder values are the bare section nouns.
    expect(ruDictionary.home.countrySpotlightTitle).toBe('Фокус');
    expect(ruDictionary.home.genreSpotlightTitle).toBe('Жанровый радар');
  });
});
