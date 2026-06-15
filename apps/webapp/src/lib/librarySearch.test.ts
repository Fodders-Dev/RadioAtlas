import { describe, expect, it } from 'vitest';
import { buildLibrarySearchEntries, filterLibraryEntries } from './librarySearch';
import type { StationLite } from '../types';
import type { FollowedStation, UserCollection } from '../domain/contracts';

const station = (id: string, extra: Partial<StationLite> = {}): StationLite =>
  ({
    stationuuid: id,
    name: id,
    url_resolved: `https://example/${id}`,
    country: '',
    tags: '',
    ...extra
  } as StationLite);

const collection = (id: string, name: string, stationIds: string[]): UserCollection => ({
  id,
  name,
  description: null,
  stationIds,
  isPublic: false,
  updatedAt: 0,
  createdAt: 0,
  pinned: false
});

const followed = (stationId: string): FollowedStation => ({
  stationId,
  stationName: stationId,
  country: '',
  createdAt: 0,
  pinned: false,
  alerts: []
});

const mapOf = (...stations: StationLite[]) =>
  new Map(stations.map((item) => [item.stationuuid, item]));

describe('buildLibrarySearchEntries', () => {
  it('unions favorites + recent + collections + follows, deduped by stationuuid', () => {
    const fav = station('a');
    const rec = station('b');
    const coll = station('c');
    const fol = station('d');
    const entries = buildLibrarySearchEntries({
      favorites: [fav],
      recent: [rec],
      collections: [collection('col1', 'Jazz', ['c'])],
      followedStations: [followed('d')],
      stationMap: mapOf(fav, rec, coll, fol)
    });
    expect(entries.map((e) => e.station.stationuuid).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('applies dedup priority favorite > collection > recent > followed', () => {
    const s = station('x');
    const entries = buildLibrarySearchEntries({
      favorites: [s],
      recent: [s],
      collections: [collection('col1', 'Jazz', ['x'])],
      followedStations: [followed('x')],
      stationMap: mapOf(s)
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].source).toEqual({ kind: 'favorite' });
  });

  it('labels a collection-only station with the collection name', () => {
    const s = station('x');
    const entries = buildLibrarySearchEntries({
      favorites: [],
      recent: [],
      collections: [collection('col1', 'Late Night', ['x'])],
      followedStations: [],
      stationMap: mapOf(s)
    });
    expect(entries[0].source).toEqual({ kind: 'collection', name: 'Late Night' });
  });

  it('skips collection/follow ids that do not resolve to a cached station', () => {
    const entries = buildLibrarySearchEntries({
      favorites: [],
      recent: [],
      collections: [collection('col1', 'Jazz', ['missing'])],
      followedStations: [followed('also-missing')],
      stationMap: mapOf()
    });
    expect(entries).toEqual([]);
  });
});

describe('filterLibraryEntries', () => {
  const entries = buildLibrarySearchEntries({
    favorites: [
      station('a', { name: 'Tokyo Jazz', country: 'Japan', tags: 'jazz,smooth' }),
      station('b', { name: 'Berlin Techno', country: 'Germany', tags: 'techno' })
    ],
    recent: [],
    collections: [],
    followedStations: [],
    stationMap: new Map()
  });

  it('returns the full set unchanged for an empty query', () => {
    expect(filterLibraryEntries(entries, '   ')).toHaveLength(2);
  });

  it('matches case-insensitively on the station name', () => {
    const out = filterLibraryEntries(entries, 'tokyo');
    expect(out.map((e) => e.station.stationuuid)).toEqual(['a']);
  });

  it('matches on country and on tags', () => {
    expect(filterLibraryEntries(entries, 'germany').map((e) => e.station.stationuuid)).toEqual([
      'b'
    ]);
    expect(filterLibraryEntries(entries, 'jazz').map((e) => e.station.stationuuid)).toEqual(['a']);
  });

  it('returns nothing when the library has no match', () => {
    expect(filterLibraryEntries(entries, 'salsa')).toEqual([]);
  });
});
