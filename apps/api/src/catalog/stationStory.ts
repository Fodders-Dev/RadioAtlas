export type StationStory = {
  description: string | null;
  artworkUrl: string | null;
  artists: string[];
  sourceUrl: string;
  sourceLabel: 'laut.fm';
};

export type StoryStation = Pick<
  { homepage: string; url: string; url_resolved: string },
  'homepage' | 'url' | 'url_resolved'
>;

type FetchLike = typeof fetch;
type StoryResolverOptions = {
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
};

const PROVIDER_ORIGIN = 'https://api.laut.fm';
const SUCCESS_TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 2 * 60 * 1000;
const CACHE_MAX = 256;
const BODY_MAX_BYTES = 128 * 1024;
const TIMEOUT_MS = 3_000;
const MAX_CONCURRENCY = 4;
const SLUG = /^[a-z0-9_-]{1,80}$/;

const cleanString = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, max) : null;
};

const slugFromUrl = (value: unknown, acceptedHost: string): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname.toLowerCase() !== acceptedHost) return null;
    if (url.username || url.password || url.port || url.search || url.hash) return null;
    const match = /^\/([a-z0-9_-]{1,80})\/?$/.exec(url.pathname);
    const slug = match?.[1];
    return slug && SLUG.test(slug) ? slug : null;
  } catch {
    return null;
  }
};

export const lautFmSlugForStation = (station: StoryStation): string | null =>
  slugFromUrl(station.homepage, 'laut.fm') ||
  slugFromUrl(station.url_resolved, 'stream.laut.fm') ||
  slugFromUrl(station.url, 'stream.laut.fm');

const safeArtwork = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length > 1_000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'assets.laut.fm' || url.username || url.password || url.port) return null;
    return url.toString();
  } catch {
    return null;
  }
};

const parseStory = (payload: unknown, slug: string): StationStory | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const data = payload as Record<string, unknown>;
  if (typeof data.name !== 'string' || data.name.toLowerCase() !== slug) return null;
  const images = data.images && typeof data.images === 'object' && !Array.isArray(data.images)
    ? data.images as Record<string, unknown>
    : {};
  const rawArtists = Array.isArray(data.top_artists) ? data.top_artists : [];
  const artists = rawArtists.slice(0, 4).flatMap((artist) => {
    const name = cleanString(typeof artist === 'string' ? artist : null, 80);
    return name ? [name] : [];
  });
  const story: StationStory = {
    description: cleanString(data.description, 400),
    artworkUrl: safeArtwork(images.station_640x640),
    artists,
    sourceUrl: `https://laut.fm/${slug}`,
    sourceLabel: 'laut.fm'
  };
  if (!story.description && !story.artworkUrl && !story.artists.length) return null;
  return story;
};

const readBoundedBody = async (response: Response, controller: AbortController): Promise<string> => {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > BODY_MAX_BYTES) {
    controller.abort();
    await response.body?.cancel().catch(() => undefined);
    throw new Error('Provider response too large');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BODY_MAX_BYTES) {
        controller.abort();
        await reader.cancel().catch(() => undefined);
        throw new Error('Provider response too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
};

export const createStationStoryResolver = ({ fetch: fetchImpl = fetch, now = Date.now, timeoutMs = TIMEOUT_MS }: StoryResolverOptions = {}) => {
  const cache = new Map<string, { expiresAt: number; story: StationStory | null }>();
  const inflight = new Map<string, Promise<StationStory | null>>();
  let active = 0;

  const remember = (slug: string, story: StationStory | null) => {
    if (cache.has(slug)) cache.delete(slug);
    cache.set(slug, { expiresAt: now() + (story ? SUCCESS_TTL_MS : FAILURE_TTL_MS), story });
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  };

  const fetchStory = async (slug: string): Promise<StationStory | null> => {
    if (active >= MAX_CONCURRENCY) return null;
    active += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${PROVIDER_ORIGIN}/station/${slug}`, {
        method: 'GET',
        redirect: 'manual',
        headers: { accept: 'application/json' },
        signal: controller.signal
      });
      if (!response.ok || (response.status >= 300 && response.status < 400)) {
        controller.abort();
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      const body = await readBoundedBody(response, controller);
      if (controller.signal.aborted) return null;
      let payload: unknown;
      try { payload = JSON.parse(body); } catch { return null; }
      return parseStory(payload, slug);
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
      active -= 1;
    }
  };

  return {
    resolve: async (station: StoryStation): Promise<StationStory | null> => {
      const slug = lautFmSlugForStation(station);
      if (!slug) return null;
      const cached = cache.get(slug);
      if (cached && cached.expiresAt > now()) {
        cache.delete(slug);
        cache.set(slug, cached);
        return cached.story;
      }
      if (cached) cache.delete(slug);
      const pending = inflight.get(slug);
      if (pending) return pending;
      if (active >= MAX_CONCURRENCY) {
        remember(slug, null);
        return null;
      }
      const request = fetchStory(slug).then((story) => {
        remember(slug, story);
        return story;
      }).finally(() => inflight.delete(slug));
      inflight.set(slug, request);
      return request;
    }
  };
};

export const stationStoryResolver = createStationStoryResolver();
