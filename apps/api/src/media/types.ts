export type MediaRouteOptions = {
  userAgent: string;
  extractorUrl: string;
  metadataCacheTtlMs: number;
  // Hard cap on the in-process metadata cache (LRU eviction past this). Bounds
  // RAM growth on the 512M api box. Default ~5000.
  metadataCacheMaxEntries?: number;
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
