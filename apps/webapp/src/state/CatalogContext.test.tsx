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
  loadFallbackSummary: vi.fn()
}));

vi.mock('../lib/apiBase', () => ({ getApiBase: () => '/api' }));
vi.mock('../lib/catalogCache', () => ({
  readCatalogCache: mocks.readCatalogCache,
  writeCatalogCache: mocks.writeCatalogCache,
  clearCatalogCacheStorage: mocks.clearCatalogCacheStorage
}));
vi.mock('../lib/radioBrowserFallback', () => ({
  loadRadioBrowserFallbackSummary: mocks.loadFallbackSummary
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

describe('CatalogProvider summary recovery', () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mocks.readCatalogCache.mockReset().mockResolvedValue(null);
    mocks.writeCatalogCache.mockReset().mockResolvedValue(null);
    mocks.clearCatalogCacheStorage.mockReset().mockResolvedValue(undefined);
    mocks.loadFallbackSummary.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
  });

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
});
