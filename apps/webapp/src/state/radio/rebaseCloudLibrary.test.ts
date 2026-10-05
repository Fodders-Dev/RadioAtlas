import { describe, expect, it } from 'vitest';
import type { CloudLibrary, UserCollection } from '../../domain/contracts';
import type { StationLite } from '../../types';
import { rebaseCloudLibrary, type LocalCloudLibrary } from './rebaseCloudLibrary';
import { DEFAULT_TASTE_PROFILE_V2 } from '../../lib/tasteProfile';

const station = (stationuuid: string): StationLite => ({
  stationuuid,
  name: stationuuid.toUpperCase(),
  url_resolved: `https://${stationuuid}.example/stream`,
  homepage: '',
  favicon: '',
  country: '',
  state: '',
  tags: '',
  geo_lat: null,
  geo_long: null
});

const collection = (id: string, stationIds: string[] = [], patch: Partial<UserCollection> = {}): UserCollection => ({
  id,
  name: id,
  description: null,
  stationIds,
  isPublic: false,
  updatedAt: 1,
  createdAt: 1,
  pinned: false,
  ...patch
});

const library = (patch: Partial<LocalCloudLibrary> = {}): LocalCloudLibrary => ({
  favorites: [],
  recent: [],
  trackHistory: [],
  collections: [],
  followedStations: [],
  followedRegions: [],
  alerts: [],
  tasteProfile: null,
  ...patch
});

const cloud = (patch: Partial<LocalCloudLibrary> = {}): CloudLibrary => ({
  ...library(patch),
  updatedAt: 1
});

describe('rebaseCloudLibrary', () => {
  it('keeps independent additions inside the same collection', () => {
    const base = cloud({ collections: [collection('mix', ['a'])] });
    const local = library({ collections: [collection('mix', ['a', 'b'])] });
    const remote = cloud({ collections: [collection('mix', ['a', 'c'])] });

    expect(rebaseCloudLibrary(base, local, remote).collections[0]?.stationIds).toEqual(['a', 'b', 'c']);
  });

  it('applies a local collection removal and addition while preserving remote additions', () => {
    const base = cloud({ collections: [collection('mix', ['a'])] });
    const local = library({ collections: [collection('mix', ['b'])] });
    const remote = cloud({ collections: [collection('mix', ['a', 'c'])] });

    expect(rebaseCloudLibrary(base, local, remote).collections[0]?.stationIds).toEqual(['b', 'c']);
  });

  it('does not resurrect a base station removed remotely when local left it unchanged', () => {
    const base = cloud({ collections: [collection('mix', ['a', 'b'])] });
    const local = library({ collections: [collection('mix', ['a', 'b'])] });
    const remote = cloud({ collections: [collection('mix', ['b'])] });

    expect(rebaseCloudLibrary(base, local, remote).collections[0]?.stationIds).toEqual(['b']);
  });

  it('merges changed collection metadata field by field', () => {
    const base = cloud({
      collections: [collection('mix', [], { name: 'Old name', description: 'Old description', updatedAt: 3 })]
    });
    const local = library({
      collections: [collection('mix', [], { name: 'Local name', description: 'Old description', updatedAt: 8 })]
    });
    const remote = cloud({
      collections: [collection('mix', [], { name: 'Remote name', description: 'Remote description', updatedAt: 6 })]
    });

    expect(rebaseCloudLibrary(base, local, remote).collections[0]).toMatchObject({
      name: 'Local name',
      description: 'Remote description',
      updatedAt: 8
    });
  });

  it('keeps independently created playlists from both devices', () => {
    const base = cloud();
    const local = library({ collections: [collection('phone')] });
    const remote = cloud({ collections: [collection('desktop')] });

    expect(rebaseCloudLibrary(base, local, remote).collections.map((item) => item.id)).toEqual(['phone', 'desktop']);
  });

  it('combines a local favorite removal with a remote favorite addition', () => {
    const base = cloud({ favorites: [station('old')] });
    const local = library({ favorites: [] });
    const remote = cloud({ favorites: [station('old'), station('new')] });

    expect(rebaseCloudLibrary(base, local, remote).favorites.map((item) => item.stationuuid)).toEqual(['new']);
  });

  it('keys finds by station and case-insensitive track title without truncating them', () => {
    const first = { id: '1', stationId: 'station', stationName: 'Radio', track: 'Song', timestamp: 1 };
    const duplicate = { ...first, id: 'remote-copy', track: 'song', timestamp: 2 };
    const more = Array.from({ length: 210 }, (_, index) => ({
      id: `find-${index}`,
      stationId: 'station',
      stationName: 'Radio',
      track: `Track ${index}`,
      timestamp: 10 + index
    }));
    const base = cloud({ trackHistory: [first] });
    const local = library({ trackHistory: [first, ...more] });
    const remote = cloud({ trackHistory: [duplicate] });
    const result = rebaseCloudLibrary(base, local, remote).trackHistory;

    expect(result).toHaveLength(211);
    expect(result.filter((item) => item.stationId === 'station' && item.track.toLowerCase() === 'song')).toHaveLength(1);
  });

  it('does not double local taste scores when accepting its own acknowledged save', () => {
    const profile = { ...DEFAULT_TASTE_PROFILE_V2, stationScores: { a: 12 }, lastUpdatedAt: 2 };
    const base = cloud({ tasteProfile: { ...profile, stationScores: { a: 10 }, lastUpdatedAt: 1 } });
    const local = library({ tasteProfile: profile });
    expect(rebaseCloudLibrary(base, local, cloud(local)).tasteProfile).toEqual(profile);
    expect(rebaseCloudLibrary(base, local, base).tasteProfile).toEqual(profile);
  });

  it('adds only the local taste delta to independently updated remote scores', () => {
    const profile = { ...DEFAULT_TASTE_PROFILE_V2, stationScores: { a: 10 }, lastUpdatedAt: 1 };
    const base = cloud({ tasteProfile: profile });
    const local = library({ tasteProfile: { ...profile, stationScores: { a: 12 }, lastUpdatedAt: 2 } });
    const remote = cloud({ tasteProfile: { ...profile, stationScores: { a: 13 }, lastUpdatedAt: 3 } });
    const rebased = rebaseCloudLibrary(base, local, remote);
    expect(rebased.tasteProfile?.stationScores).toEqual({ a: 15 });
    expect(rebaseCloudLibrary(remote, rebased, cloud(rebased)).tasteProfile).toEqual(rebased.tasteProfile);
  });

  it('retains the existing twenty-item recent limit', () => {
    const recent = Array.from({ length: 25 }, (_, index) => station(`recent-${index}`));
    const base = cloud();
    const local = library({ recent });

    expect(rebaseCloudLibrary(base, local, base).recent).toHaveLength(20);
  });

  it('returns the same values when there are no local changes', () => {
    const base = cloud({ favorites: [station('a')], collections: [collection('mix', ['a'])] });
    const local = library({ favorites: [station('a')], collections: [collection('mix', ['a'])] });

    expect(rebaseCloudLibrary(base, local, base)).toEqual(local);
  });

  it('preserves local collection order and appends remote-only additions', () => {
    const base = cloud({ collections: [collection('mix', ['a', 'b'])] });
    const local = library({ collections: [collection('mix', ['b', 'a'])] });
    const remote = cloud({ collections: [collection('mix', ['a', 'b', 'c'])] });

    expect(rebaseCloudLibrary(base, local, remote).collections[0]?.stationIds).toEqual(['b', 'a', 'c']);
  });

  it('uses remote ordering when local did not reorder base entries', () => {
    const base = cloud({ favorites: [station('a'), station('b')] });
    const local = library({ favorites: [station('a'), station('b')] });
    const remote = cloud({ favorites: [station('b'), station('a'), station('c')] });

    expect(rebaseCloudLibrary(base, local, remote).favorites.map((item) => item.stationuuid)).toEqual([
      'b',
      'a',
      'c'
    ]);
  });

  it('applies removals to other keyed library arrays and keeps remote-only entries', () => {
    const base = cloud({ followedRegions: [{ id: 'north', label: 'North', scope: 'country', createdAt: 1, pinned: false }] });
    const local = library({ followedRegions: [] });
    const remote = cloud({
      followedRegions: [
        { id: 'north', label: 'North', scope: 'country', createdAt: 1, pinned: false },
        { id: 'south', label: 'South', scope: 'country', createdAt: 2, pinned: false }
      ]
    });

    expect(rebaseCloudLibrary(base, local, remote).followedRegions.map((item) => item.id)).toEqual(['south']);
  });
});
