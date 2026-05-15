export type MediaRouteOptions = {
  userAgent: string;
  extractorUrl: string;
  blockedHosts: string[];
  metadataCacheTtlMs: number;
  metadataNegativeCacheTtlMs?: number;
  metadataProbeTimeoutMs?: number;
  metadataStreamTimeoutMs?: number;
  fetchCacheTtlMs?: number;
  fetchNegativeCacheTtlMs?: number;
  upstreamTimeoutMs?: number;
  metadataRateLimitPerWindow?: number;
  fetchRateLimitPerWindow?: number;
  streamRateLimitPerWindow?: number;
  imageRateLimitPerWindow?: number;
  rateLimitWindowMs?: number;
  metadataConcurrency?: number;
  fetchConcurrency?: number;
  streamConcurrency?: number;
  imageConcurrency?: number;
  sharedConcurrency?: number;
  fetchResponseLimitBytes?: number;
};

export type MetadataLookupResult = {
  title: string | null;
  logs: string[];
  source?: string;
};
