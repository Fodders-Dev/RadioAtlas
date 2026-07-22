import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StationLite } from '../types';

vi.mock('./apiBase', () => ({ getApiBase: () => '/api' }));
vi.mock('./apiAvailability', () => ({
  checkApiAvailability: vi.fn().mockResolvedValue(true),
  markApiUnavailable: vi.fn()
}));

import { fetchNowPlayingSnapshot } from './nowPlaying';

const station = {
  stationuuid: 'probe-cache-station',
  name: 'Probe Cache Radio',
  url_resolved: 'https://stream.probe-cache.test/live.mp3',
  homepage: '',
  favicon: '',
  country: '',
  state: '',
  tags: ''
} as StationLite;

describe('now-playing conventional endpoint miss cache', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes('status-json.xsl') || url.includes('%2Fstatus-json.xsl')) {
        return new Response(null, { status: 404 });
      }
      if (url.includes('7.html') || url.includes('%2F7.html')) {
        return new Response(null, { status: 404 });
      }
      if (url.includes('api%2Fnowplaying') || url.includes('/api/nowplaying')) {
        return new Response(null, { status: 401 });
      }
      return new Response(null, { status: 204 });
    });
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('does not repeat definitive generic endpoint misses on the next poll', async () => {
    await fetchNowPlayingSnapshot(station);
    await fetchNowPlayingSnapshot(station);

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    const callsMatching = (part: string) => urls.filter((url) => url.includes(part)).length;

    expect(callsMatching('%2Fstatus-json.xsl')).toBe(1);
    expect(callsMatching('%2F7.html')).toBe(1);
    expect(callsMatching('api%2Fnowplaying%2F1')).toBe(1);
    expect(callsMatching('api%2Fnowplaying')).toBe(2);
    expect(callsMatching('stream.probe-cache.test/live.mp3')).toBe(2);
  });
});
