import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogSummary } from '../domain/contracts';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mocks = vi.hoisted(() => ({
  readCatalogCache: vi.fn(),
  writeCatalogCache: vi.fn(),
  clearCatalogCacheStorage: vi.fn(),
  loadFallbackSummary: vi.fn(),
  loadFallbackPoints: vi.fn()
}));

vi.mock('../lib/apiBase', () => ({ getApiBase: () => '/api' }));
vi.mock('../lib/catalogCache', () => ({
  readCatalogCache: mocks.readCatalogCache,
  writeCatalogCache: mocks.writeCatalogCache,
  clearCatalogCacheStorage: mocks.clearCatalogCacheStorage
}));
vi.mock('../lib/radioBrowserFallback', () => ({
  loadRadioBrowserFallbackSummary: mocks.loadFallbackSummary,
  listRadioBrowserFallbackPoints: mocks.loadFallbackPoints
}));

import { CatalogProvider, useCatalog } from './CatalogContext';

const makeSummary = (stations: number): CatalogSummary => ({
  generatedAt: stations,
  counts: { stations, countries: 1, languages: 1, genres: 1 },
  catalogPool: [],
  freshSignals: [],
  searchLaunch: [],
  sponsored: [],
  countrySpotlight: null,
  genreSpotlight: null
});

const makePoints = (count: number) => ({
  items: Array.from({ length: count }, (_, index) => ({
    id: `point-${index}`,
    lat: 50 + index / 100,
    lon: 10 + index / 100,
    country: 'Testland',
    name: `Point ${index}`
  })),
  mappedStations: count,
  totalStations: count
});

const jsonResponse = (payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

const smallPointsCases = [
  {
    label: 'country-only',
    response: {
      items: [
        { id: 'mongolia-a', country: 'Mongolia', name: 'Mongolia A' },
        { id: 'mongolia-b', country: 'Mongolia', name: 'Mongolia B' }
      ],
      mappedStations: 0,
      totalStations: 2
    }
  },
  {
    label: 'mixed coordinates',
    response: {
      items: [
        { id: 'geolocated-no-country', country: '', lat: 47.5, lon: 19.04, name: 'Mapped A' },
        { id: 'mongolia-b', country: 'Mongolia', name: 'Mongolia B' },
        { id: 'bad-optional-coords', country: '', lat: 'broken', lon: 10, name: 'Unplaced A' }
      ],
      mappedStations: 1,
      totalStations: 3
    }
  }
] as const;

describe('CatalogProvider summary recovery', () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mocks.readCatalogCache.mockReset().mockResolvedValue(null);
    mocks.writeCatalogCache.mockReset().mockResolvedValue(null);
    mocks.clearCatalogCacheStorage.mockReset().mockResolvedValue(undefined);
    mocks.loadFallbackSummary.mockReset();
    mocks.loadFallbackPoints.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
  });

  const runFetchPointsProbe = async () => {
    let result!: PromiseSettledResult<unknown>;
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const Probe = () => {
      const { fetchPoints } = useCatalog();
      useEffect(() => {
        void fetchPoints().then(
          (value) => {
            result = { status: 'fulfilled', value };
            finish();
          },
          (reason) => {
            result = { status: 'rejected', reason };
            finish();
          }
        );
      }, [fetchPoints]);
      return null;
    };

    await act(async () => {
      root.render(createElement(CatalogProvider, null, createElement(Probe)));
    });
    await act(async () => {
      await finished;
    });
    return result;
  };

  it('paints an uncached fallback, then replaces and caches it after primary recovery', async () => {
    const fallback = makeSummary(3_811);
    const primary = makeSummary(60_924);
    let resolveRecovery!: (response: Response) => void;
    const recovery = new Promise<Response>((resolve) => {
      resolveRecovery = resolve;
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('API cold start'))
      .mockReturnValueOnce(recovery);
    globalThis.fetch = fetchMock;
    mocks.loadFallbackSummary.mockResolvedValue(fallback);

    const observed: number[] = [];
    const Probe = () => {
      const { summary } = useCatalog();
      useEffect(() => {
        if (summary) observed.push(summary.counts.stations);
      }, [summary]);
      return createElement('output', null, summary?.counts.stations ?? 0);
    };

    await act(async () => {
      root.render(createElement(CatalogProvider, null, createElement(Probe)));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toBe('3811');
    expect(mocks.writeCatalogCache).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveRecovery(
        new Response(JSON.stringify(primary), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
      await recovery;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toBe('60924');
    expect(observed).toEqual([3_811, 60_924]);
    expect(mocks.writeCatalogCache).toHaveBeenCalledWith('summary:v3', primary, expect.any(Number));
  });

  it('keeps a small valid stale points cache when a fresh 200 response is empty', async () => {
    const stale = makePoints(2);
    let staleEntry: Record<string, unknown> | null = {
      version: 3,
      key: 'points:v5',
      payload: stale,
      createdAt: 0,
      expiresAt: 1
    };
    mocks.readCatalogCache.mockImplementation(async (key: string, options?: { allowExpired?: boolean }) => {
      if (key !== 'points:v5') return null;
      if (!options?.allowExpired) {
        staleEntry = null;
        return null;
      }
      return staleEntry;
    });
    globalThis.fetch = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/catalog/summary')) return jsonResponse(makeSummary(2));
      if (url.includes('/catalog/points')) {
        return jsonResponse({ items: [], mappedStations: 0, totalStations: 0 });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const result = await runFetchPointsProbe();
    expect(result.status).toBe('fulfilled');
    if (result.status === 'fulfilled') expect(result.value).toEqual(stale);
    expect(mocks.readCatalogCache.mock.calls.filter(([key]) => key === 'points:v5')).toEqual([
      ['points:v5', { allowExpired: true }]
    ]);
  });

  it.each(smallPointsCases)('accepts a small fresh $label catalogue', async ({ response: fresh }) => {
    mocks.readCatalogCache.mockImplementation(async (key: string) =>
      key === 'points:v5'
        ? {
            version: 3,
            key,
            payload: { items: [{ country: 'Broken' }], mappedStations: 0, totalStations: 1 },
            createdAt: Date.now(),
            expiresAt: Date.now() + 60_000
          }
        : null
    );
    globalThis.fetch = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/catalog/summary')) return jsonResponse(makeSummary(2));
      if (url.includes('/catalog/points')) return jsonResponse(fresh);
      throw new Error(`unexpected request: ${url}`);
    });

    const result = await runFetchPointsProbe();
    expect(result.status).toBe('fulfilled');
    if (result.status === 'fulfilled') expect(result.value).toEqual(fresh);
    expect(mocks.writeCatalogCache).not.toHaveBeenCalledWith('points:v5', expect.anything(), expect.anything());
  });

  it('rejects an empty fresh points response when stale and fallback data are unavailable', async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/catalog/summary')) return jsonResponse(makeSummary(1));
      if (url.includes('/catalog/points')) {
        return jsonResponse({ items: [], mappedStations: 0, totalStations: 0 });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    mocks.loadFallbackPoints.mockRejectedValue(new Error('fallback unavailable'));

    const result = await runFetchPointsProbe();
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toMatchObject({ message: 'fallback unavailable' });
    }
  });

  it('rejects a malformed fresh points response instead of handing it to the globe', async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/catalog/summary')) return jsonResponse(makeSummary(1));
      if (url.includes('/catalog/points')) return jsonResponse({ items: 'not-an-array' });
      throw new Error(`unexpected request: ${url}`);
    });
    mocks.loadFallbackPoints.mockRejectedValue(new Error('fallback unavailable'));

    const result = await runFetchPointsProbe();
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toMatchObject({ message: 'fallback unavailable' });
    }
  });

  it('rejects an invalid fallback points response instead of handing it to the globe', async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/catalog/summary')) return jsonResponse(makeSummary(1));
      if (url.includes('/catalog/points')) throw new Error('primary unavailable');
      throw new Error(`unexpected request: ${url}`);
    });
    mocks.loadFallbackPoints.mockResolvedValue({
      items: [{ country: 'Fallback', lat: 'not-a-number' }],
      mappedStations: 0,
      totalStations: 1
    });

    const result = await runFetchPointsProbe();
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toMatchObject({ message: 'Fallback points payload is invalid' });
    }
  });
});
