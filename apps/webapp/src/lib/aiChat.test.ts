// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_STORAGE_KEY } from './apiBase';
import { postChatMessage } from './aiChat';

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('postChatMessage', () => {
  it('sends trusted now-playing context for lyrics and meaning questions', async () => {
    localStorage.setItem(API_STORAGE_KEY, 'https://api.example.test');
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          reply: 'Разберём.',
          stations: [],
          serviceLinks: [],
          sources: [],
          actions: [{ kind: 'none' }]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    await postChatMessage('о чём эта песня?', [], {
      nowPlaying: { track: 'Artist — Song', stationName: 'Night Radio' }
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      message: 'о чём эта песня?',
      nowPlaying: { track: 'Artist — Song', stationName: 'Night Radio' }
    });
  });

  it('can send the active station even before track metadata arrives', async () => {
    localStorage.setItem(API_STORAGE_KEY, 'https://api.example.test');
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ reply: 'Станция играет.', stations: [], serviceLinks: [], sources: [], actions: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    await postChatMessage('что сейчас играет?', [], {
      nowPlaying: { stationName: 'Osaka Nights' }
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      nowPlaying: { stationName: 'Osaka Nights' }
    });
  });
});
