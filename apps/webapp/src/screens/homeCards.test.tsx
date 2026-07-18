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

  it('reference hero exposes one semantic play action without polluting rail tile counts', () => {
    const station = makeStation(7);
    const onPlay = vi.fn();
    const onToggleFavorite = vi.fn();
    mount(
      createElement(HomeHeroCard, {
        module: heroModule(station),
        isActive: false,
        activeTrack: null,
        liked: false,
        refreshing: false,
        onPlay,
        onToggleFavorite,
        onExplore: vi.fn(),
        onRefresh: vi.fn()
      })
    );

    const hero = container.querySelector<HTMLElement>('[data-home-hero="uuid-7"]');
    expect(hero).not.toBeNull();
    expect(hero!.querySelectorAll('.home-hero-play')).toHaveLength(1);
    expect(hero!.querySelectorAll('[data-home-station]')).toHaveLength(0);

    act(() => hero!.querySelector<HTMLButtonElement>('.home-hero-play')!.click());
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay.mock.calls[0]?.[0]?.stationuuid).toBe('uuid-7');

    act(() => hero!.querySelector<HTMLButtonElement>('.home-icon-btn')!.click());
    expect(onToggleFavorite).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledTimes(1);
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

  it('T_mobile_1 B: the full-tile primary action plays, while the heart only toggles favourite', () => {
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

    // The generous tile-sized hit area is a real sibling button, avoiding
    // nested controls while still making the visual card the play target.
    const primaryAction = tiles[0]!.querySelector<HTMLButtonElement>(
      '.home-station-primary-action'
    );
    expect(primaryAction).not.toBeNull();
    act(() => primaryAction!.click());
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay.mock.calls[0]?.[0]?.stationuuid).toBe('uuid-1');
    expect(onToggleFavorite).not.toHaveBeenCalled();

    // Cards no longer render a favourite heart — reference cards show only play
    // (the favourite lives on the hero, not on every tile).
    const heart = tiles[1]!.querySelector<HTMLButtonElement>('.home-action-btn-like');
    expect(heart).toBeNull();
    expect(onToggleFavorite).not.toHaveBeenCalled();
    expect(onPlay).toHaveBeenCalledTimes(1);

    // The visible play glyph is decorative: the tile has one play control,
    // while Favorite remains the only independent sibling action.
    const playGlyph = tiles[2]!.querySelector<HTMLElement>('.home-action-btn-play');
    const thirdPrimaryAction = tiles[2]!.querySelector<HTMLButtonElement>(
      '.home-station-primary-action'
    );
    expect(playGlyph?.tagName).toBe('SPAN');
    expect(playGlyph?.getAttribute('aria-hidden')).toBe('true');
    expect(thirdPrimaryAction).not.toBeNull();
    act(() => thirdPrimaryAction!.click());
    expect(onPlay).toHaveBeenCalledTimes(2);
    expect(onPlay.mock.calls[1]?.[0]?.stationuuid).toBe('uuid-3');
  });

  it('T_mobile_1 B: the tile play target uses native button semantics and an accessible name', () => {
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
    const primaryAction = tile.querySelector<HTMLButtonElement>('.home-station-primary-action')!;
    expect(tile.tagName).toBe('ARTICLE');
    expect(tile.getAttribute('role')).toBeNull();
    expect(primaryAction.tagName).toBe('BUTTON');
    expect(primaryAction.type).toBe('button');
    expect(primaryAction.tabIndex).toBe(0);
    // aria-label carries the station name (locale fallback to key in jsdom is OK,
    // the important contract is "the name is in the accessible name").
    const ariaLabel = primaryAction.getAttribute('aria-label') || '';
    expect(ariaLabel).toContain('Station 1');
  });

  // ---------------------------------------------------------------------
  // Owner ask #1: the hero shows the station that is ON AIR, and says so.
  // ---------------------------------------------------------------------
  const mountHero = (props: Record<string, unknown>) =>
    mount(
      createElement(HomeHeroCard, {
        module: heroModule(makeStation(3)),
        isActive: false,
        activeTrack: null,
        liked: false,
        refreshing: false,
        onPlay: vi.fn(),
        onToggleFavorite: vi.fn(),
        onExplore: vi.fn(),
        onRefresh: vi.fn(),
        ...props
      })
    );

  it('hero kicker reads «Рекомендуем» when idle and «Сейчас играет» when a station is on air', () => {
    mountHero({ nowPlaying: false });
    expect(container.querySelector('.home-surface-kicker')?.textContent).toBe(
      ruDictionary.home.heroKicker
    );

    mountHero({ nowPlaying: true, onAir: true, isActive: true });
    expect(container.querySelector('.home-surface-kicker')?.textContent).toBe(
      ruDictionary.home.heroKickerNowPlaying
    );
  });

  it('a PAUSED station keeps the hero but stops claiming it is playing', () => {
    // `player.current` outlives pause and failure, so gating the kicker on
    // presence alone made a paused (or dead) stream read «Сейчас играет» under a
    // pulsing LIVE badge. The hero must still SHOW the station — flipping back
    // to a recommendation on every pause would be worse — but it has to say so.
    mountHero({ nowPlaying: true, onAir: false, isActive: true });
    expect(container.querySelector('.home-surface-kicker')?.textContent).toBe(
      ruDictionary.home.heroKickerPaused
    );
    expect(container.querySelector('.home-hero-live-dot')).toBeNull();
    // Identity is unchanged: still the on-air station, still 'now-playing' mode.
    const hero = container.querySelector<HTMLElement>('[data-home-hero]');
    expect(hero?.getAttribute('data-home-hero-mode')).toBe('now-playing');
    expect(hero?.getAttribute('data-home-hero-air')).toBe('paused');
  });

  it('the LIVE dot only claims LIVE when something is actually on air', () => {
    mountHero({ nowPlaying: false });
    expect(container.querySelector('.home-hero-live-dot')).toBeNull();

    mountHero({ nowPlaying: true, onAir: true, isActive: true });
    expect(container.querySelector('.home-hero-live-dot')).not.toBeNull();
  });

  it('exposes the render MODE and the frozen recommendation id as data attributes', () => {
    // visual.spec.ts asserts on these: the RENDERED hero legitimately follows
    // playback, but the recommendation deck must not advance under the user's
    // finger, so the frozen id has to stay observable while it is overridden.
    mountHero({ nowPlaying: true, onAir: true, isActive: true, recommendedStationId: 'uuid-frozen' });
    const hero = container.querySelector<HTMLElement>('[data-home-hero="uuid-3"]');
    expect(hero?.getAttribute('data-home-hero-mode')).toBe('now-playing');
    expect(hero?.getAttribute('data-home-hero-recommended')).toBe('uuid-frozen');

    mountHero({ nowPlaying: false, recommendedStationId: 'uuid-3' });
    expect(
      container.querySelector('[data-home-hero]')?.getAttribute('data-home-hero-mode')
    ).toBe('recommendation');
  });

  it('ships the now-playing kicker in BOTH dictionaries (a missing key renders raw)', () => {
    // The dictionary is a loose DictionaryTree: a key present in ru but missing
    // in en renders the literal "home.heroKickerNowPlaying" with no typecheck
    // error and no other failing test. This is that guard.
    for (const dict of [ruDictionary, enDictionary]) {
      expect(typeof dict.home.heroKickerNowPlaying).toBe('string');
      expect(dict.home.heroKickerNowPlaying).not.toMatch(/[{}]/);
      expect((dict.home.heroKickerNowPlaying as string).length).toBeGreaterThan(0);
    }
    expect(ruDictionary.home.heroKickerNowPlaying).toBe('Сейчас играет');
    expect(enDictionary.home.heroKickerNowPlaying).toBe('Now playing');
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
