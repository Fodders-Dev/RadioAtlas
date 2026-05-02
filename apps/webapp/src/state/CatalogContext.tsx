import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import type {
  CatalogAreaListResponse,
  CatalogAreaStationsResponse,
  CatalogSearchResponse,
  CatalogSummary
} from '../domain/contracts';
import type { Station, StationLite } from '../types';
import { getApiBase } from '../lib/apiBase';
import {
  clearCatalogCacheStorage,
  readCatalogCache,
  writeCatalogCache
} from '../lib/catalogCache';

type SearchStationsInput = {
  q?: string;
  country?: string;
  language?: string;
  tag?: string;
  continent?: string;
  limit?: number;
  cursor?: string | null;
};

type CatalogContextValue = {
  summary: CatalogSummary | null;
  summaryLoading: boolean;
  summaryError: string | null;
  refreshSummary: (
    seed?: number,
    options?: { forceNetwork?: boolean }
  ) => Promise<CatalogSummary | null>;
  searchStations: (input: SearchStationsInput) => Promise<CatalogSearchResponse>;
  fetchAreas: (zoomLevel: number) => Promise<CatalogAreaListResponse>;
  fetchAreaStations: (
    areaId: string,
    options?: { limit?: number; cursor?: string | null }
  ) => Promise<CatalogAreaStationsResponse>;
  fetchStationById: (stationId: string) => Promise<StationLite | null>;
  rememberStations: (stations: Array<Station | StationLite>) => void;
  getStationById: (stationId: string) => StationLite | null;
  clearCatalogCache: () => void;
};

const CatalogContext = createContext<CatalogContextValue | null>(null);
const CATALOG_REQUEST_TIMEOUT_MS = 6000;
const SUMMARY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000;
const AREAS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AREA_STATIONS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const STATION_BY_ID_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SUMMARY_CACHE_KEY = 'summary:v1';

const loadFallbackCatalog = () => import('../lib/radioBrowserFallback');

const toStationLite = (station: Station | StationLite): StationLite => ({
  stationuuid: station.stationuuid,
  name: station.name,
  url: 'url' in station ? station.url : undefined,
  url_resolved: station.url_resolved,
  homepage: station.homepage || '',
  favicon: station.favicon || '',
  country: station.country || '',
  state: station.state || '',
  tags: station.tags || '',
  geo_lat: station.geo_lat ?? null,
  geo_long: station.geo_long ?? null,
  stationArtwork: station.stationArtwork || null,
  isClaimed: station.isClaimed,
  isVerified: station.isVerified,
  promoted: station.promoted,
  description: station.description || null,
  websiteUrl: station.websiteUrl || null,
  scheduleNote: station.scheduleNote || null
});

const normalizeZoomBucket = (zoomLevel: number) => {
  if (zoomLevel >= 5) return '5';
  if (zoomLevel >= 3.5) return '4';
  if (zoomLevel >= 2.2) return '3';
  if (zoomLevel >= 1.4) return '2';
  return '1';
};

const collectSummaryStations = (summary: CatalogSummary) => [
  ...summary.catalogPool,
  ...summary.freshSignals,
  ...summary.searchLaunch,
  ...summary.sponsored,
  ...(summary.countrySpotlight?.stations || []),
  ...(summary.genreSpotlight?.stations || [])
];

const normalizeSearchCacheInput = (input: SearchStationsInput) => ({
  q: input.q?.trim() || '',
  country: input.country?.trim() || '',
  language: input.language?.trim() || '',
  tag: input.tag?.trim() || '',
  continent: input.continent?.trim() || '',
  limit: input.limit || 50,
  cursor: input.cursor || ''
});

const searchCacheKey = (input: SearchStationsInput) =>
  `search:v1:${JSON.stringify(normalizeSearchCacheInput(input))}`;

const areaStationsCacheKey = (
  areaId: string,
  options?: { limit?: number; cursor?: string | null }
) => `area-stations:v1:${areaId}:${options?.limit || 50}:${options?.cursor || ''}`;

const stationByIdCacheKey = (stationId: string) => `station:v1:${stationId}`;

export const CatalogProvider = ({ children }: { children: ReactNode }) => {
  const [summary, setSummary] = useState<CatalogSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const stationCacheRef = useRef(new Map<string, StationLite>());
  const areaCacheRef = useRef(new Map<string, CatalogAreaListResponse>());

  const requestJson = useCallback(async <T,>(path: string) => {
    const apiBase = getApiBase();
    if (!apiBase) {
      throw new Error('API base is not configured');
    }

    let response: Response;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CATALOG_REQUEST_TIMEOUT_MS);
    try {
      response = await fetch(`${apiBase}${path}`, {
        headers: {
          Accept: 'application/json'
        },
        cache: 'no-store',
        signal: controller.signal
      });
    } catch {
      throw new Error('Catalog temporarily unavailable');
    } finally {
      window.clearTimeout(timeout);
    }

    const contentType = response.headers.get('content-type') || '';
    const rawPayload = await response.text();
    const trimmedPayload = rawPayload.trim();
    let payload: T | { error?: string } | null = null;

    if (trimmedPayload) {
      const looksLikeJson =
        contentType.includes('application/json') ||
        trimmedPayload.startsWith('{') ||
        trimmedPayload.startsWith('[');

      if (!looksLikeJson) {
        throw new Error('Catalog temporarily unavailable');
      }

      try {
        payload = JSON.parse(trimmedPayload) as T | { error?: string };
      } catch {
        throw new Error('Catalog temporarily unavailable');
      }
    }

    if (!response.ok) {
      throw new Error(
        typeof payload === 'object' &&
          payload &&
          'error' in payload &&
          typeof payload.error === 'string'
          ? payload.error
          : response.status === 404
            ? 'Catalog temporarily unavailable'
            : `Catalog request failed (${response.status})`
      );
    }

    if (payload === null) {
      throw new Error('Catalog temporarily unavailable');
    }

    return payload;
  }, []);

  const rememberStations = useCallback((stations: Array<Station | StationLite>) => {
    const cache = stationCacheRef.current;
    stations.forEach((station) => {
      if (!station?.stationuuid) return;
      cache.set(station.stationuuid, toStationLite(station));
    });
  }, []);

  const applySummary = useCallback(
    (nextSummary: CatalogSummary) => {
      rememberStations(collectSummaryStations(nextSummary));
      setSummary(nextSummary);
    },
    [rememberStations]
  );

  const fetchNetworkSummary = useCallback(
    async (seed: number) => {
      const nextSummary = await requestJson<CatalogSummary>(`/catalog/summary?seed=${seed}`);
      await writeCatalogCache(SUMMARY_CACHE_KEY, nextSummary, SUMMARY_CACHE_TTL_MS);
      return nextSummary;
    },
    [requestJson]
  );

  const refreshSummary = useCallback(
    async (seed = Date.now(), options?: { forceNetwork?: boolean }) => {
      setSummaryLoading(true);
      setSummaryError(null);
      if (!options?.forceNetwork) {
        const cached = await readCatalogCache<CatalogSummary>(SUMMARY_CACHE_KEY);
        if (cached) {
          applySummary(cached.payload);
          setSummaryLoading(false);
          void fetchNetworkSummary(seed)
            .then((nextSummary) => {
              applySummary(nextSummary);
              setSummaryError(null);
            })
            .catch(() => {
              // Cached summary is already usable; keep cold paint fast and quiet.
            });
          return cached.payload;
        }
      }

      try {
        const nextSummary = await fetchNetworkSummary(seed);
        applySummary(nextSummary);
        return nextSummary;
      } catch (error) {
        const staleSummary = await readCatalogCache<CatalogSummary>(SUMMARY_CACHE_KEY, {
          allowExpired: true
        });
        if (staleSummary) {
          applySummary(staleSummary.payload);
          setSummaryError(null);
          return staleSummary.payload;
        }

        try {
          const fallback = await loadFallbackCatalog();
          const fallbackSummary = await fallback.loadRadioBrowserFallbackSummary(seed);
          await writeCatalogCache(SUMMARY_CACHE_KEY, fallbackSummary, SUMMARY_CACHE_TTL_MS);
          applySummary(fallbackSummary);
          setSummaryError(null);
          return fallbackSummary;
        } catch {
          setSummaryError(error instanceof Error ? error.message : 'Catalog summary failed');
          return null;
        }
      } finally {
        setSummaryLoading(false);
      }
    },
    [applySummary, fetchNetworkSummary]
  );

  useEffect(() => {
    void refreshSummary();
  }, [refreshSummary]);

  const searchStations = useCallback(
    async (input: SearchStationsInput) => {
      const params = new URLSearchParams();
      if (input.q?.trim()) params.set('q', input.q.trim());
      if (input.country?.trim()) params.set('country', input.country.trim());
      if (input.language?.trim()) params.set('language', input.language.trim());
      if (input.tag?.trim()) params.set('tag', input.tag.trim());
      if (input.continent?.trim()) params.set('continent', input.continent.trim());
      params.set('limit', String(input.limit || 50));
      if (input.cursor) params.set('cursor', input.cursor);
      const cacheKey = searchCacheKey(input);
      const cached = await readCatalogCache<CatalogSearchResponse>(cacheKey);
      if (cached) {
        rememberStations(cached.payload.items);
        return cached.payload;
      }

      let response: CatalogSearchResponse;
      try {
        response = await requestJson<CatalogSearchResponse>(`/catalog/search?${params.toString()}`);
        await writeCatalogCache(cacheKey, response, SEARCH_CACHE_TTL_MS);
      } catch {
        const stale = await readCatalogCache<CatalogSearchResponse>(cacheKey, { allowExpired: true });
        if (stale) {
          response = stale.payload;
        } else {
          const fallback = await loadFallbackCatalog();
          response = await fallback.searchRadioBrowserFallback(input);
          await writeCatalogCache(cacheKey, response, SEARCH_CACHE_TTL_MS);
        }
      }
      rememberStations(response.items);
      return response;
    },
    [rememberStations, requestJson]
  );

  const fetchAreas = useCallback(
    async (zoomLevel: number) => {
      const bucket = normalizeZoomBucket(zoomLevel);
      const cached = areaCacheRef.current.get(bucket);
      if (cached) {
        return cached;
      }
      const cacheKey = `areas:v1:${bucket}`;
      const cachedStorage = await readCatalogCache<CatalogAreaListResponse>(cacheKey);
      if (cachedStorage) {
        areaCacheRef.current.set(bucket, cachedStorage.payload);
        return cachedStorage.payload;
      }

      let response: CatalogAreaListResponse;
      try {
        response = await requestJson<CatalogAreaListResponse>(`/catalog/areas?zoom=${bucket}`);
        await writeCatalogCache(cacheKey, response, AREAS_CACHE_TTL_MS);
      } catch {
        const stale = await readCatalogCache<CatalogAreaListResponse>(cacheKey, { allowExpired: true });
        if (stale) {
          response = stale.payload;
        } else {
          const fallback = await loadFallbackCatalog();
          response = await fallback.listRadioBrowserFallbackAreas(zoomLevel);
          await writeCatalogCache(cacheKey, response, AREAS_CACHE_TTL_MS);
        }
      }
      areaCacheRef.current.set(bucket, response);
      return response;
    },
    [requestJson]
  );

  const fetchAreaStations = useCallback(
    async (areaId: string, options?: { limit?: number; cursor?: string | null }) => {
      const params = new URLSearchParams();
      params.set('limit', String(options?.limit || 50));
      if (options?.cursor) params.set('cursor', options.cursor);
      const cacheKey = areaStationsCacheKey(areaId, options);
      const cached = await readCatalogCache<CatalogAreaStationsResponse>(cacheKey);
      if (cached) {
        rememberStations(cached.payload.items);
        return cached.payload;
      }

      let response: CatalogAreaStationsResponse;
      try {
        response = await requestJson<CatalogAreaStationsResponse>(
          `/catalog/areas/${encodeURIComponent(areaId)}/stations?${params.toString()}`
        );
        await writeCatalogCache(cacheKey, response, AREA_STATIONS_CACHE_TTL_MS);
      } catch {
        const stale = await readCatalogCache<CatalogAreaStationsResponse>(cacheKey, {
          allowExpired: true
        });
        if (stale) {
          response = stale.payload;
        } else {
          const fallback = await loadFallbackCatalog();
          response = await fallback.listRadioBrowserFallbackAreaStations(areaId, options);
          await writeCatalogCache(cacheKey, response, AREA_STATIONS_CACHE_TTL_MS);
        }
      }
      rememberStations(response.items);
      return response;
    },
    [rememberStations, requestJson]
  );

  const fetchStationById = useCallback(
    async (stationId: string) => {
      const cached = stationCacheRef.current.get(stationId);
      if (cached) {
        return cached;
      }
      const cacheKey = stationByIdCacheKey(stationId);
      const cachedStorage = await readCatalogCache<StationLite | null>(cacheKey);
      if (cachedStorage) {
        if (cachedStorage.payload) {
          rememberStations([cachedStorage.payload]);
        }
        return cachedStorage.payload;
      }

      let item: StationLite | null = null;
      try {
        const response = await requestJson<{ item: StationLite | null }>(
          `/catalog/stations/${encodeURIComponent(stationId)}`
        );
        item = response.item || null;
        await writeCatalogCache(cacheKey, item, STATION_BY_ID_CACHE_TTL_MS);
      } catch {
        const stale = await readCatalogCache<StationLite | null>(cacheKey, { allowExpired: true });
        if (stale) {
          item = stale.payload;
        } else {
          const fallback = await loadFallbackCatalog();
          item = await fallback.fetchRadioBrowserFallbackStationById(stationId);
          await writeCatalogCache(cacheKey, item, STATION_BY_ID_CACHE_TTL_MS);
        }
      }
      if (item) {
        rememberStations([item]);
      }
      return item;
    },
    [rememberStations, requestJson]
  );

  const getStationById = useCallback((stationId: string) => {
    return stationCacheRef.current.get(stationId) || null;
  }, []);

  const clearCatalogCache = useCallback(() => {
    setSummary(null);
    setSummaryError(null);
    setSummaryLoading(false);
    stationCacheRef.current.clear();
    areaCacheRef.current.clear();
    void clearCatalogCacheStorage();
  }, []);

  const value = useMemo<CatalogContextValue>(
    () => ({
      summary,
      summaryLoading,
      summaryError,
      refreshSummary,
      searchStations,
      fetchAreas,
      fetchAreaStations,
      fetchStationById,
      rememberStations,
      getStationById,
      clearCatalogCache
    }),
    [
      clearCatalogCache,
      fetchAreaStations,
      fetchAreas,
      fetchStationById,
      getStationById,
      refreshSummary,
      rememberStations,
      searchStations,
      summary,
      summaryError,
      summaryLoading
    ]
  );

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
};

export const useCatalog = () => {
  const context = useContext(CatalogContext);
  if (!context) {
    throw new Error('useCatalog must be used inside CatalogProvider');
  }
  return context;
};
