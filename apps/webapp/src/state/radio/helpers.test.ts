import { describe, expect, it } from 'vitest';
import { latestTrackForStation } from './helpers';
import type { TrackHistoryItem } from './types';

const item = (over: Partial<TrackHistoryItem>): TrackHistoryItem => ({
  id: 'id',
  stationId: 's1',
  stationName: 'S1',
  track: 'Artist - Song',
  timestamp: 1,
  ...over
});

// trackHistory is stored newest-first (mergeTrackHistory sorts desc), so the
// first match walking the array is the most recent track for that station.
const history: TrackHistoryItem[] = [
  item({ id: 'a', stationId: 's2', track: 'Other - Newer', timestamp: 50 }),
  item({ id: 'b', stationId: 's1', track: 'Latest - For S1', timestamp: 40 }),
  item({ id: 'c', stationId: 's1', track: 'Older - For S1', timestamp: 20 })
];

describe('latestTrackForStation', () => {
  it('returns the most recent (first) entry for the station', () => {
    expect(latestTrackForStation(history, 's1')?.track).toBe('Latest - For S1');
  });

  it('does not bleed across stations', () => {
    expect(latestTrackForStation(history, 's2')?.track).toBe('Other - Newer');
  });

  it('returns null for a station with no history', () => {
    expect(latestTrackForStation(history, 's3')).toBeNull();
  });

  it('returns null for a missing/empty stationId', () => {
    expect(latestTrackForStation(history, null)).toBeNull();
    expect(latestTrackForStation(history, undefined)).toBeNull();
    expect(latestTrackForStation(history, '')).toBeNull();
  });

  it('skips entries with a blank track', () => {
    const blank: TrackHistoryItem[] = [
      item({ id: 'x', stationId: 's9', track: '   ', timestamp: 9 }),
      item({ id: 'y', stationId: 's9', track: 'Real - Track', timestamp: 5 })
    ];
    expect(latestTrackForStation(blank, 's9')?.track).toBe('Real - Track');
  });
});

import { reorderQueueItems } from './helpers';
import type { StationLite } from '../../types';

const qs = (id: string): StationLite =>
  ({ stationuuid: id, name: id, url_resolved: '', tags: '' }) as unknown as StationLite;

describe('reorderQueueItems (#86-safe drag reorder)', () => {
  const items = [qs('a'), qs('b'), qs('c'), qs('d')];

  it('moves an item and keeps the PLAYING station pinned (currentIndex tracks it)', () => {
    // 'b' (index 1) is playing; drag 'd' (3) to the front (0).
    const out = reorderQueueItems(items, 1, 3, 0);
    expect(out?.items.map((s) => s.stationuuid)).toEqual(['d', 'a', 'b', 'c']);
    // 'b' is now at index 2 → currentIndex followed it, playback is unchanged.
    expect(out?.currentIndex).toBe(2);
  });

  it('moves within the tail without disturbing a playing head', () => {
    const out = reorderQueueItems(items, 0, 3, 1); // 'a' playing; move 'd'→index 1
    expect(out?.items.map((s) => s.stationuuid)).toEqual(['a', 'd', 'b', 'c']);
    expect(out?.currentIndex).toBe(0);
  });

  it('refuses to move the playing item itself', () => {
    expect(reorderQueueItems(items, 1, 1, 3)).toBeNull();
  });

  it('returns null on no-op / out-of-range moves', () => {
    expect(reorderQueueItems(items, 0, 2, 2)).toBeNull();
    expect(reorderQueueItems(items, 0, -1, 2)).toBeNull();
    expect(reorderQueueItems(items, 0, 2, 9)).toBeNull();
  });

  it('handles no playing item (currentIndex -1) by leaving it -1', () => {
    const out = reorderQueueItems(items, -1, 0, 2);
    expect(out?.items.map((s) => s.stationuuid)).toEqual(['b', 'c', 'a', 'd']);
    expect(out?.currentIndex).toBe(-1);
  });
});
