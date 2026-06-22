import { describe, expect, it } from 'vitest';
import { resolveCachedStation, shouldCacheStationLookup } from './stationCachePolicy';
import type { StationLite } from '../types';

const station = (id = 'uuid-1'): StationLite =>
  ({ stationuuid: id, name: id, url_resolved: `https://stream/${id}` } as StationLite);

describe('shouldCacheStationLookup — never cache a null lookup', () => {
  it('does NOT cache a null (transient 5xx / radio-browser miss → no 24h poison)', () => {
    expect(shouldCacheStationLookup(null)).toBe(false);
  });

  it('caches a real resolved station', () => {
    expect(shouldCacheStationLookup(station())).toBe(true);
  });
});

describe('resolveCachedStation — self-heal a poisoned null entry', () => {
  it('returns null (a MISS → re-request) for a cached entry whose payload is null', () => {
    expect(resolveCachedStation({ payload: null })).toBeNull();
  });

  it('returns null for no cache entry', () => {
    expect(resolveCachedStation(null)).toBeNull();
    expect(resolveCachedStation(undefined)).toBeNull();
  });

  it('returns the station for a real cached hit', () => {
    const s = station('uuid-hit');
    expect(resolveCachedStation({ payload: s })).toBe(s);
  });
});
