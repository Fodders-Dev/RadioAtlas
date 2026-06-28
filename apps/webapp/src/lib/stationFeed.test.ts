import { describe, expect, it } from 'vitest';
import { buildStationFeed } from './stationFeed';
import type { StationLite } from '../types';

const station = (id: string, extra: Partial<StationLite> = {}): StationLite =>
  ({
    stationuuid: id,
    name: `Station ${id}`,
    url_resolved: `https://stream/${id}`,
    favicon: '',
    tags: '',
    country: '',
    countrycode: '',
    state: '',
    ...extra
  }) as StationLite;

const ids = (stations: StationLite[]) => stations.map((s) => s.stationuuid);

const range = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => station(`${prefix}${i}`));

describe('buildStationFeed', () => {
  it('deduplicates a station that appears in multiple sources (taste wins)', () => {
    const shared = station('shared');
    const feed = buildStationFeed({
      tasteStations: [shared, station('t1')],
      trending: [shared, station('r1')],
      pool: [shared, station('p1')],
      seed: 7
    });
    expect(ids(feed).filter((id) => id === 'shared')).toHaveLength(1);
    // every id is unique
    expect(new Set(ids(feed)).size).toBe(feed.length);
  });

  it('drops stations without a playable url', () => {
    const feed = buildStationFeed({
      tasteStations: [station('ok'), station('dead', { url_resolved: '' })],
      trending: [],
      pool: [],
      seed: 1
    });
    expect(ids(feed)).toEqual(['ok']);
  });

  it('mixes the sources rather than concatenating them', () => {
    const feed = buildStationFeed({
      tasteStations: range('t', 6),
      trending: range('r', 6),
      pool: [],
      seed: 42
    });
    // A pure concat would be all t* then all r*. The weighted interleave must
    // thread trending into the taste-led head (both sources present up top).
    const head = ids(feed).slice(0, 6);
    expect(head.some((id) => id.startsWith('t'))).toBe(true);
    expect(head.some((id) => id.startsWith('r'))).toBe(true);
    // Taste is the highest-weight source → it dominates the overall feed.
    expect(ids(feed).filter((id) => id.startsWith('t'))).toHaveLength(6);
  });

  it('keeps random discovery rare (bounded by randomRatio)', () => {
    const feed = buildStationFeed({
      tasteStations: range('t', 30),
      trending: range('r', 30),
      pool: range('p', 200),
      seed: 5,
      limit: 40,
      randomRatio: 0.18
    });
    const randomCount = ids(feed).filter((id) => id.startsWith('p')).length;
    // ceil-ish of 40*0.18 ≈ 7; never floods the feed with random.
    expect(randomCount).toBeLessThanOrEqual(8);
    expect(feed.length).toBeLessThanOrEqual(40);
  });

  it('is deterministic for a fixed seed and reshuffles when the seed changes', () => {
    const withPool = {
      tasteStations: range('t', 8),
      trending: range('r', 8),
      pool: range('p', 30)
    };
    const a = ids(buildStationFeed({ ...withPool, seed: 100 }));
    const b = ids(buildStationFeed({ ...withPool, seed: 100 }));
    const c = ids(buildStationFeed({ ...withPool, seed: 999 }));
    expect(a).toEqual(b); // same seed → byte-identical
    expect(a).not.toEqual(c); // different seed → reshuffled (and different random picks)

    // With no random pool the membership is fixed, so a seed change permutes the
    // SAME stations rather than swapping any in.
    const noPool = { tasteStations: range('t', 8), trending: range('r', 8), pool: [] };
    const d = ids(buildStationFeed({ ...noPool, seed: 100 }));
    const e = ids(buildStationFeed({ ...noPool, seed: 999 }));
    expect(d).not.toEqual(e);
    expect([...d].sort()).toEqual([...e].sort());
  });

  it('handles empty sources without throwing', () => {
    expect(buildStationFeed({ tasteStations: [], trending: [], pool: [], seed: 1 })).toEqual([]);
    const tasteOnly = buildStationFeed({
      tasteStations: range('t', 3),
      trending: [],
      pool: [],
      seed: 1
    });
    expect(ids(tasteOnly).every((id) => id.startsWith('t'))).toBe(true);
    expect(tasteOnly).toHaveLength(3);
  });
});
