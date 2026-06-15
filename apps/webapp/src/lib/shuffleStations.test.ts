import { describe, expect, it } from 'vitest';
import { reshuffleQueueSnapshot, shuffleStations } from './shuffleStations';
import type { StationLite } from '../types';
import type { QueueSnapshot } from '../state/radio/types';

const station = (id: string): StationLite =>
  ({ stationuuid: id, name: id, url_resolved: `https://example/${id}` } as StationLite);

const ids = (items: StationLite[]) => items.map((item) => item.stationuuid);

const snapshot = (overrides: Partial<QueueSnapshot> = {}): QueueSnapshot => ({
  items: ['a', 'b', 'c', 'd', 'e'].map(station),
  currentIndex: 0,
  sourceId: 'seeded-home',
  sourceLabel: 'Seeded Home',
  ...overrides
});

// A deterministic "shuffle" that reverses — enough to prove the pin/reinsert
// math without depending on the seeded PRNG.
const reverse = (items: StationLite[]) => [...items].reverse();

describe('shuffleStations', () => {
  it('is a permutation — same members, no loss/duplication', () => {
    const input = ['a', 'b', 'c', 'd', 'e', 'f'].map(station);
    const out = shuffleStations(input, 12345);
    expect(ids(out).sort()).toEqual(ids(input).sort());
    expect(out).toHaveLength(input.length);
  });

  it('does not mutate the input array', () => {
    const input = ['a', 'b', 'c'].map(station);
    const before = ids(input);
    shuffleStations(input, 999);
    expect(ids(input)).toEqual(before);
  });

  it('is deterministic for a fixed seed', () => {
    const input = ['a', 'b', 'c', 'd'].map(station);
    expect(ids(shuffleStations(input, 42))).toEqual(ids(shuffleStations(input, 42)));
  });
});

describe('reshuffleQueueSnapshot (never-auto-switch invariants)', () => {
  it('keeps items[currentIndex].stationuuid pinned at the same index', () => {
    const snap = snapshot({ currentIndex: 2 });
    const playing = snap.items[snap.currentIndex].stationuuid;
    const next = reshuffleQueueSnapshot(snap, reverse);
    // (a) the playing station is at the SAME index and unchanged.
    expect(next.currentIndex).toBe(2);
    expect(next.items[next.currentIndex].stationuuid).toBe(playing);
  });

  it('reorders the OTHER items (the queue actually changed)', () => {
    const snap = snapshot({ currentIndex: 0 });
    const next = reshuffleQueueSnapshot(snap, reverse);
    // currentIndex 0 pinned; the rest [b,c,d,e] reversed -> [e,d,c,b].
    expect(ids(next.items)).toEqual(['a', 'e', 'd', 'c', 'b']);
  });

  it('carries sourceId + sourceLabel through untouched', () => {
    const snap = snapshot({ currentIndex: 1, sourceId: 'collection-7', sourceLabel: 'Jazz' });
    const next = reshuffleQueueSnapshot(snap, reverse);
    // (c) source identity preserved.
    expect(next.sourceId).toBe('collection-7');
    expect(next.sourceLabel).toBe('Jazz');
  });

  it('preserves the full member set (no station added or dropped)', () => {
    const snap = snapshot({ currentIndex: 3 });
    const next = reshuffleQueueSnapshot(snap, reverse);
    expect(ids(next.items).sort()).toEqual(ids(snap.items).sort());
  });

  it('is a no-op for a 0/1-item queue', () => {
    expect(reshuffleQueueSnapshot(snapshot({ items: [], currentIndex: -1 }), reverse).items).toEqual(
      []
    );
    const single = snapshot({ items: [station('solo')], currentIndex: 0 });
    expect(ids(reshuffleQueueSnapshot(single, reverse).items)).toEqual(['solo']);
  });

  it('re-rolls once when the first shuffle reproduces the original order', () => {
    // A shuffle that returns the rest unchanged on the 1st call, reversed on the
    // 2nd — proves the identical-order guard re-rolls rather than shipping a
    // no-change reorder.
    let call = 0;
    const flaky = (rest: StationLite[]) => {
      call += 1;
      return call === 1 ? [...rest] : [...rest].reverse();
    };
    const snap = snapshot({ currentIndex: 0 });
    const next = reshuffleQueueSnapshot(snap, flaky);
    expect(call).toBe(2);
    expect(ids(next.items)).toEqual(['a', 'e', 'd', 'c', 'b']);
  });

  it('shuffles the whole array when nothing is playing (currentIndex -1)', () => {
    const snap = snapshot({ currentIndex: -1 });
    const next = reshuffleQueueSnapshot(snap, reverse);
    expect(ids(next.items)).toEqual(['e', 'd', 'c', 'b', 'a']);
    expect(next.currentIndex).toBe(-1);
  });
});
