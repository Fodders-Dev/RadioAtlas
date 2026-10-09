import { describe, expect, it, vi } from 'vitest';
import {
  buildCollectionShareUrl,
  hasRememberedCollectionShare,
  rememberCollectionShareState,
  readSharedPlaylistToken,
  resolveStationsInOrder
} from './collectionShare';
import type { StationLite } from '../types';

const station = (id: string) => ({ stationuuid: id, name: id }) as StationLite;

describe('playlist share links and station resolution', () => {
  it('recognizes a web link and Telegram startapp before the station route', () => {
    expect(readSharedPlaylistToken('?playlist=opaque-token&station=station_abc', 'station_else'))
      .toBe('opaque-token');
    expect(readSharedPlaylistToken('?startapp=playlist_tg-token', 'playlist_tg-token'))
      .toBe('tg-token');
    expect(readSharedPlaylistToken('?station=station_abc', 'station_abc')).toBeNull();
  });

  it('builds a same-origin public URL with only the share token', () => {
    expect(buildCollectionShareUrl('opaque-token', 'https://radio.example/path?keep=1'))
      .toBe('https://radio.example/?playlist=opaque-token');
  });

  it('keeps another owner marker active when the current account has no share', () => {
    localStorage.clear();
    rememberCollectionShareState('account-a', 'collection-1', true);
    rememberCollectionShareState('account-b', 'collection-1', false);

    expect(hasRememberedCollectionShare('collection-1')).toBe(true);
    expect(hasRememberedCollectionShare('collection-2')).toBe(false);
    localStorage.clear();
  });

  it('resolves a bounded playlist concurrently while preserving unavailable slots and order', async () => {
    let active = 0;
    let peak = 0;
    const fetchStation = vi.fn(async (id: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, id === 'a' ? 8 : 1));
      active -= 1;
      if (id === 'missing') throw new Error('unavailable');
      return station(id);
    });
    const ids = ['a', 'b', 'missing', ...Array.from({ length: 126 }, (_, index) => `s-${index}`)];

    const result = await resolveStationsInOrder(ids, fetchStation, 4);

    expect(result).toHaveLength(128);
    expect(result[0]?.stationuuid).toBe('a');
    expect(result[1]?.stationuuid).toBe('b');
    expect(result[2]).toBeNull();
    expect(result[127]?.stationuuid).toBe('s-124');
    expect(fetchStation).toHaveBeenCalledTimes(128);
    expect(peak).toBeLessThanOrEqual(4);
  });
});
