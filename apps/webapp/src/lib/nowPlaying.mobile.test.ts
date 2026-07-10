import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchNowPlayingSnapshot } from './nowPlaying';
import type { StationLite } from '../types';

const tickTock1990 = (): StationLite =>
  ({
    stationuuid: 'ticktock-1990',
    name: 'Tick Tock Radio - 1990',
    url: 'https://streaming.ticktock.radio/tt/1990/icecast.audio',
    url_resolved: 'https://nl4.mystreaming.net/tt/1990/icecast.audio',
    homepage: '',
    favicon: '',
    tags: '1990s',
    country: '',
    countrycode: '',
    state: '',
    geo_lat: null,
    geo_long: null
  }) as StationLite;

describe('fetchNowPlayingSnapshot (mobile low-impact)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('falls back to server metadata for regular HTTPS streams on mobile low-impact mode', async () => {
    window.history.replaceState({}, '', '/?api=/api');
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.startsWith('/api/metadata?')) {
          return new Response(JSON.stringify({ title: 'Enigma - Sadness Part 1' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
        }
        return new Response('', { status: 404 });
      })
    );

    const snapshot = await fetchNowPlayingSnapshot(tickTock1990(), undefined, { lowImpact: true });

    expect(snapshot.status).toBe('ready');
    expect(snapshot.source).toBe('server-proxy');
    expect(snapshot.track).toBe('Enigma - Sadness Part 1');
    expect(calls.some((url) => url.startsWith('/api/metadata?'))).toBe(true);
  });
});
