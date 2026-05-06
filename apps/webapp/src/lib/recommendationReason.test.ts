import { describe, expect, it } from 'vitest';
import { getRecommendationReason } from './recommendationReason';
import { DEFAULT_BEHAVIOR_PROFILE, type BehaviorProfile } from './homeProfile';
import type { StationLite } from '../types';

const t = (key: string, vars?: Record<string, string | number>) => {
  if (!vars) return key;
  return Object.entries(vars).reduce(
    (acc, [name, value]) => acc.replace(`{${name}}`, String(value)),
    key
  );
};

const station = (overrides: Partial<StationLite> = {}): StationLite => ({
  stationuuid: 'uuid-test',
  name: 'Test Station',
  url: '',
  url_resolved: 'https://example.com/stream',
  homepage: '',
  favicon: '',
  country: 'Russia',
  state: '',
  tags: 'rock,indie',
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

const profileWith = (overrides: Partial<BehaviorProfile>): BehaviorProfile => ({
  ...DEFAULT_BEHAVIOR_PROFILE,
  ...overrides
});

describe('getRecommendationReason', () => {
  it('returns null when there is no behavior profile and no catalog flags', () => {
    expect(
      getRecommendationReason({
        station: station({ isVerified: false, promoted: false }),
        behaviorProfile: null,
        t
      })
    ).toBeNull();
  });

  it('falls back to "verified" only when no personal signal applies', () => {
    expect(
      getRecommendationReason({
        station: station({ isVerified: true }),
        behaviorProfile: null,
        t
      })?.kind
    ).toBe('verified');
  });

  it('promoted beats verified', () => {
    expect(
      getRecommendationReason({
        station: station({ isVerified: true, promoted: true }),
        behaviorProfile: null,
        t
      })?.kind
    ).toBe('promoted');
  });

  it('frequent (≥3 plays) beats every other reason', () => {
    const profile = profileWith({
      stationScores: { 'uuid-test': 5 },
      tagScores: { 'rock': 100 },
      countryScores: { Russia: 80 }
    });
    expect(
      getRecommendationReason({
        station: station({ promoted: true }),
        behaviorProfile: profile,
        t
      })?.kind
    ).toBe('frequent');
  });

  it('favorite-tag matches the user\'s top tag against any tag on the station', () => {
    const profile = profileWith({
      tagScores: { indie: 30 },
      countryScores: {}
    });
    const reason = getRecommendationReason({
      station: station({ tags: 'rock,indie,alternative' }),
      behaviorProfile: profile,
      t
    });
    expect(reason?.kind).toBe('favorite-tag');
    expect(reason?.detail).toBe('indie');
  });

  it('favorite-country only fires when the country matches exactly', () => {
    const profile = profileWith({
      countryScores: { Russia: 40 }
    });
    expect(
      getRecommendationReason({
        station: station({ country: 'Russia', isVerified: false }),
        behaviorProfile: profile,
        t
      })?.kind
    ).toBe('favorite-country');
    expect(
      getRecommendationReason({
        station: station({ country: 'Germany', isVerified: false }),
        behaviorProfile: profile,
        t
      })?.kind
    ).not.toBe('favorite-country');
  });

  it('does not falsely promote a verified station to "favorite-tag" without a tag match', () => {
    const profile = profileWith({
      tagScores: { jazz: 50 }
    });
    const reason = getRecommendationReason({
      station: station({ tags: 'rock,indie', isVerified: true }),
      behaviorProfile: profile,
      t
    });
    expect(reason?.kind).toBe('verified');
  });
});
