import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readCatalogCache: vi.fn().mockResolvedValue(null),
  writeCatalogCache: vi.fn().mockResolvedValue(null)
}));

vi.mock('./catalogCache', () => ({
  readCatalogCache: mocks.readCatalogCache,
  writeCatalogCache: mocks.writeCatalogCache
}));

describe('radio browser fallback recovery', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('does not keep a rejected dataset promise after fallback hosts recover', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('fallback unavailable'));
    globalThis.fetch = fetchMock;
    const fallback = await import('./radioBrowserFallback');

    await expect(fallback.listRadioBrowserFallbackPoints()).rejects.toThrow('fallback catalog returned no stations');

    const station = {
      stationuuid: 'fallback-station',
      name: 'Fallback Radio',
      url_resolved: 'https://radio.example/fallback',
      country: 'Testland',
      geo_lat: 50,
      geo_long: 10
    };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([station]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );

    const response = await fallback.listRadioBrowserFallbackPoints();
    expect(response.items).toEqual([
      { id: station.stationuuid, lat: station.geo_lat, lon: station.geo_long, country: station.country, name: station.name }
    ]);
    expect(response.mappedStations).toBe(1);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });
});
