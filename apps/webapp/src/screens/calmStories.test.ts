import { describe, expect, it } from 'vitest';
import type { StationLite } from '../types';
import { buildStories, storyStations, todayIndex, topCountries } from './calmStories';

const station = (id: string, country: string, tags: string): StationLite => ({
  stationuuid: id,
  name: id,
  url_resolved: `https://stream.example.com/${id}`,
  homepage: '',
  favicon: '',
  country,
  state: '',
  tags,
  geo_lat: null,
  geo_long: null
});

describe('calm journal stories', () => {
  it('leads with jazz on day 0 when the loaded pool has jazz, and keeps every story reachable', () => {
    const pool = [station('a', 'France', 'jazz,public radio'), station('b', 'Japan', 'pop'), station('c', 'Brazil', 'funk,soul')];
    const rails = [{ id: 'mood-late-night', stations: [station('n', 'USA', 'ambient')] }, { id: 'mood-workout', stations: [] }];
    const stories = buildStories(pool, rails, 0);
    expect(stories[0].id).toBe('jazz');
    expect(storyStations(stories[0], pool, rails).map((s) => s.stationuuid)).toEqual(['a']);
    // A mood rail with stations becomes a story; an empty rail is not invented.
    expect(stories.some((s) => s.id === 'mood-late-night')).toBe(true);
    expect(stories.some((s) => s.id === 'mood-workout')).toBe(false);
    // Stories without loaded stations stay (the sheet pages the catalogue) but never lead.
    const world = stories.find((s) => s.id === 'world')!;
    expect(storyStations(world, pool, rails)).toEqual([]);
    expect(stories.indexOf(world)).toBeGreaterThan(stories.findIndex((s) => s.id === 'groove'));
  });

  it('never leads with an empty cover', () => {
    const pool = [station('b', 'Japan', 'pop'), station('c', 'Brazil', 'funk')];
    for (const day of [0, 1, 2, 5]) {
      const stories = buildStories(pool, [], day);
      expect(storyStations(stories[0], pool, []).length).toBeGreaterThan(0);
      expect(stories[0].id).toBe('groove');
    }
  });

  it('rotates the cover by day across the stories that have stations, in editorial order', () => {
    const pool = [station('a', 'France', 'jazz'), station('c', 'Brazil', 'funk')];
    const rails = [{ id: 'mood-late-night', stations: [station('n', 'USA', 'ambient')] }];
    const leads = [0, 1, 2, 3].map((day) => buildStories(pool, rails, day)[0].id);
    expect(leads).toEqual(['jazz', 'mood-late-night', 'groove', 'jazz']);
    // The same day always gives the same cover; a reload does not reshuffle it.
    expect(buildStories(pool, rails, 1)[0].id).toBe(buildStories(pool, rails, 1)[0].id);
    // Every story stays present exactly once whatever the day.
    expect(buildStories(pool, rails, 2).map((s) => s.id).sort()).toEqual(['groove', 'jazz', 'mood-late-night', 'world']);
  });

  it('counts days in UTC from the epoch', () => {
    expect(todayIndex(0)).toBe(0);
    expect(todayIndex(86_400_000 * 3 + 5)).toBe(3);
  });

  it('ranks countries by loaded stations, ties by name', () => {
    const pool = [station('1', 'France', ''), station('2', 'Japan', ''), station('3', 'France', ''), station('4', 'Brazil', ''), station('5', '', '')];
    expect(topCountries(pool, 3)).toEqual(['France', 'Brazil', 'Japan']);
  });
});
