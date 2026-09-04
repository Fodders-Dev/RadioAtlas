import { describe, expect, it } from 'vitest';

import { mergeTrackHistory } from './helpers';
import { upsertTrustedTrackHistory } from '../../lib/trackTrust';
import type { TrackHistoryItem } from './types';

/**
 * Saved means saved.
 *
 * Until 0.1b.0 a find was capped at 200 in FOUR places — the catch itself, the
 * sync payload, the client merge and the server merge — and the 201st silently
 * evicted the oldest. The worst of them was the merge that runs when somebody
 * signs in on a second device: 150 finds on a phone plus 150 on a tablet became
 * 200, and a hundred saved finds went without a word.
 *
 * The spike on 2026-09-03 showed the cap was protecting nothing: ten thousand
 * finds merge in 6ms on both sides and cost 2.2MB of a ~5MB storage budget. The
 * only real ceiling is the 1MB request body, and that is a transport limit to be
 * fixed in transport, not a licence to delete what somebody kept.
 */

const at = (index: number): TrackHistoryItem => ({
  id: `id-${index}`,
  stationId: `station-${index}`,
  stationName: `Station ${index}`,
  track: `Artist ${index} - Title ${index}`,
  timestamp: 1_756_000_000_000 + index * 60_000
});

const build = (count: number, offset = 0) =>
  Array.from({ length: count }, (_, index) => at(index + offset)).reverse();

describe('a find is never evicted to make room', () => {
  it('keeps growing across the old 200 boundary', () => {
    let history: TrackHistoryItem[] = [];
    for (let index = 0; index < 1000; index += 1) {
      history = upsertTrustedTrackHistory(history, at(index), undefined, at(index).timestamp);
    }
    // 199 -> 200 -> 201 -> 1000: the boundary that used to start deleting.
    expect(history).toHaveLength(1000);
  });

  it('still holds the very first find after a thousand more', () => {
    let history: TrackHistoryItem[] = [];
    for (let index = 0; index < 1000; index += 1) {
      history = upsertTrustedTrackHistory(history, at(index), undefined, at(index).timestamp);
    }
    // The oldest is exactly what the cap used to take, so it is what this
    // asserts: the first thing the person ever saved is still there.
    expect(history.some((item) => item.id === 'id-0')).toBe(true);
  });

  it('honours an explicit limit when one is given, so the option still works', () => {
    let history: TrackHistoryItem[] = [];
    for (let index = 0; index < 10; index += 1) {
      history = upsertTrustedTrackHistory(history, at(index), 5, at(index).timestamp);
    }
    expect(history).toHaveLength(5);
  });

  it('merges two devices into the union, not into 200', () => {
    // The scenario the owner named: 150 finds here, 150 there, no overlap.
    const phone = build(150);
    const tablet = build(150, 150);
    const merged = mergeTrackHistory(phone, tablet);
    expect(merged).toHaveLength(300);
  });

  it('dedupes across devices without losing either side', () => {
    // Half-overlapping histories: the union is 300 wide, 150 of it shared.
    const phone = build(200);
    const tablet = build(200, 100);
    const merged = mergeTrackHistory(phone, tablet);
    expect(merged).toHaveLength(300);
    const ids = new Set(merged.map((item) => `${item.stationId}:${item.track}`));
    expect(ids.size).toBe(300);
  });

  it('stays newest-first and deterministic', () => {
    const merged = mergeTrackHistory(build(50), build(50, 25));
    const timestamps = merged.map((item) => item.timestamp);
    expect([...timestamps].sort((left, right) => right - left)).toEqual(timestamps);
    // Same inputs, same output — a merge whose order depended on argument order
    // would make "which find survived" a coin toss.
    expect(mergeTrackHistory(build(50), build(50, 25))).toEqual(merged);
  });
});
