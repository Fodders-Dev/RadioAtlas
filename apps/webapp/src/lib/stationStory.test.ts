import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveStationStory } from './stationStory';

const goodStory = {
  description: 'Ein christliches Jugendradio.',
  artworkUrl: 'https://assets.laut.fm/images/jcradio4m3/640x640.png',
  artists: ['Cross', 'ApologetiX'],
  sourceUrl: 'https://laut.fm/jcradio4m3',
  sourceLabel: 'laut.fm'
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('resolveStationStory', () => {
  it('requests by station id and accepts only the explicit story allowlist', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({ story: goodStory }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await resolveStationStory('story-contract-a');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/catalog/stations/story-contract-a/story');
    expect(result).toEqual(goodStory);
  });

  it('drops unsafe artwork and bounds text and artist fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ story: {
      ...goodStory,
      description: `  ${'a'.repeat(450)} `,
      artworkUrl: 'https://assets.laut.fm:444/private.png',
      artists: ['  Artist\nOne ', 'b'.repeat(90), 'Three', 'Four', 'Five']
    } }))));
    const result = await resolveStationStory('story-contract-b');
    expect(result?.description).toHaveLength(400);
    expect(result?.artworkUrl).toBeNull();
    expect(result?.artists).toEqual(['Artist One', 'b'.repeat(80), 'Three', 'Four']);
  });

  it('does not negative-cache a caller-aborted request', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      if (calls > 1) return Promise.resolve(new Response(JSON.stringify({ story: goodStory }), { status: 200 }));
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    }));
    const controller = new AbortController();
    const cancelled = resolveStationStory('story-abort-a', controller.signal);
    controller.abort();
    expect(await cancelled).toBeNull();
    expect(await resolveStationStory('story-abort-a')).toEqual(goodStory);
    expect(calls).toBe(2);
  });

  it('caches success for six hours and empty results for two minutes', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ story: goodStory }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await resolveStationStory('story-cache-success');
    await resolveStationStory('story-cache-success');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 + 1);
    await resolveStationStory('story-cache-success');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const emptyFetch = vi.fn(async () => new Response(JSON.stringify({ story: null }), { status: 200 }));
    vi.stubGlobal('fetch', emptyFetch);
    await resolveStationStory('story-cache-empty');
    await resolveStationStory('story-cache-empty');
    expect(emptyFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 1);
    await resolveStationStory('story-cache-empty');
    expect(emptyFetch).toHaveBeenCalledTimes(2);
  });
});
