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
  refreshSummary: (seed?: number) => Promise<CatalogSummary | null>;
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

    const response = await fetch(`${apiBase}${path}`, {
      headers: {
        Accept: 'application/json'
      },
      cache: 'no-store'
    });

    const payload = (await response.json()) as T | { error?: string };
    if (!response.ok) {
      throw new Error(
        typeof (payload as { error?: string }).error === 'string'
          ? (payload as { error?: string }).error!
          : `Catalog request failed (${response.status})`
      );
    }

    return payload as T;
  }, []);

  const rememberStations = useCallback((stations: Array<Station | StationLite>) => {
    const cache = stationCacheRef.current;
    stations.forEach((station) => {
      if (!station?.stationuuid) return;
      cache.set(station.stationuuid, toStationLite(station));
    });
  }, []);

  const refreshSummary = useCallback(
    async (seed = Date.now()) => {
      setSummaryLoading(true);
      setSummaryError(null);
      try {
        const nextSummary = await requestJson<CatalogSummary>(`/catalog/summary?seed=${seed}`);
        rememberStations([
          ...nextSummary.catalogPool,
          ...nextSummary.freshSignals,
          ...nextSummary.searchLaunch,
          ...nextSummary.sponsored,
          ...(nextSummary.countrySpotlight?.stations || []),
          ...(nextSummary.genreSpotlight?.stations || [])
        ]);
        setSummary(nextSummary);
        return nextSummary;
      } catch (error) {
        setSummaryError(error instanceof Error ? error.message : 'Catalog summary failed');
        return null;
      } finally {
        setSummaryLoading(false);
      }
    },
    [rememberStations, requestJson]
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
      const response = await requestJson<CatalogSearchResponse>(`/catalog/search?${params.toString()}`);
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
      const response = await requestJson<CatalogAreaListResponse>(`/catalog/areas?zoom=${bucket}`);
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
      const response = await requestJson<CatalogAreaStationsResponse>(
        `/catalog/areas/${encodeURIComponent(areaId)}/stations?${params.toString()}`
      );
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
      const response = await requestJson<{ item: StationLite | null }>(
        `/catalog/stations/${encodeURIComponent(stationId)}`
      );
      if (response.item) {
        rememberStations([response.item]);
      }
      return response.item || null;
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
