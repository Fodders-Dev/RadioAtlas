import { describe, expect, it } from 'vitest';

import { countFindsPendingSync } from './findsPendingSync';
import type { TrackHistoryItem } from './types';

/**
 * What `find_sync_failed` is allowed to mean.
 *
 * The owner's objection, and it was the right one: a counter must not be named
 * more precisely than the thing it measures. «Sync упал, пока находка ждала»
 * and «sync упал, а находки вообще есть» are different claims, and the second
 * one dressed as the first would tell us something very convincing and wrong a
 * month from now.
 *
 * So the condition is a set difference over data both sides already hold, and
 * these tests are about the two ways it could lie: counting a find that IS in
 * the cloud, and missing one that is not.
 */

const find = (index: number, overrides: Partial<TrackHistoryItem> = {}): TrackHistoryItem => ({
  id: `id-${index}`,
  stationId: `station-${index}`,
  stationName: `Station ${index}`,
  track: `Artist ${index} - Title ${index}`,
  timestamp: 1_756_000_000_000 + index * 60_000,
  ...overrides
});

const finds = (count: number, offset = 0) =>
  Array.from({ length: count }, (_, index) => find(index + offset));

describe('what counts as a find waiting for the cloud', () => {
  it('says nothing is pending when the cloud already has every find', () => {
    // ⚠ THE false positive the owner named. Somebody with a year-old library
    // likes a station, that sync fails — finds did not change, so nothing about
    // finds may be claimed. A condition of `trackHistory.length > 0` would fire
    // here, which is why it is not the condition.
    expect(countFindsPendingSync(finds(200), finds(200))).toBe(0);
  });

  it('counts a find the cloud has never seen', () => {
    expect(countFindsPendingSync(finds(201), finds(200))).toBe(1);
  });

  it('counts a find that was already waiting before this session started', () => {
    // The case the old ref could not see at all: nothing was caught in this
    // browser session, but the device holds a find the server does not. That is
    // the most likely way to actually lose one — saved offline, saved before a
    // reload — and it produced no event and no toast.
    expect(countFindsPendingSync(finds(3), [])).toBe(3);
  });

  it('does not count the cloud being AHEAD of the device', () => {
    // The normal state between signing in and the hydration merge. Treating it
    // as a pending find would fire «не синхронизировано» at the exact moment
    // everything is fine.
    expect(countFindsPendingSync(finds(2), finds(40))).toBe(0);
  });

  it('matches the cloud on the same identity the merge dedupes by', () => {
    // `stationId:track` lowercased — the pair `mergeTrackHistory` and the API's
    // `uniqueTrackHistory` both use. A different notion of sameness here would
    // report a permanent backlog that the server considers already stored.
    const local = [find(1, { track: 'ARTIST 1 - TITLE 1', id: 'other', timestamp: 42 })];
    expect(countFindsPendingSync(local, [find(1)])).toBe(0);
  });

  it('ignores the timestamp, because two devices catching one track hold one find', () => {
    const local = [find(7, { timestamp: 1 })];
    const cloud = [find(7, { timestamp: 999_999 })];
    expect(countFindsPendingSync(local, cloud)).toBe(0);
  });

  it('claims nothing when there is no cloud copy to compare against', () => {
    // Signed out, or the session has not answered yet. "Everything is pending"
    // would be an invented backlog; the caller also gates on `authenticated`.
    expect(countFindsPendingSync(finds(5), null)).toBe(0);
    expect(countFindsPendingSync(finds(5), undefined)).toBe(0);
  });

  it('claims nothing when the device holds no finds', () => {
    expect(countFindsPendingSync([], finds(10))).toBe(0);
    expect(countFindsPendingSync(null, finds(10))).toBe(0);
  });

  it('stays cheap now that a library has no ceiling', () => {
    // The cap came off in 0.1b.0, so this runs against a library that can be
    // genuinely large. A nested scan would be 100M comparisons here; the set
    // makes it linear. Not a benchmark — a guard against someone rewriting it
    // as `local.filter(f => !cloud.some(...))`.
    const local = finds(10_000);
    const cloud = finds(9_990);
    const started = performance.now();
    expect(countFindsPendingSync(local, cloud)).toBe(10);
    expect(performance.now() - started).toBeLessThan(200);
  });
});
