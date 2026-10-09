import { describe, expect, it } from 'vitest';
import { reshuffleQueueSnapshot, shuffleStations, upcomingCount } from './shuffleStations';
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

  it('produces varied permutations across several fixed seeds', () => {
    const input = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(station);
    const original = ids(input).join(',');
    const orders = [11, 23, 37, 41, 59].map((seed) =>
      ids(shuffleStations(input, seed)).join(',')
    );

    expect(new Set(orders).size).toBeGreaterThanOrEqual(2);
    expect(orders.some((order) => order !== original)).toBe(true);
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
    const snap = snapshot({ currentIndex: 1 });
    const next = reshuffleQueueSnapshot(snap, reverse);
    expect(ids(next.items).sort()).toEqual(ids(snap.items).sort());
  });

  it('reorders ONLY the upcoming part: played stations never land after the playing one', () => {
    // Q-3 of docs/CLAUDE-UI-COMPLETION-PLAN-2026-09-13.md. Mutation this
    // answers: pinning the playing item and shuffling everything else gives
    // ['e', 'd', 'c', 'a', 'b'] here — A and B, already played, would come up
    // again as «next».
    const snap = snapshot({ currentIndex: 2 });
    const next = reshuffleQueueSnapshot(snap, reverse);
    expect(ids(next.items)).toEqual(['a', 'b', 'c', 'e', 'd']);
    expect(next.currentIndex).toBe(2);
  });

  it('leaves the queue alone when fewer than two stations are ahead', () => {
    const last = snapshot({ currentIndex: 4 });
    expect(reshuffleQueueSnapshot(last, reverse)).toBe(last);
    const oneAhead = snapshot({ currentIndex: 3 });
    expect(reshuffleQueueSnapshot(oneAhead, reverse)).toBe(oneAhead);
    expect(upcomingCount(last)).toBe(0);
    expect(upcomingCount(oneAhead)).toBe(1);
  });

  it('counts upcoming stations at the first item and treats invalid indexes as no current item', () => {
    expect(upcomingCount(snapshot({ currentIndex: 0 }))).toBe(4);
    expect(upcomingCount(snapshot({ currentIndex: -1 }))).toBe(5);
    expect(upcomingCount(snapshot({ currentIndex: 5 }))).toBe(5);
    expect(upcomingCount(snapshot({ currentIndex: 7 }))).toBe(5);
    expect(upcomingCount(snapshot({ items: [], currentIndex: 0 }))).toBe(0);
  });

  it('is a no-op for a 0/1-item queue', () => {
    let calls = 0;
    const unexpectedShuffle = (items: StationLite[]) => {
      calls += 1;
      return reverse(items);
    };
    const empty = snapshot({ items: [], currentIndex: -1 });
    expect(reshuffleQueueSnapshot(empty, unexpectedShuffle)).toBe(empty);
    const single = snapshot({ items: [station('solo')], currentIndex: 0 });
    expect(reshuffleQueueSnapshot(single, unexpectedShuffle)).toBe(single);
    expect(calls).toBe(0);
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

  it('does not reroll when the first shuffle already changes the order', () => {
    let call = 0;
    const changing = (tail: StationLite[]) => {
      call += 1;
      // A partial fixed point moves some stations while leaving others put.
      return call === 1 ? [tail[3], tail[1], tail[2], tail[0]] : [...tail];
    };
    const next = reshuffleQueueSnapshot(snapshot({ currentIndex: 0 }), changing);
    expect(call).toBe(1);
    expect(ids(next.items)).toEqual(['a', 'e', 'c', 'd', 'b']);
  });

  it('shuffles the whole array when nothing is playing (currentIndex -1)', () => {
    const snap = snapshot({ currentIndex: -1 });
    const next = reshuffleQueueSnapshot(snap, reverse);
    expect(ids(next.items)).toEqual(['e', 'd', 'c', 'b', 'a']);
    expect(next.currentIndex).toBe(-1);
  });

  it('treats indexes at or beyond the queue length as no current item', () => {
    for (const currentIndex of [5, 7]) {
      const snap = snapshot({ currentIndex, sourceId: 'recent', sourceLabel: 'Recently played' });
      const next = reshuffleQueueSnapshot(snap, reverse);
      expect(ids(next.items)).toEqual(['e', 'd', 'c', 'b', 'a']);
      expect(next.currentIndex).toBe(currentIndex);
      expect(next.sourceId).toBe('recent');
      expect(next.sourceLabel).toBe('Recently played');
    }
  });

  it('re-rolls a no-current-item identity shuffle once', () => {
    let call = 0;
    const identityThenReverse = (items: StationLite[]) => {
      call += 1;
      return call === 1 ? [...items] : [...items].reverse();
    };
    const snap = snapshot({ currentIndex: -1 });
    const next = reshuffleQueueSnapshot(snap, identityThenReverse);

    expect(call).toBe(2);
    expect(ids(next.items)).toEqual(['e', 'd', 'c', 'b', 'a']);
    expect(next.currentIndex).toBe(-1);
  });
});
