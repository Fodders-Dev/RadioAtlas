import { describe, expect, it } from 'vitest';
import { calmDiscoveries, calmGenreGroups } from './calmDiscoveries';
import type { StationLite } from '../types';

const station = (id: string, tags: string) => ({ stationuuid: id, tags } as StationLite);
describe('catalogue-backed discovery directions', () => {
  it('genre browsing retains the full matching pool instead of one station per genre', () => {
    const input = [station('a', 'jazz,ambient'), station('b', 'jazz'), station('c', 'ambient'), station('d', 'classic rock')];
    const groups = calmGenreGroups(input);
    expect(groups.find(g => g.id === 'jazz')?.stations.map(s => s.stationuuid)).toEqual(['a', 'b']);
    expect(groups.find(g => g.id === 'ambient')?.stations.map(s => s.stationuuid)).toEqual(['a', 'c']);
    expect(groups.find(g => g.id === 'rock')?.stations.map(s => s.stationuuid)).toEqual(['d']);
    expect(groups.some(g => g.id === 'metal')).toBe(false);
  });
  it('only offers a direction when a station actually carries its genre', () => {
    expect(calmDiscoveries([station('chip', ' Chiptune,8-bit'), station('talk', 'talk,news')])).toEqual([
      { id: 'pixels', query: 'chiptune', station: station('chip', ' Chiptune,8-bit') }
    ]);
    expect(calmDiscoveries([station('almost', 'popcorn,ambient talk')])).toEqual([]);
  });
  it('does not fill several directions with the same eclectic station', () => {
    const picks = calmDiscoveries([station('mix', 'jazz,ambient'), station('slow', 'ambient')]);
    expect(picks.map(p => p.station.stationuuid)).toEqual(['mix', 'slow']);
    expect(picks.map(p => p.id)).toEqual(['jazz', 'ambient']);
  });
});
