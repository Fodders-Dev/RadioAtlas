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
