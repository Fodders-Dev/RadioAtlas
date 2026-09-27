import { getApiBase } from './apiBase';

export type StationStory = {
  description: string | null;
  artworkUrl: string | null;
  artists: string[];
  sourceUrl: string;
  sourceLabel: 'laut.fm';
};

const SUCCESS_TTL_MS = 6 * 60 * 60 * 1000;
const EMPTY_TTL_MS = 2 * 60 * 1000;
const CACHE_MAX = 128;
const REQUEST_TIMEOUT_MS = 5_000;
const stationIdPattern = /^[a-zA-Z0-9._:-]{1,160}$/;

const plainText = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : null;
};

const safeStory = (value: unknown): StationStory | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const sourceUrl = typeof raw.sourceUrl === 'string' ? raw.sourceUrl : '';
  let source: URL;
  if (sourceUrl.length > 1_000) return null;
  try { source = new URL(sourceUrl); } catch { return null; }
  if (source.protocol !== 'https:' || source.hostname !== 'laut.fm' || source.username || source.password || source.port || source.search || source.hash) return null;
  if (raw.sourceLabel !== 'laut.fm' || !/^\/[a-z0-9_-]{1,80}\/?$/.test(source.pathname)) return null;

  let artworkUrl: string | null = null;
  if (typeof raw.artworkUrl === 'string') {
    try {
      const artwork = new URL(raw.artworkUrl);
      if (raw.artworkUrl.length <= 1_000 && artwork.protocol === 'https:' && artwork.hostname === 'assets.laut.fm' && !artwork.username && !artwork.password && !artwork.port) {
        artworkUrl = artwork.toString();
      }
    } catch { /* invalid optional artwork */ }
  }
  const artists = Array.isArray(raw.artists)
    ? raw.artists.slice(0, 4).flatMap((artist) => {
        const name = plainText(artist, 80);
        return name ? [name] : [];
      })
    : [];
  const story: StationStory = {
    description: plainText(raw.description, 400),
    artworkUrl,
    artists,
    sourceUrl: source.toString(),
    sourceLabel: 'laut.fm'
  };
  return story.description || story.artworkUrl || story.artists.length ? story : null;
};

type CacheEntry = { expiresAt: number; story: StationStory | null };
const cache = new Map<string, CacheEntry>();
const remember = (id: string, story: StationStory | null) => {
  cache.delete(id);
  cache.set(id, { expiresAt: Date.now() + (story ? SUCCESS_TTL_MS : EMPTY_TTL_MS), story });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
};

export const resolveStationStory = async (stationId: string, signal?: AbortSignal): Promise<StationStory | null> => {
  const id = typeof stationId === 'string' ? stationId.trim() : '';
  if (!stationIdPattern.test(id) || signal?.aborted) return null;
  const cached = cache.get(id);
  if (cached && cached.expiresAt > Date.now()) {
    cache.delete(id);
    cache.set(id, cached);
    return cached.story;
  }
  if (cached) cache.delete(id);
  const base = getApiBase().replace(/\/+$/, '');
  const controller = new AbortController();
  let callerAborted = false;
  const onCallerAbort = () => {
    callerAborted = true;
    controller.abort();
  };
  signal?.addEventListener('abort', onCallerAbort, { once: true });
  if (signal?.aborted) onCallerAbort();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const request = (async () => {
    let result: StationStory | null = null;
    let shouldCache = true;
    try {
      const response = await fetch(`${base}/catalog/stations/${encodeURIComponent(id)}/story`, {
        method: 'GET',
        signal: controller.signal,
        headers: { accept: 'application/json' }
      });
      if (!response.ok) return null;
      const payload = await response.json() as { story?: unknown };
      result = safeStory(payload?.story);
    } catch (error) {
      shouldCache = !callerAborted && !signal?.aborted;
    } finally {
      window.clearTimeout(timeout);
      signal?.removeEventListener('abort', onCallerAbort);
      if (shouldCache && !callerAborted && !signal?.aborted) remember(id, result);
    }
    return result;
  })();
  return request;
};
