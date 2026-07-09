import type { CatalogCountryBucket, CatalogSearchResponse } from '../../domain/contracts';
import type { ContinentId, StationLite } from '../../types';

export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

export type SearchStationsInput = {
  q?: string;
  country?: string;
  language?: string;
  tag?: string;
  continent?: string;
  limit?: number;
  cursor?: string | null;
  seed?: number;
};

export type SearchStationsFn = (input: SearchStationsInput) => Promise<CatalogSearchResponse>;

export type ExternalLink = {
  id: string;
  name: string;
  url: string;
  addedAt: number;
};

export type ExtractAudioStream = {
  url: string;
  format?: string;
  mimeType?: string;
  bitrate?: number;
  averageBitrate?: number;
  delivery?: string;
};

export type ExtractItem = {
  title?: string;
  url: string;
};

export type ExtractResponse = {
  type: 'stream' | 'playlist' | 'error';
  service?: string;
  url?: string;
  title?: string;
  uploader?: string;
  duration?: number;
  audioStreams?: ExtractAudioStream[];
  items?: ExtractItem[];
  error?: string;
};

export type SearchContinentId = ContinentId | 'Other';
export type SearchContinentFilter = SearchContinentId | 'All';

export type SearchActiveFilter = {
  id: string;
  label: string;
  clear: () => void;
};

export type SearchContinentCount = {
  id: SearchContinentId;
  count: number;
};

export type VisibleCountryBucket = CatalogCountryBucket;

export type MergeStationsFn = (left: StationLite[], right: StationLite[]) => StationLite[];
