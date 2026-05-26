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

import { HomeHeroCard, HomeRail } from './homeCards';
import { LocaleProvider } from '../state/LocaleContext';
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
});
