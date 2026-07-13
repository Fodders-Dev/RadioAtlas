import { describe, expect, it, vi } from 'vitest';
import { createSceneArtworkClient } from './sceneArtwork';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

describe('scene artwork client', () => {
  it('resolves a cached scene through the configured API base and dedupes reads', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({
        status: 'ready',
        sceneKey: 'jp--city-pop--v1',
        url: '/artwork/scenes/jp--city-pop--v1.png'
      })
    );
    const client = createSceneArtworkClient({
      fetch: fetch as unknown as typeof globalThis.fetch,
      getBase: () => '/api',
      now: () => 100
    });

    await expect(client.resolve('tokyo-fm')).resolves.toBe(
      '/api/artwork/scenes/jp--city-pop--v1.png'
    );
    await expect(client.resolve('tokyo-fm')).resolves.toBe(
      '/api/artwork/scenes/jp--city-pop--v1.png'
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/artwork/scene/tokyo-fm');
  });

  it('keeps Cloudflare generation unreachable from the browser', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ status: 'unavailable', sceneKey: 'de--electronic--v1' })
    );
    const client = createSceneArtworkClient({
      fetch: fetch as unknown as typeof globalThis.fetch,
      getBase: () => 'https://radioatlas.test/api'
    });

    await expect(client.resolve('berlin-pulse')).resolves.toBeNull();
    const requestedUrl = String(fetch.mock.calls[0]?.[0]);
    expect(requestedUrl).toBe('https://radioatlas.test/api/artwork/scene/berlin-pulse');
    expect(requestedUrl).not.toContain('generate');
  });

  it('rejects non-JSON and failed responses without breaking artwork fallbacks', async () => {
    const fetch = vi
      .fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response())
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(new Response('<html />', { status: 200 }));
    let clock = 0;
    const client = createSceneArtworkClient({
      fetch: fetch as unknown as typeof globalThis.fetch,
      getBase: () => '/api',
      now: () => clock
    });

    await expect(client.resolve('missing')).resolves.toBeNull();
    clock += 1000 * 60 * 3;
    await expect(client.resolve('missing')).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not create noisy proxy requests when the optional API base is absent', async () => {
    const fetch = vi.fn();
    const client = createSceneArtworkClient({
      fetch: fetch as unknown as typeof globalThis.fetch,
      getBase: () => ''
    });

    await expect(client.resolve('local-vite-station')).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
