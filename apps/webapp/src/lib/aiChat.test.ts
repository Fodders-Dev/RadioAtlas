// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_STORAGE_KEY } from './apiBase';
import { latestSuggestedStationIds, postChatMessage } from './aiChat';

describe('last suggested slate',()=>{
  it('does not mix a new single card with an earlier pair',()=>{
    expect(latestSuggestedStationIds([{role:'assistant',stations:[{stationuuid:'a'},{stationuuid:'b'}]},{role:'user'},{role:'assistant',stations:[{stationuuid:'c'}]}])).toEqual(['c']);
  });
  it('clears the pair after a text-only answer instead of reviving old cards',()=>{
    expect(latestSuggestedStationIds([{role:'assistant',stations:[{stationuuid:'a'},{stationuuid:'b'}]},{role:'assistant'}])).toEqual([]);
  });
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('postChatMessage', () => {
  it('exposes a fallback offer without retrying or losing the original request snapshot', async () => {
    localStorage.setItem(API_STORAGE_KEY, 'https://api.example.test');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        reply: 'GPT is unavailable.', stations: [], serviceLinks: [], sources: [], actions: [],
        provider: { name: 'gpt-6-luna', fallback: false },
        providerFallback: { token: 'opaque-ticket', reason: 'unavailable', provider: 'deepseek' }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        reply: 'Jazz from Tokyo.', stations: [], serviceLinks: [], sources: [], actions: [],
        provider: { name: 'deepseek', fallback: true }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const history = [{ role: 'user' as const, text: 'Find a calm station' }];
    const options = {
      userTaste: { favoriteStationIds: ['favorite-1'] },
      nowPlaying: { stationName: 'Night Radio' },
      agentContext: { isPlaying: true, queueStationIds: ['queued-1'] },
      actionReceipts: [{ actionId: 'a1', kind: 'pause' as const, status: 'skipped' as const }]
    };

    const offer = await postChatMessage('Find a station from Tokyo', history, options);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(offer.providerFallback).toEqual({ token: 'opaque-ticket', reason: 'unavailable', provider: 'deepseek' });
    const firstPayload = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(firstPayload).toMatchObject({ message: 'Find a station from Tokyo', history, ...options });

    const retried = await postChatMessage('Find a station from Tokyo', history, { ...options, fallbackToken: offer.providerFallback!.token });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryPayload = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body));
    const { fallbackToken, ...retrySemanticPayload } = retryPayload;
    expect(fallbackToken).toBe('opaque-ticket');
    expect(retrySemanticPayload).toEqual(firstPayload);
    expect(retried.provider).toEqual({ name: 'deepseek', fallback: true });
  });

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

  it('sends agent state and receipts while filtering unsupported response actions', async () => {
    localStorage.setItem(API_STORAGE_KEY, 'https://api.example.test');
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          reply: 'Готово.',
          stations: [],
          serviceLinks: [],
          sources: [],
          actions: [
            { actionId: 'run:1', kind: 'pause', permission: 'write' },
            { actionId: 'run:2', kind: 'delete-account', permission: 'write' }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await postChatMessage('пауза', [], {
      agentContext: { isPlaying: true, queueStationIds: ['station-1'] },
      actionReceipts: [{ actionId: 'old:1', kind: 'enqueue', status: 'executed', stationuuid: 'station-1' }]
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const request = JSON.parse(String(init.body));
    expect(request).toMatchObject({
      agentContext: { isPlaying: true, queueStationIds: ['station-1'] },
      actionReceipts: [{ actionId: 'old:1', kind: 'enqueue', status: 'executed' }]
    });
    expect(request.safetyIdentifier).toMatch(/^lira:/);
    expect(response.actions).toEqual([{ actionId: 'run:1', kind: 'pause', permission: 'write' }]);
  });
});
