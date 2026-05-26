import { describe, it, expect } from 'vitest';
import { createDiscoveryFeed } from './discoveryFeed';
import { createHomeSurfaceFeed } from './homeSurface';
import type { StationLite } from '../types';
import type { CatalogMoodRail } from '../domain/contracts';

// T2.22: mood shelves are pushed into the home surface in fixed display order,
// after Top voted and before Around the world, and respect the cross-rail
// blockedStationIds set (a station already shown earlier never repeats).

const mk = (id: string, country = 'Atlantis'): StationLite => ({
  stationuuid: id,
  name: id,
  url_resolved: `https://stream/${id}`,
  homepage: '',
  favicon: '',
  country,
  state: '',
  tags: 'pop',
  geo_lat: null,
  geo_long: null,
  stationArtwork: null,
  isClaimed: false,
  isVerified: false,
  promoted: false,
  description: null,
  websiteUrl: null,
  scheduleNote: null
});

const baseFeedInput = {
  favorites: [],
  recent: [],
  queuePreview: [],
  followedStations: [],
  collections: [],
  showcaseSeed: 1,
  query: '',
  metrics: { countries: 1, languages: 1, genres: 1 }
};

const moods = (rails: CatalogMoodRail[]) => rails;

describe('createHomeSurfaceFeed mood rails (T2.22)', () => {
  it('places mood shelves in fixed display order, after fresh-now', () => {
    const feed = createDiscoveryFeed({
      ...baseFeedInput,
      catalog: Array.from({ length: 10 }, (_, i) => mk(`cat-${i}`)),
      moodRails: moods([
        { id: 'mood-late-night', stations: Array.from({ length: 6 }, (_, i) => mk(`ln-${i}`)) },
        { id: 'mood-driving', stations: Array.from({ length: 6 }, (_, i) => mk(`dr-${i}`)) }
      ])
    });

    const ids = createHomeSurfaceFeed({ discoveryFeed: feed, seed: 1 }).rails.map((rail) => rail.id);

    expect(ids).toContain('mood-late-night');
    expect(ids).toContain('mood-driving');
    // Server-provided display order is preserved...
    expect(ids.indexOf('mood-late-night')).toBeLessThan(ids.indexOf('mood-driving'));
    // ...and the personalised fresh-now shelf still leads.
    expect(ids.indexOf('fresh-now')).toBeLessThan(ids.indexOf('mood-late-night'));
  });

  it('de-dupes a mood station already reserved by an earlier shelf', () => {
    const shared = mk('shared');
    const feed = createDiscoveryFeed({
      ...baseFeedInput,
      catalog: [shared, ...Array.from({ length: 9 }, (_, i) => mk(`c-${i}`))],
      moodRails: moods([
        { id: 'mood-driving', stations: [shared, ...Array.from({ length: 6 }, (_, i) => mk(`m-${i}`))] }
      ])
    });

    const surface = createHomeSurfaceFeed({ discoveryFeed: feed, seed: 1 });
    const driving = surface.rails.find((rail) => rail.id === 'mood-driving');

    expect(driving).toBeTruthy();
    // `shared` is reserved by the hero / fresh-now shelf, so it must not reappear.
    expect(driving?.stations.some((s) => s.stationuuid === 'shared')).toBe(false);
  });
});
