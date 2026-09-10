import { describe, expect, it } from 'vitest';
import { calmDiscoveries } from './calmDiscoveries';
import type { StationLite } from '../types';

const station = (id: string, tags: string) => ({ stationuuid: id, tags } as StationLite);
describe('catalogue-backed discovery directions', () => {
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
