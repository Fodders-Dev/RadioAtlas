import { describe, expect, it } from 'vitest';
import type { StationLite } from '../types';
import { buildStories, storyStations, topCountries } from './calmStories';

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
  it('leads with jazz when the loaded pool has jazz, and keeps every story reachable', () => {
    const pool = [station('a', 'France', 'jazz,public radio'), station('b', 'Japan', 'pop'), station('c', 'Brazil', 'funk,soul')];
    const rails = [{ id: 'mood-late-night', stations: [station('n', 'USA', 'ambient')] }, { id: 'mood-workout', stations: [] }];
    const stories = buildStories(pool, rails);
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
    const stories = buildStories(pool, []);
    expect(storyStations(stories[0], pool, []).length).toBeGreaterThan(0);
    expect(stories[0].id).toBe('groove');
  });

  it('ranks countries by loaded stations, ties by name', () => {
    const pool = [station('1', 'France', ''), station('2', 'Japan', ''), station('3', 'France', ''), station('4', 'Brazil', ''), station('5', '', '')];
    expect(topCountries(pool, 3)).toEqual(['France', 'Brazil', 'Japan']);
  });
});
