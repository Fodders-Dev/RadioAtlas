import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TASTE_PROFILE_V2,
  hideStationFromTasteProfile,
  rankStationsForUser,
  recordTasteSignal,
  tasteSignature,
  withFavoriteTasteBoosts,
  type TasteProfileV2
} from './tasteProfile';
import { recordStationPlayed, recordStationsShown } from './stationExposure';
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

// «Моя Волна» freshness: the per-seed rotation must genuinely reshuffle the head
// each new seed (the «каждый раз одно и то же» / "ничего нового" fix) WITHOUT
// abandoning taste — a markedly stronger match (liked genre) must still outrank
// an un-liked one regardless of seed.
describe('rankStationsForUser rotation (home freshness)', () => {
  // Eight equally-strong jazz matches (same tag → same taste score, so only the
  // seed separates them) plus four un-liked polka stations.
  const jazzPool = Array.from({ length: 8 }, (_, i) => station(`jazz-pool-${i}`, 'jazz'));
  const polkaPool = Array.from({ length: 4 }, (_, i) => station(`polka-${i}`, 'polka'));
  const pool = [...jazzPool, ...polkaPool];

  const headFor = (seed: number) =>
    rankStationsForUser(pool, establishedProfile(), null, {
      mode: 'personal',
      seed,
      now: NOW
    })
      .slice(0, 4)
      .map((item) => item.stationuuid)
      .join('|');

  it('produces more than one distinct head ordering across seeds', () => {
    const orderings = new Set(Array.from({ length: 8 }, (_, i) => headFor(i + 1)));
    // A static rail collapses to a single ordering; the rotation must yield ≥2.
    expect(orderings.size).toBeGreaterThan(1);
  });

  it('keeps the liked genre on top for every seed (taste is preserved)', () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      const ranked = rankStationsForUser(pool, establishedProfile(), null, {
        mode: 'personal',
        seed,
        now: NOW
      });
      // The first 8 slots are the jazz matches; no un-liked polka station may
      // jump ahead of a liked-genre one.
      const firstPolka = ranked.findIndex((s) => s.tags === 'polka');
      const lastJazz = ranked.map((s) => s.tags).lastIndexOf('jazz');
      expect(firstPolka).toBeGreaterThan(lastJazz);
    }
  });
});

describe('withFavoriteTasteBoosts', () => {
  it('turns synced/legacy favorites into an effective taste signature', () => {
    const boosted = withFavoriteTasteBoosts(DEFAULT_TASTE_PROFILE_V2, [
      station('liked-jazz-1', 'jazz, lounge'),
      station('liked-jazz-2', 'jazz')
    ]);

    expect(tasteSignature(boosted)).toContain('jazz');
    expect(boosted.stationScores['liked-jazz-1']).toBeGreaterThan(0);
  });

  it('ranks stations similar to favorites above unrelated catalog rows even with an empty stored profile', () => {
    const effective = withFavoriteTasteBoosts(DEFAULT_TASTE_PROFILE_V2, [
      station('fav-jazz', 'jazz, lounge', 'France')
    ]);
    const ranked = rankStationsForUser(
      [
        station('polka-1', 'polka', 'Poland'),
        station('jazz-1', 'jazz, fusion', 'France'),
        station('noise-1', 'noise', 'Nowhere')
      ],
      effective,
      null,
      {
        mode: 'personal',
        seed: 1,
        now: NOW
      }
    );

    expect(ranked[0].stationuuid).toBe('jazz-1');
  });
});

describe('rankStationsForUser exposure demotion', () => {
  // Two equal no-taste stations: score reduces to (rotation − exposure penalty).
  // Rotation is bounded by the floor (< 1.4) with no taste, and a single shown
  // impression costs 2.4, so a just-seen station is deterministically demoted
  // below an unseen peer — for ANY seed. This is the discovery-tier freshness
  // behind «как ни зайдёшь, одна и та же поебота».
  it('demotes a recently shown station below an equal unseen peer', () => {
    const a = station('a', 'indie');
    const b = station('b', 'indie');
    const exposure = recordStationsShown({}, ['a'], NOW);
    for (const seed of [1, 7, 42, 1000]) {
      const ranked = rankStationsForUser([a, b], DEFAULT_TASTE_PROFILE_V2, null, {
        mode: 'personal',
        seed,
        now: NOW,
        exposure
      });
      expect(ranked.map((item) => item.stationuuid)).toEqual(['b', 'a']);
    }
  });

  it('does not reorder when no exposure ledger is supplied (backward compatible)', () => {
    const a = station('a', 'indie');
    const b = station('b', 'indie');
    const withNull = rankStationsForUser([a, b], DEFAULT_TASTE_PROFILE_V2, null, {
      mode: 'personal',
      seed: 7,
      now: NOW
    });
    const played = recordStationPlayed({}, 'a', NOW);
    const withExposure = rankStationsForUser([a, b], DEFAULT_TASTE_PROFILE_V2, null, {
      mode: 'personal',
      seed: 7,
      now: NOW,
      exposure: played
    });
    // The played station 'a' is pushed behind 'b' once exposure is supplied.
    expect(withExposure.map((item) => item.stationuuid)).toEqual(['b', 'a']);
    // Both stations still present in both cases (soft demotion, never a drop).
    expect(withNull.map((item) => item.stationuuid).sort()).toEqual(['a', 'b']);
  });
});

describe('sustained-listen engagement signal', () => {
  it('adds graded positive weight beyond a bare play-started, crediting station and genre', () => {
    const s = station('s', 'jazz');
    const afterPlay = recordTasteSignal(DEFAULT_TASTE_PROFILE_V2, s, 'play-started', { now: NOW });
    const afterSustain = recordTasteSignal(afterPlay, s, 'sustained-listen', {
      now: NOW,
      weightOverride: 3.5
    });
    // Sustained active listening lifts the station's score above a bare play-start…
    expect(afterSustain.stationScores.s).toBeGreaterThan(afterPlay.stationScores.s);
    // …and builds genre preference from real listening, not just clicks.
    expect(afterSustain.tagScores.jazz).toBeGreaterThan(afterPlay.tagScores.jazz || 0);
  });

  it('a fuller listen (bigger milestone weight) counts more than a shorter one', () => {
    const s = station('s', 'jazz');
    const short = recordTasteSignal(DEFAULT_TASTE_PROFILE_V2, s, 'sustained-listen', { now: NOW, weightOverride: 3 });
    const longer = recordTasteSignal(DEFAULT_TASTE_PROFILE_V2, s, 'sustained-listen', { now: NOW, weightOverride: 6.5 });
    expect(longer.stationScores.s).toBeGreaterThan(short.stationScores.s);
  });
});
