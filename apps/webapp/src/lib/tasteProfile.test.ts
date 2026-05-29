import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TASTE_PROFILE_V2,
  hideStationFromTasteProfile,
  recordTasteSignal,
  tasteSignature,
  type TasteProfileV2
} from './tasteProfile';
import type { StationLite } from '../types';

// T_audit_9: the tasteSignature is the churn guard for eager taste propagation.
// It must STAY STABLE on a play (so the home snapshot doesn't re-shuffle rails
// mid-listen — the T1.2 rank-freeze invariant) and CHANGE on a like / skip /
// hide (so fresh-now re-ranks eagerly instead of waiting for the bucket flip).
// These tests drive the REAL action weights through recordTasteSignal so the
// granularity is proven against production numbers, not hand-tuned scores.

const NOW = 1_700_000_000_000;

const station = (id: string, tags: string, country = 'Atlantis'): StationLite => ({
  stationuuid: id,
  name: id,
  url_resolved: `https://stream/${id}`,
  homepage: '',
  favicon: '',
  country,
  state: '',
  tags,
  geo_lat: null,
  geo_long: null,
  stationArtwork: null,
  isClaimed: false,
  isVerified: false,
  promoted: false,
  description: null,
  websiteUrl: null,
  scheduleNote: null
});

// Establish a profile with clear top-tag gaps via real `liked` signals, all at
// the same instant so no decay applies between them (purely additive):
// jazz ≈ 34.2 (>like ×3), rock ≈ 22.8 (×2), blues ≈ 11.4 (×1).
const establishedProfile = (): TasteProfileV2 => {
  let profile = DEFAULT_TASTE_PROFILE_V2;
  for (let i = 0; i < 3; i += 1) {
    profile = recordTasteSignal(profile, station(`jazz-${i}`, 'jazz'), 'liked', { now: NOW });
  }
  for (let i = 0; i < 2; i += 1) {
    profile = recordTasteSignal(profile, station(`rock-${i}`, 'rock'), 'liked', { now: NOW });
  }
  profile = recordTasteSignal(profile, station('blues-0', 'blues'), 'liked', { now: NOW });
  return profile;
};

describe('tasteSignature (T_audit_9)', () => {
  it('stays stable after a single play (+1.71 to an already-top tag does not reorder)', () => {
    const base = establishedProfile();
    const before = tasteSignature(base);
    // play-started on a jazz station: jazz 34.2 → 35.9, still #1, order intact.
    const afterPlay = recordTasteSignal(base, station('jazz-play', 'jazz'), 'play-started', {
      now: NOW
    });
    expect(tasteSignature(afterPlay)).toBe(before);
  });

  it('changes when a like vaults a new tag into the top set (+11.4)', () => {
    const base = establishedProfile();
    const before = tasteSignature(base);
    const afterLike = recordTasteSignal(base, station('amb-0', 'ambient'), 'liked', { now: NOW });
    expect(tasteSignature(afterLike)).not.toBe(before);
  });

  it('changes when a skip reorders two near-tied top tags', () => {
    // A near-tie so a single skip (−5.8 × 0.42 ≈ −2.44 to the primary tag) flips
    // the order: jazz 12 → 9.56 drops below rock 11.
    const base: TasteProfileV2 = {
      ...DEFAULT_TASTE_PROFILE_V2,
      lastUpdatedAt: NOW,
      tagScores: { jazz: 12, rock: 11 }
    };
    const before = tasteSignature(base);
    expect(before).toBe('jazz>rock|h:0');
    const afterSkip = recordTasteSignal(base, station('jazz-skip', 'jazz'), 'skip-before-10s', {
      now: NOW
    });
    expect(tasteSignature(afterSkip)).toBe('rock>jazz|h:0');
    expect(tasteSignature(afterSkip)).not.toBe(before);
  });

  it('changes when a station is hidden (hidden-count component)', () => {
    const base = establishedProfile();
    const before = tasteSignature(base);
    const afterHide = hideStationFromTasteProfile(base, 'hide-me', NOW);
    expect(tasteSignature(afterHide)).not.toBe(before);
  });

  it('treats null and the empty default profile as the same sentinel', () => {
    expect(tasteSignature(null)).toBe('|h:0');
    expect(tasteSignature(undefined)).toBe('|h:0');
    expect(tasteSignature(DEFAULT_TASTE_PROFILE_V2)).toBe('|h:0');
  });
});
