import { describe, it, expect } from 'vitest';
import { createDiscoveryFeed } from './discoveryFeed';
import type { StationLite } from '../types';

// T2.21: createDiscoveryFeed wraps the server-ranked Trending / Top voted /
// Around the world pools into rail modules, and hides them when absent. The
// ranking itself is server-side (covered by apps/api catalog.summary.test).

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

const baseInput = {
  catalog: Array.from({ length: 8 }, (_, i) => mk(`cat-${i}`)),
  favorites: [],
  recent: [],
  queuePreview: [],
  followedStations: [],
  collections: [],
  showcaseSeed: 1,
  query: '',
  metrics: { countries: 1, languages: 1, genres: 1 }
};

describe('createDiscoveryFeed server-signal rails (T2.21)', () => {
  it('wraps the provided pools into Trending / Top voted / Around the world modules', () => {
    const trending = [mk('t1'), mk('t2'), mk('t3')];
    const topVoted = [mk('v1'), mk('v2')];
    const aroundTheWorld = { label: 'Japan', stations: [mk('jp1', 'Japan'), mk('jp2', 'Japan')] };

    const feed = createDiscoveryFeed({ ...baseInput, trending, topVoted, aroundTheWorld });

    expect(feed.trending?.kind).toBe('trending');
    expect(feed.trending?.stations.map((s) => s.stationuuid)).toEqual(['t1', 't2', 't3']);
    expect(feed.topVoted?.kind).toBe('top-voted');
    expect(feed.topVoted?.stations).toHaveLength(2);
    expect(feed.aroundTheWorld?.kind).toBe('around-the-world');
    // The rotating country is surfaced as the rail label.
    expect(feed.aroundTheWorld?.label).toBe('Japan');
  });

  it('hides each rail when its pool is missing or empty', () => {
    const feed = createDiscoveryFeed({
      ...baseInput,
      trending: [],
      topVoted: undefined,
      aroundTheWorld: null
    });

    expect(feed.trending).toBeNull();
    expect(feed.topVoted).toBeNull();
    expect(feed.aroundTheWorld).toBeNull();
  });

  it('wraps server mood shelves into modules keyed by rail id, skipping empty/unknown', () => {
    const feed = createDiscoveryFeed({
      ...baseInput,
      moodRails: [
        { id: 'mood-late-night', stations: [mk('ln1'), mk('ln2')] },
        { id: 'mood-driving', stations: [mk('dr1')] },
        { id: 'mood-empty', stations: [] }, // empty → dropped
        { id: 'mood-unknown-xyz', stations: [mk('u1')] } // no locale config → dropped
      ]
    });

    expect(feed.moodRails.map((m) => m.sourceId)).toEqual(['mood-late-night', 'mood-driving']);
    expect(feed.moodRails.every((m) => m.kind === 'mood')).toBe(true);
    expect(feed.moodRails[0]?.titleKey).toBe('home.moodLateNightTitle');
  });

  it('returns an empty moodRails array when none are provided', () => {
    expect(createDiscoveryFeed(baseInput).moodRails).toEqual([]);
  });

  it('rotates discovery picks when the showcase seed changes', () => {
    const first = createDiscoveryFeed({ ...baseInput, showcaseSeed: 11 });
    const second = createDiscoveryFeed({ ...baseInput, showcaseSeed: 97 });

    expect(first.freshSignals.stations.map((station) => station.stationuuid)).not.toEqual(
      second.freshSignals.stations.map((station) => station.stationuuid)
    );
  });
});
