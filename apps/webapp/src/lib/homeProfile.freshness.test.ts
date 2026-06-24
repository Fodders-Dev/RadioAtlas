import { describe, expect, it } from 'vitest';
import {
  createHomeRecommendationFeed,
  DEFAULT_BEHAVIOR_PROFILE,
  type BehaviorProfile
} from './homeProfile';
import type { StationLite } from '../types';

const station = (overrides: Partial<StationLite> = {}): StationLite => ({
  stationuuid: 'uuid-test',
  name: 'Test Station',
  url: '',
  url_resolved: 'https://example.com/stream',
  homepage: '',
  favicon: '',
  country: 'Russia',
  state: '',
  tags: 'jazz',
  geo_lat: null,
  geo_long: null,
  stationArtwork: null,
  isClaimed: false,
  isVerified: false,
  promoted: false,
  description: null,
  websiteUrl: null,
  scheduleNote: null,
  ...overrides
});

// 8 strong-tag stations form the eligible pool; 4 weak-tag stations qualify
// above minScore but score far below the pool floor, so a correct
// "shuffle-within-the-top-pool" must NEVER surface them.
const STRONG = Array.from({ length: 8 }, (_, index) =>
  station({ stationuuid: `strong-${index}`, name: `Strong ${index}`, tags: 'jazz' })
);
const WEAK = Array.from({ length: 4 }, (_, index) =>
  station({ stationuuid: `weak-${index}`, name: `Weak ${index}`, tags: 'lounge' })
);
const CATALOG = [...STRONG, ...WEAK];

const jazzListener: BehaviorProfile = {
  ...DEFAULT_BEHAVIOR_PROFILE,
  // jazz dominates → the 8 jazz stations are the strongest matches; lounge
  // (weight 2) clears minScore 2.1 but sits well under the jazz pool.
  tagScores: { jazz: 30, lounge: 2 }
};

const feedForSeed = (seed: number, profile: BehaviorProfile = jazzListener) =>
  createHomeRecommendationFeed({
    catalog: CATALOG,
    favorites: [],
    recent: [],
    queuePreview: [],
    playbackHistory: [],
    trackHistory: [],
    collections: [],
    followedStations: [],
    behaviorProfile: profile,
    currentStation: null,
    rotationSeed: seed
  });

const ids = (stations: StationLite[]) => stations.map((item) => item.stationuuid);

describe('«Для тебя» freshness (post-rank pool shuffle)', () => {
  it('is deterministic for a fixed seed (so a play does not re-shuffle the frozen snapshot)', () => {
    expect(ids(feedForSeed(123).tunedForYou)).toEqual(ids(feedForSeed(123).tunedForYou));
  });

  it('surfaces a different on-taste selection across seeds (cold open / «Обновить»)', () => {
    // Sweep several seeds; at least one must differ from seed 0 — the old
    // rotationJitter (0..1 added to scores ~51) could not reorder same-tag
    // stations, which is exactly the «каждый раз одно и то же» the user hit.
    const base = ids(feedForSeed(0).tunedForYou).join('|');
    const sawDifferent = [1, 2, 3, 4, 5, 6, 7, 8].some(
      (seed) => ids(feedForSeed(seed).tunedForYou).join('|') !== base
    );
    expect(sawDifferent).toBe(true);
  });

  it('never leaves the strongest pool — weak-tag stations stay out for every seed', () => {
    for (let seed = 0; seed < 24; seed += 1) {
      const head = ids(feedForSeed(seed).tunedForYou);
      expect(head).toHaveLength(4);
      expect(head.every((id) => id.startsWith('strong-'))).toBe(true);
    }
  });

  it('a strong affinity boost still leads for every seed (eager re-rank survives the shuffle)', () => {
    // Regression guard for T_audit_9: the in-pool order blends score with the
    // jitter, so a clearly-dominant station (a big stationScore, the shape a
    // `liked` produces) must lead regardless of seed — the shuffle must NOT
    // bury it under a same-tag peer that only won the jitter.
    const fan: BehaviorProfile = {
      ...jazzListener,
      stationScores: { 'strong-3': 100 }
    };
    for (let seed = 0; seed < 24; seed += 1) {
      expect(ids(feedForSeed(seed, fan).tunedForYou)[0]).toBe('strong-3');
    }
  });

  it('keeps the rail on-taste — a metal listener never gets the jazz pool', () => {
    const metalListener: BehaviorProfile = {
      ...DEFAULT_BEHAVIOR_PROFILE,
      tagScores: { metal: 30 }
    };
    // No catalog station is tagged metal and jazz scores 0 for this profile,
    // so nothing clears minScore → the rail is empty, never mis-stocked.
    expect(feedForSeed(0, metalListener).tunedForYou).toHaveLength(0);
  });
});
