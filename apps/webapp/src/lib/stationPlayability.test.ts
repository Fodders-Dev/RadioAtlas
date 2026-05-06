import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAYABILITY_PROFILE,
  rankStationsForHome,
  rankStationsForSearch
} from './stationPlayability';
import { DEFAULT_BEHAVIOR_PROFILE } from './homeProfile';
import type { StationLite } from '../types';

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
