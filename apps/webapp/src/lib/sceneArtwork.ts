import { getApiBase } from './apiBase';

type SceneArtworkPayload = {
  status?: 'ready' | 'queued' | 'disabled' | 'unavailable';
  sceneKey?: string;
  url?: string;
};

type SceneArtworkCacheEntry = {
  expiresAt: number;
  value: string | null;
  inFlight: Promise<string | null> | null;
};

type SceneArtworkClientOptions = {
  fetch?: typeof globalThis.fetch;
  getBase?: () => string;
  now?: () => number;
};

const READY_TTL_MS = 1000 * 60 * 60 * 6;
const MISS_TTL_MS = 1000 * 60 * 2;

const trimBase = (value: string) => value.replace(/\/+$/, '');

const toSceneImageUrl = (apiBase: string, value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const route = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const base = trimBase(apiBase);
  if (base.startsWith('/') && (route === base || route.startsWith(`${base}/`))) {
    return route;
  }
  return `${base}${route}`;
};

export const createSceneArtworkClient = ({
  fetch: fetchImpl = globalThis.fetch.bind(globalThis),
  getBase = () => getApiBase(),
  now = () => Date.now()
}: SceneArtworkClientOptions = {}) => {
  const cache = new Map<string, SceneArtworkCacheEntry>();

  const requestStatus = async (
    stationId: string,
    signal?: AbortSignal
  ): Promise<SceneArtworkPayload | null> => {
    const base = trimBase(getBase());
    if (!base) return null;
    try {
      const response = await fetchImpl(
        `${base}/artwork/scene/${encodeURIComponent(stationId)}`,
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal
        }
      );
      if (!response.ok && response.status !== 202) return null;
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.toLowerCase().includes('application/json')) return null;
      return (await response.json()) as SceneArtworkPayload;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      return null;
    }
  };

  const resolve = async (
    stationId: string,
    signal?: AbortSignal
  ): Promise<string | null> => {
    const normalizedId = stationId.trim();
    if (!normalizedId) return null;

    const cacheKey = normalizedId;
    const existing = cache.get(cacheKey);
    if (existing?.inFlight) return existing.inFlight;
    if (existing && existing.expiresAt > now()) return existing.value;

    const entry: SceneArtworkCacheEntry = {
      expiresAt: 0,
      value: null,
      inFlight: null
    };
    const run = (async () => {
      const payload = await requestStatus(normalizedId, signal);
      const base = trimBase(getBase());
      const url = payload?.status === 'ready' && payload.url
        ? toSceneImageUrl(base, payload.url)
        : '';
      entry.value = url || null;
      entry.expiresAt = now() + (url ? READY_TTL_MS : MISS_TTL_MS);
      return entry.value;
    })().finally(() => {
      entry.inFlight = null;
    });
    entry.inFlight = run;
    cache.set(cacheKey, entry);
    return run;
  };

  return {
    resolve,
    clear: () => cache.clear()
  };
};

const sceneArtworkClient = createSceneArtworkClient();

export const resolveSceneArtworkUrl = (
  stationId: string,
  signal?: AbortSignal
) => sceneArtworkClient.resolve(stationId, signal);
