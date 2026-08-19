import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAYABILITY_PROFILE,
  getStationPlayabilityScore,
  getUpstreamHealthScore,
  isStationHardHiddenByUpstream,
  orderStationsByPlayability,
  rankStationsForHome,
  rankStationsForSearch,
  recordPlaybackOutcome
} from './stationPlayability';
import { DEFAULT_BEHAVIOR_PROFILE } from './homeProfile';
import { DEFAULT_STATION_HEALTH_PROFILE, recordStationHealthSignal } from './stationHealth';
import type { StationLite } from '../types';

const healthSuppressed = (uuid: string, now: number) => {
  // Two recent hard failures → isStationSuppressedByHealth → "broken".
  let profile = recordStationHealthSignal(DEFAULT_STATION_HEALTH_PROFILE, uuid, 'stream-failure', { now });
  profile = recordStationHealthSignal(profile, uuid, 'stream-failure', { now: now + 1000 });
  return profile;
};

const station = (
  id: string,
  name: string,
  country: string,
  tags: string,
  overrides: Partial<StationLite> = {}
): StationLite => ({
  stationuuid: id,
  name,
  url: '',
  url_resolved: 'https://example.com/stream',
  homepage: '',
  favicon: '',
  country,
  state: '',
  tags,
  geo_lat: null,
  geo_long: null,
  stationArtwork: null,
  isClaimed: false,
  isVerified: true,
  promoted: false,
  description: null,
  websiteUrl: null,
  scheduleNote: null,
  ...overrides
});

const consecutiveSameCountryAndTag = (stations: StationLite[]) => {
  let max = 1;
  let current = 1;
  for (let i = 1; i < stations.length; i += 1) {
    const prev = stations[i - 1];
    const cur = stations[i];
    if (
      prev.country === cur.country &&
      prev.tags.split(',')[0]?.trim() === cur.tags.split(',')[0]?.trim()
    ) {
      current += 1;
      max = Math.max(max, current);
    } else {
      current = 1;
    }
  }
  return max;
};

describe('rankStationsForHome — diversification', () => {
  it('does not stack 5 same-country same-tag stations consecutively at the top', () => {
    const all = [
      station('r1', 'RU Rock 1', 'Russia', 'rock'),
      station('r2', 'RU Rock 2', 'Russia', 'rock'),
      station('r3', 'RU Rock 3', 'Russia', 'rock'),
      station('r4', 'RU Rock 4', 'Russia', 'rock'),
      station('r5', 'RU Rock 5', 'Russia', 'rock'),
      station('us-pop', 'US Pop', 'USA', 'pop'),
      station('de-pop', 'DE Pop', 'Germany', 'pop'),
      station('br-jazz', 'BR Jazz', 'Brazil', 'jazz'),
      station('jp-rock', 'JP Rock', 'Japan', 'rock'),
      station('ca-news', 'CA News', 'Canada', 'news')
    ];

    const ranked = rankStationsForHome(all, DEFAULT_PLAYABILITY_PROFILE, {
      limit: all.length
    });

    // Without diversification the top of the list would be 5x
    // RU/Rock followed by everything else. With it the longest
    // run drops sharply — exact value depends on how many
    // alternatives can be inserted before the diverse pool is
    // exhausted, but anything below 5 is the property we care
    // about (the recommender stops looking like a sorted dump).
    expect(consecutiveSameCountryAndTag(ranked)).toBeLessThan(5);
  });

  it('still includes every input station — diversification only reorders, never drops', () => {
    const all = [
      station('a', 'a', 'X', 'rock'),
      station('b', 'b', 'X', 'rock'),
      station('c', 'c', 'X', 'rock'),
      station('d', 'd', 'X', 'rock')
    ];
    const ranked = rankStationsForHome(all, DEFAULT_PLAYABILITY_PROFILE, {
      limit: all.length
    });
    expect(ranked).toHaveLength(all.length);
    expect(ranked.map((s) => s.stationuuid).sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('rankStationsForSearch — diversification', () => {
  it('keeps an explicit query tightly ranked (small window)', () => {
    const stations = [
      station('rock-1', 'Rock Beats Russia', 'Russia', 'rock'),
      station('rock-2', 'Rock Beats USA', 'USA', 'rock'),
      station('rock-3', 'Rock Beats Brazil', 'Brazil', 'rock'),
      station('pop-1', 'Pop Beats Russia', 'Russia', 'pop')
    ];

    const ranked = rankStationsForSearch(stations, {
      query: 'rock beats',
      behaviorProfile: DEFAULT_BEHAVIOR_PROFILE,
      playabilityProfile: DEFAULT_PLAYABILITY_PROFILE
    });

    // Top three should all match the query — the diversification
    // window for explicit queries is intentionally tight.
    expect(ranked.slice(0, 3).every((s) => s.name.startsWith('Rock Beats'))).toBe(true);
  });

  it('mixes results when the query is empty (browse mode)', () => {
    const stations = [
      station('ru-rock-1', 'A', 'Russia', 'rock'),
      station('ru-rock-2', 'B', 'Russia', 'rock'),
      station('ru-rock-3', 'C', 'Russia', 'rock'),
      station('us-pop', 'D', 'USA', 'pop'),
      station('de-jazz', 'E', 'Germany', 'jazz'),
      station('br-folk', 'F', 'Brazil', 'folk')
    ];

    const ranked = rankStationsForSearch(stations, {
      query: '',
      behaviorProfile: DEFAULT_BEHAVIOR_PROFILE,
      playabilityProfile: DEFAULT_PLAYABILITY_PROFILE
    });

    expect(consecutiveSameCountryAndTag(ranked)).toBeLessThanOrEqual(2);
    expect(ranked).toHaveLength(stations.length);
  });
});

describe('getUpstreamHealthScore', () => {
  const NOW = Date.UTC(2026, 4, 7, 12, 0, 0);

  it('returns 0 when the station has no upstream signal', () => {
    expect(
      getUpstreamHealthScore(station('s', 'S', 'X', 't'), NOW)
    ).toBe(0);
  });

  it('boosts a fresh upstream success', () => {
    const s = station('s', 'S', 'X', 't', {
      lastcheckok: 1,
      lastcheckok_at: NOW - 60_000
    });
    expect(getUpstreamHealthScore(s, NOW)).toBeGreaterThan(0);
  });

  it('penalises a fresh upstream failure', () => {
    const s = station('s', 'S', 'X', 't', {
      lastcheckok: 0,
      lastcheckok_at: NOW - 60_000
    });
    expect(getUpstreamHealthScore(s, NOW)).toBeLessThan(0);
  });

  it('softens the penalty when the failure check is older than 24 h', () => {
    const fresh = getUpstreamHealthScore(
      station('a', 'A', 'X', 't', {
        lastcheckok: 0,
        lastcheckok_at: NOW - 60_000
      }),
      NOW
    );
    const stale = getUpstreamHealthScore(
      station('b', 'B', 'X', 't', {
        lastcheckok: 0,
        lastcheckok_at: NOW - 7 * 24 * 60 * 60 * 1000
      }),
      NOW
    );
    // Both negative, but the stale check is less harsh — the
    // station might have recovered and we don't want to write it
    // off forever.
    expect(stale).toBeGreaterThan(fresh);
    expect(stale).toBeLessThan(0);
  });
});

describe('isStationHardHiddenByUpstream', () => {
  const NOW = Date.UTC(2026, 4, 7, 12, 0, 0);

  it('hides a station that just failed its upstream check', () => {
    const s = station('s', 'S', 'X', 't', {
      lastcheckok: 0,
      lastcheckok_at: NOW - 5 * 60_000
    });
    expect(isStationHardHiddenByUpstream(s, NOW)).toBe(true);
  });

  it('does not hide a station whose failure check is stale', () => {
    const s = station('s', 'S', 'X', 't', {
      lastcheckok: 0,
      lastcheckok_at: NOW - 7 * 24 * 60 * 60 * 1000
    });
    expect(isStationHardHiddenByUpstream(s, NOW)).toBe(false);
  });

  it('never hides a station that passed its upstream check', () => {
    const s = station('s', 'S', 'X', 't', {
      lastcheckok: 1,
      lastcheckok_at: NOW
    });
    expect(isStationHardHiddenByUpstream(s, NOW)).toBe(false);
  });

  it('does not hide stations without an upstream signal at all', () => {
    expect(
      isStationHardHiddenByUpstream(station('s', 'S', 'X', 't'), NOW)
    ).toBe(false);
  });
});

describe('rankStationsForHome — broken stations demoted, not dropped (Phase B-PR2)', () => {
  const NOW = Date.UTC(2026, 4, 7, 12, 0, 0);

  it('keeps an upstream-broken station in discovery but ranks it below the healthy one', () => {
    const broken = station('broken', 'Broken Stream', 'Russia', 'rock', {
      lastcheckok: 0,
      lastcheckok_at: NOW - 60_000
    });
    const ok = station('ok', 'Working', 'Russia', 'rock', {
      lastcheckok: 1,
      lastcheckok_at: NOW - 60_000
    });
    const ranked = rankStationsForHome([broken, ok], DEFAULT_PLAYABILITY_PROFILE, {
      now: NOW,
      limit: 10
    });
    const ids = ranked.map((s) => s.stationuuid);
    // No longer hidden — it shows (with a 🚫 badge in the UI) but sinks below
    // the working station instead of vanishing.
    expect(ids).toContain('broken');
    expect(ids).toContain('ok');
    expect(ids.indexOf('ok')).toBeLessThan(ids.indexOf('broken'));
  });

  it('keeps a health-suppressed station in discovery but ranks it below the healthy one', () => {
    const broken = station('broken', 'Flaky', 'Russia', 'rock', {
      lastcheckok: 1,
      lastcheckok_at: NOW - 60_000
    });
    const ok = station('ok', 'Working', 'Russia', 'rock', {
      lastcheckok: 1,
      lastcheckok_at: NOW - 60_000
    });
    const ranked = rankStationsForHome([broken, ok], DEFAULT_PLAYABILITY_PROFILE, {
      now: NOW,
      limit: 10,
      healthProfile: healthSuppressed('broken', NOW - 5_000)
    });
    const ids = ranked.map((s) => s.stationuuid);
    expect(ids).toContain('broken');
    expect(ids.indexOf('ok')).toBeLessThan(ids.indexOf('broken'));
  });

  it('does not let a broken station crowd a healthy one out of a limited rail', () => {
    const broken = station('broken', 'Broken Stream', 'Russia', 'rock', {
      lastcheckok: 0,
      lastcheckok_at: NOW - 60_000
    });
    const ok = station('ok', 'Working', 'Russia', 'rock', {
      lastcheckok: 1,
      lastcheckok_at: NOW - 60_000
    });
    // Only one slot — the healthy station wins, the broken one is sliced off the
    // tail (demotion respects the limit, so discovery still leads with healthy).
    const ranked = rankStationsForHome([broken, ok], DEFAULT_PLAYABILITY_PROFILE, {
      now: NOW,
      limit: 1
    });
    expect(ranked.map((s) => s.stationuuid)).toEqual(['ok']);
  });
});

describe('rankStationsForSearch — upstream health weight', () => {
  const NOW = Date.UTC(2026, 4, 7, 12, 0, 0);

  it('keeps upstream-broken stations in explicit-query results but lower', () => {
    const broken = station('broken', 'Working Title', 'Russia', 'pop', {
      lastcheckok: 0,
      lastcheckok_at: NOW - 60_000
    });
    const ok = station('ok', 'Working Title', 'Russia', 'pop', {
      lastcheckok: 1,
      lastcheckok_at: NOW - 60_000
    });
    const ranked = rankStationsForSearch([broken, ok], {
      query: 'working title',
      behaviorProfile: DEFAULT_BEHAVIOR_PROFILE,
      playabilityProfile: DEFAULT_PLAYABILITY_PROFILE,
      now: NOW
    });
    // Both must survive — explicit query trumps health filter —
    // but the broken one should appear AFTER the working one.
    expect(ranked).toHaveLength(2);
    expect(ranked[0].stationuuid).toBe('ok');
    expect(ranked[1].stationuuid).toBe('broken');
  });

  it('shows a health-suppressed station in results (Phase B-PR2: un-hidden), ranked last', () => {
    // Pre-PR2 filterStationsByPlayability DROPPED this from search entirely.
    const broken = station('broken', 'Working Title', 'Russia', 'pop', {
      lastcheckok: 1,
      lastcheckok_at: NOW - 60_000
    });
    const ok = station('ok', 'Working Title', 'Russia', 'pop', {
      lastcheckok: 1,
      lastcheckok_at: NOW - 60_000
    });
    const ranked = rankStationsForSearch([broken, ok], {
      query: 'working title',
      behaviorProfile: DEFAULT_BEHAVIOR_PROFILE,
      playabilityProfile: DEFAULT_PLAYABILITY_PROFILE,
      healthProfile: healthSuppressed('broken', NOW - 5_000),
      now: NOW
    });
    const ids = ranked.map((s) => s.stationuuid);
    expect(ids).toContain('broken');
    expect(ids.indexOf('ok')).toBeLessThan(ids.indexOf('broken'));
  });
});

describe('getStationPlayabilityScore ageFactor clamp (backward clock skew)', () => {
  const NOW = Date.UTC(2026, 4, 7, 12, 0, 0);
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const s = station('clock-skew', 'Clock Skew FM', 'Russia', 'rock');

  it('never amplifies the score when the clock is corrected backward (ageFactor ≤ 1)', () => {
    // Record a success at NOW (lastEventAt = lastSuccessAt = NOW).
    const profile = recordPlaybackOutcome(DEFAULT_PLAYABILITY_PROFILE, s, 'success', NOW);
    const atEvent = getStationPlayabilityScore(profile, s, NOW);
    // Now the device clock rewinds a week: scoring `now` is BEFORE the stored
    // lastEventAt, so (now - lastEventAt) is negative. Pre-fix ageFactor became
    // 1.5 and magnified the term; the clamp pins it at 1.0.
    const backwardSkew = getStationPlayabilityScore(profile, s, NOW - WEEK_MS);
    expect(atEvent).toBeGreaterThan(0);
    expect(backwardSkew).toBeGreaterThan(0);
    expect(backwardSkew).toBeLessThanOrEqual(atEvent);
    // Exactly equal: both sides cap at ageFactor 1, same success term.
    expect(backwardSkew).toBeCloseTo(atEvent, 6);
  });
});

describe('rankStationsForSearch — personal taste tie-breaker (примесь рекомендаций)', () => {
  it('lifts a taste-favored station above an equal-intent peer', () => {
    const a = station('a', 'Jazz A', 'US', 'jazz');
    const b = station('b', 'Jazz B', 'US', 'jazz');
    const ranked = rankStationsForSearch([a, b], {
      query: 'jazz',
      behaviorProfile: DEFAULT_BEHAVIOR_PROFILE,
      playabilityProfile: DEFAULT_PLAYABILITY_PROFILE,
      tasteBoostFor: (s) => (s.stationuuid === 'b' ? 20 : 0)
    });
    expect(ranked[0].stationuuid).toBe('b');
  });

  it('can never outrank the station the user actually typed (clamped)', () => {
    const exact = station('x', 'Jazz Cafe', 'US', 'jazz');
    const favored = station('y', 'Some Other Radio', 'US', 'pop');
    const ranked = rankStationsForSearch([favored, exact], {
      query: 'jazz cafe',
      behaviorProfile: DEFAULT_BEHAVIOR_PROFILE,
      playabilityProfile: DEFAULT_PLAYABILITY_PROFILE,
      tasteBoostFor: (s) => (s.stationuuid === 'y' ? 999 : 0)
    });
    expect(ranked[0].stationuuid).toBe('x');
  });

  it('is a no-op when no taste callback is supplied (order unchanged)', () => {
    const a = station('a', 'Jazz A', 'US', 'jazz');
    const b = station('b', 'Jazz B', 'US', 'jazz');
    const withCb = rankStationsForSearch([a, b], {
      query: 'jazz',
      behaviorProfile: DEFAULT_BEHAVIOR_PROFILE,
      playabilityProfile: DEFAULT_PLAYABILITY_PROFILE,
      tasteBoostFor: () => 0
    }).map((s) => s.stationuuid);
    const without = rankStationsForSearch([a, b], {
      query: 'jazz',
      behaviorProfile: DEFAULT_BEHAVIOR_PROFILE,
      playabilityProfile: DEFAULT_PLAYABILITY_PROFILE
    }).map((s) => s.stationuuid);
    expect(withCb).toEqual(without);
  });
});

// A listener's own favourites are handed to the queue by «Перемешать
// избранное» in the Library, which today consults NOTHING: a favourite that
// has hard-failed twice in the last six hours is as likely to be the station
// the shuffle opens on as any other. These tests pin the ordering primitive
// that fixes that — demote, never drop, never skip.
describe('orderStationsByPlayability — demote the known-broken, drop nothing', () => {
  const NOW = Date.UTC(2026, 4, 7, 12, 0, 0);
  const HOUR = 60 * 60 * 1000;

  const hardFailedTwice = (uuid: string, now: number) =>
    recordPlaybackOutcome(
      recordPlaybackOutcome(DEFAULT_PLAYABILITY_PROFILE, uuid, 'no-playable-candidate', now - 1000),
      uuid,
      'stream-unavailable',
      now
    );

  it('moves a repeatedly failed station to the back instead of removing it', () => {
    const dead = station('dead', 'Dead FM', 'US', 'rock');
    const a = station('a', 'A FM', 'US', 'rock');
    const b = station('b', 'B FM', 'DE', 'jazz');
    const ordered = orderStationsByPlayability(
      [dead, a, b],
      hardFailedTwice('dead', NOW),
      NOW
    );

    expect(ordered.map((s) => s.stationuuid)).toEqual(['a', 'b', 'dead']);
    // Nothing is hidden: the favourite the listener saved is still in the list.
    expect(ordered).toHaveLength(3);
  });

  it('keeps the order the listener/shuffle chose inside each group', () => {
    const list = [
      station('x1', 'X1', 'US', 'rock'),
      station('bad1', 'Bad1', 'US', 'rock'),
      station('x2', 'X2', 'US', 'rock'),
      station('bad2', 'Bad2', 'US', 'rock'),
      station('x3', 'X3', 'US', 'rock')
    ];
    let profile = hardFailedTwice('bad1', NOW);
    profile = recordPlaybackOutcome(profile, 'bad2', 'play-failed', NOW - 1000);
    profile = recordPlaybackOutcome(profile, 'bad2', 'attach-failed', NOW);

    expect(orderStationsByPlayability(list, profile, NOW).map((s) => s.stationuuid)).toEqual([
      'x1',
      'x2',
      'x3',
      'bad1',
      'bad2'
    ]);
  });

  it('demotes a health-suppressed station too (same predicate set as the 🚫 badge)', () => {
    const sick = station('sick', 'Sick FM', 'US', 'rock');
    const ok = station('ok', 'Ok FM', 'US', 'rock');
    const ordered = orderStationsByPlayability(
      [sick, ok],
      DEFAULT_PLAYABILITY_PROFILE,
      NOW,
      healthSuppressed('sick', NOW)
    );
    expect(ordered.map((s) => s.stationuuid)).toEqual(['ok', 'sick']);
  });

  it('demotes a station Radio Browser just confirmed dead', () => {
    const upstreamDead = station('u', 'Upstream Dead', 'US', 'rock', {
      lastcheckok: 0,
      lastcheckok_at: NOW - HOUR
    });
    const ok = station('ok', 'Ok FM', 'US', 'rock');
    expect(
      orderStationsByPlayability([upstreamDead, ok], DEFAULT_PLAYABILITY_PROFILE, NOW).map(
        (s) => s.stationuuid
      )
    ).toEqual(['ok', 'u']);
  });

  it('stops punishing once the failures fall out of the recent window', () => {
    const list = [station('dead', 'Dead FM', 'US', 'rock'), station('a', 'A FM', 'US', 'rock')];
    const profile = hardFailedTwice('dead', NOW - 7 * HOUR);
    expect(orderStationsByPlayability(list, profile, NOW).map((s) => s.stationuuid)).toEqual([
      'dead',
      'a'
    ]);
  });

  it('un-demotes a station as soon as it plays again', () => {
    const list = [station('dead', 'Dead FM', 'US', 'rock'), station('a', 'A FM', 'US', 'rock')];
    const failed = hardFailedTwice('dead', NOW - HOUR);
    expect(orderStationsByPlayability(list, failed, NOW)[0].stationuuid).toBe('a');

    const recovered = recordPlaybackOutcome(failed, 'dead', 'success', NOW);
    expect(orderStationsByPlayability(list, recovered, NOW).map((s) => s.stationuuid)).toEqual([
      'dead',
      'a'
    ]);
  });

  it('returns the input array itself when nothing is broken', () => {
    const list = [station('a', 'A FM', 'US', 'rock'), station('b', 'B FM', 'DE', 'jazz')];
    expect(orderStationsByPlayability(list, DEFAULT_PLAYABILITY_PROFILE, NOW)).toBe(list);
  });

  it('keeps duplicates — it reorders a queue, it does not shorten one', () => {
    const a = station('a', 'A FM', 'US', 'rock');
    const dead = station('dead', 'Dead FM', 'US', 'rock');
    const ordered = orderStationsByPlayability(
      [dead, a, dead, a],
      hardFailedTwice('dead', NOW),
      NOW
    );
    expect(ordered).toHaveLength(4);
    expect(ordered.map((s) => s.stationuuid)).toEqual(['a', 'a', 'dead', 'dead']);
  });

  it('handles an empty list and a missing profile', () => {
    expect(orderStationsByPlayability([], null, NOW)).toEqual([]);
    const list = [station('a', 'A FM', 'US', 'rock')];
    expect(orderStationsByPlayability(list, null, NOW)).toBe(list);
  });
});
