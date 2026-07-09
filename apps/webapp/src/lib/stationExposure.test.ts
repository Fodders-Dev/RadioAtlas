import { describe, expect, it } from 'vitest';
import {
  MAX_EXPOSURE_ENTRIES,
  getStationExposurePenalty,
  normalizeExposureLedger,
  recordStationPlayed,
  recordStationsShown,
  type StationExposureLedger
} from './stationExposure';

const HOUR = 1000 * 60 * 60;

describe('stationExposure', () => {
  it('records shown ids and penalizes a freshly shown station', () => {
    const now = 1_000_000_000;
    const ledger = recordStationsShown({}, ['a', 'b'], now);
    expect(ledger.a.shownCount).toBe(1);
    expect(ledger.a.lastShownAt).toBe(now);
    // Freshly shown → a meaningful (base) penalty.
    expect(getStationExposurePenalty(ledger, 'a', now)).toBeCloseTo(2.4, 5);
    // Unknown station → no penalty.
    expect(getStationExposurePenalty(ledger, 'zzz', now)).toBe(0);
  });

  it('decays the penalty over time and drops to 0 past the TTL', () => {
    const now = 2_000_000_000;
    const ledger = recordStationsShown({}, ['a'], now);
    const fresh = getStationExposurePenalty(ledger, 'a', now);
    const afterHalfLife = getStationExposurePenalty(ledger, 'a', now + 4 * HOUR);
    // One half-life (4h) → roughly half the penalty.
    expect(afterHalfLife).toBeCloseTo(fresh / 2, 4);
    // Past the 3-day TTL → fully decayed.
    expect(getStationExposurePenalty(ledger, 'a', now + 24 * HOUR * 4)).toBe(0);
  });

  it('escalates the penalty with repeat impressions but stays capped', () => {
    const now = 3_000_000_000;
    let ledger: StationExposureLedger = {};
    for (let i = 0; i < 30; i += 1) ledger = recordStationsShown(ledger, ['a'], now);
    const penalty = getStationExposurePenalty(ledger, 'a', now);
    // More shows than a single one, but never above the combined cap.
    expect(penalty).toBeGreaterThan(2.4);
    expect(penalty).toBeLessThanOrEqual(7.5);
  });

  it('adds a separate played penalty on top of shown', () => {
    const now = 4_000_000_000;
    const shownOnly = getStationExposurePenalty(recordStationsShown({}, ['a'], now), 'a', now);
    const played = recordStationPlayed(recordStationsShown({}, ['a'], now), 'a', now);
    expect(getStationExposurePenalty(played, 'a', now)).toBeGreaterThan(shownOnly);
    expect(played.a.lastPlayedAt).toBe(now);
    // Playing keeps the prior shown timestamp.
    expect(played.a.lastShownAt).toBe(now);
  });

  it('prunes expired entries and caps the ledger size', () => {
    const now = 5_000_000_000;
    const old = recordStationsShown({}, ['stale'], now - 24 * HOUR * 5); // beyond TTL
    const pruned = normalizeExposureLedger(old, now);
    expect(pruned.stale).toBeUndefined();

    let big: StationExposureLedger = {};
    const ids = Array.from({ length: MAX_EXPOSURE_ENTRIES + 50 }, (_, i) => `s${i}`);
    // Spread timestamps so trimming has a well-defined "oldest".
    ids.forEach((id, i) => {
      big = recordStationsShown(big, [id], now - i * 1000);
    });
    const capped = normalizeExposureLedger(big, now);
    expect(Object.keys(capped).length).toBe(MAX_EXPOSURE_ENTRIES);
    // The most-recently-shown survive the cap; the oldest are dropped.
    expect(capped.s0).toBeDefined();
    expect(capped[`s${MAX_EXPOSURE_ENTRIES + 49}`]).toBeUndefined();
  });
});
