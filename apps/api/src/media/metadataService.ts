import type express from 'express';
import type { MediaRouteOptions, MetadataLookupResult } from './types.js';
import {
  fetchWithDeadline,
  parseAndValidateHttpUrl,
  readJsonWithLimit,
  readTextWithLimit,
  sendJsonError
} from './shared.js';
import { MediaOverloadError, ProtectedMediaRoute } from './protection.js';

type MetadataCacheEntry = { ts: number; result: MetadataLookupResult };
type MetadataCache = Map<string, MetadataCacheEntry>;

const metadataCache: MetadataCache = new Map();

// Default hard cap on the metadata cache. The cache is keyed by stream url and,
// before this, only ever GREW — one entry per probed url, never evicted (TTL was
// checked on read only). On the 512M api box that is an unbounded leak. Negative
// (title:null) entries count toward the cap too.
const DEFAULT_METADATA_CACHE_MAX_ENTRIES = 5000;

// Pure cache writer (exported for tests): insert/refresh a url entry while
// (a) sweeping TTL-expired entries — using the SAME ttl the read path checks, so
// behaviour on hit/TTL is unchanged — and (b) LRU-evicting the OLDEST entries
// past maxEntries. A Map preserves insertion order, so keys().next() is the
// oldest; re-setting an existing key keeps its position (a refresh, not a bump).
export const writeMetadataCacheEntry = (
  cache: MetadataCache,
  url: string,
  entry: MetadataCacheEntry,
  ttlMs: number,
  maxEntries: number
): void => {
  for (const [key, value] of cache) {
    if (entry.ts - value.ts >= ttlMs) cache.delete(key);
  }
  cache.set(url, entry);
  while (cache.size > Math.max(1, maxEntries)) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
};

const isTechnicalTrackPayload = (value: string) =>
  /^\{.*"(status|message|result|errorCode)".*\}\s*\d*$/i.test(value);

// Multilingual idle/placeholder strings stations broadcast in
// lieu of real track metadata. Mirrored from the client-side
// FILLER_TITLES list so the API short-circuits BEFORE caching a
// placeholder as if it were a real track — otherwise the
// upstream metadata cache poisoned every subsequent visitor
// for the full TTL with strings like "Kein Titel Update".
const PLACEHOLDER_TRACK_TITLES = new Set([
  '-', '--', '...', 'loading', 'loading...',
  'unknown', 'unknown title', 'unknown artist', 'unknown song',
  'n/a', 'none', 'null', 'undefined',
  'live', 'live radio', 'live stream', 'live broadcast',
  'on air', 'now playing', 'currently playing',
  'stream', 'radio',
  'no title', 'no artist', 'no track', 'no track info', 'no metadata',
  'metadata unavailable',
  'трек ещё не пришёл', 'трек еще не пришел',
  'нет трека', 'нет данных', 'загрузка', 'без названия',
  'kein titel update', 'kein titel', 'kein song', 'keine angabe', 'unbekannt',
  'sin titulo', 'sin título', 'sem titulo', 'sem título',
  'desconocido', 'desconhecido',
  'aucun titre', 'titre inconnu',
  'titolo sconosciuto',
  'brak tytułu', 'brak tytulu'
]);

const normalizeTrackTitle = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\0/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  if (cleaned.includes('\uFFFD') || /[\u0000-\u001F\u007F]/.test(cleaned)) return null;
  if (isTechnicalTrackPayload(cleaned)) return null;
  if (PLACEHOLDER_TRACK_TITLES.has(cleaned.toLowerCase())) return null;
  return cleaned;
};

const buildTrackTitle = (artist?: string | null, title?: string | null) => {
  const parts = [normalizeTrackTitle(artist), normalizeTrackTitle(title)].filter(Boolean);
  if (!parts.length) return null;
  return parts.join(' - ');
};

const extractIcyTrackTitle = (
  metaBytes: Uint8Array,
  log: (msg: string) => void
): string | null => {
  for (const encoding of ['utf-8', 'shift_jis'] as const) {
    try {
      const text = new TextDecoder(encoding).decode(metaBytes);
      const match = text.match(/StreamTitle='([^']*)'/) || text.match(/StreamTitle=([^;]*)/);
      if (!match?.[1]) {
        continue;
      }

      const title = buildTrackTitle(undefined, match[1]);
      if (title) {
        if (encoding !== 'utf-8') {
          log(`Decoded ICY metadata via ${encoding}`);
        }
        return title;
      }
    } catch (error) {
      log(`Decoder ${encoding} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return null;
};

// Worst-case bound on dead/slow http streams: a 5s floor (don't cut real, slow
// resolvers short) and an 8s ceiling (so a hung stream is dropped by ~8s, not
// the old 10s+).
const metadataProbeTimeoutMs = (options: MediaRouteOptions) =>
  Math.max(5_000, options.metadataProbeTimeoutMs || 5_000);
const metadataStreamTimeoutMs = (options: MediaRouteOptions) =>
  Math.max(5_000, Math.min(8_000, options.metadataStreamTimeoutMs || 8_000));
const metadataCacheMaxEntries = (options: MediaRouteOptions) =>
  options.metadataCacheMaxEntries || DEFAULT_METADATA_CACHE_MAX_ENTRIES;

const fetchMetadataPayload = async (
  targetUrl: string,
  responseType: 'json' | 'text',
  options: MediaRouteOptions
) => {
  try {
    const { response, cleanup } = await fetchWithDeadline(
      targetUrl,
      {
        headers: {
          'User-Agent': options.userAgent,
          Accept: responseType === 'json' ? 'application/json,text/plain,*/*' : 'text/plain,text/html,*/*'
        }
      },
      metadataProbeTimeoutMs(options)
    );
    try {
      if (!response.ok) {
        return null;
      }

      return responseType === 'json'
        ? await readJsonWithLimit(response, options.fetchResponseLimitBytes)
        : await readTextWithLimit(response, options.fetchResponseLimitBytes);
    } finally {
      cleanup();
    }
  } catch {
    return null;
  }
};

const fetchIcecastMetadata = async (
  origin: string,
  path: string,
  options: MediaRouteOptions,
  log: (msg: string) => void
): Promise<string | null> => {
  const target = `${origin}/status-json.xsl`;
  log(`Trying Icecast status: ${target}`);
  const data = await fetchMetadataPayload(target, 'json', options);
  if (!data || typeof data !== 'object') return null;

  const source = (data as any)?.icestats?.source;
  const sources = Array.isArray(source) ? source : source ? [source] : [];
  if (!sources.length) return null;

  const matchedSource =
    sources.find((entry: any) => entry?.listenurl?.endsWith(path) || entry?.listenurl?.includes(path)) ||
    sources[0];

  if (!matchedSource) return null;

  const composedTrack = buildTrackTitle(matchedSource.artist, matchedSource.title);
  return composedTrack || buildTrackTitle(undefined, matchedSource.title) || null;
};

const fetchShoutcastMetadata = async (
  origin: string,
  options: MediaRouteOptions,
  log: (msg: string) => void
): Promise<string | null> => {
  const target = `${origin}/7.html`;
  log(`Trying Shoutcast status: ${target}`);
  const text = await fetchMetadataPayload(target, 'text', options);
  if (!text || typeof text !== 'string') return null;

  const bodyMatch = text.match(/<body[^>]*>(.*?)<\/body>/i);
  const content = bodyMatch?.[1] || text;
  const parts = content.split(',');
  if (parts.length >= 7) {
    return buildTrackTitle(undefined, parts[6]) || null;
  }
  return null;
};

const parseAzuraMetadata = (payload: unknown) => {
  const data = Array.isArray(payload) ? payload[0] : payload;
  const song = (data as any)?.now_playing?.song;
  return buildTrackTitle(undefined, song?.text) || buildTrackTitle(song?.artist, song?.title);
};

const fetchAzuraMetadata = async (
  host: string,
  options: MediaRouteOptions,
  log: (msg: string) => void
): Promise<string | null> => {
  const candidates = [`https://${host}/api/nowplaying/1`, `https://${host}/api/nowplaying`];
  // Concurrent (was sequential): a hung host would otherwise pay both timeouts.
  // First candidate that yields a track wins — same result, bounded latency.
  const tracks = await Promise.all(
    candidates.map(async (candidate) => {
      log(`Trying AzuraCast status: ${candidate}`);
      return parseAzuraMetadata(await fetchMetadataPayload(candidate, 'json', options));
    })
  );
  return tracks.find(Boolean) || null;
};

const fetchStreamMetadata = async (
  url: string,
  options: MediaRouteOptions
): Promise<MetadataLookupResult> => {
  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(`[Metadata] ${msg}`);
    logs.push(msg);
  };

  log(`Fetching: ${url}`);

  try {
    const parsedUrl = new URL(url);
    // The status-JSON probes used to run SEQUENTIALLY, and each swallows its own
    // timeout (returns null), so a host that HANGS cost icecast+shoutcast+azura
    // timeouts stacked (~tens of seconds) before we even reached the ICY fetch.
    // Run them concurrently and pick by the SAME priority (icecast > shoutcast >
    // azura) — identical output, but the worst case collapses to one timeout.
    const [icecastTitle, shoutcastTitle, azuraTitle] = await Promise.all([
      fetchIcecastMetadata(parsedUrl.origin, parsedUrl.pathname, options, log).catch(() => null),
      fetchShoutcastMetadata(parsedUrl.origin, options, log).catch(() => null),
      fetchAzuraMetadata(parsedUrl.host, options, log).catch(() => null)
    ]);
    if (icecastTitle) {
      return { title: icecastTitle, logs, source: 'icecast-status' };
    }
    if (shoutcastTitle) {
      return { title: shoutcastTitle, logs, source: 'shoutcast-status' };
    }
    if (azuraTitle) {
      return { title: azuraTitle, logs, source: 'azuracast' };
    }
  } catch (error) {
    log(`Status probe skipped: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Own the abort so we can DROP the connection the moment we're done — on the
  // no-metaint early-return especially. cleanup() only clears the deadline timer;
  // without this, a station with no icy-metaint (or a hung body) left the socket
  // dangling until GC. Aborting in `finally` releases it immediately.
  const streamAbort = new AbortController();
  try {
    const { response, cleanup } = await fetchWithDeadline(
      url,
      {
        headers: {
          'Icy-MetaData': '1',
          'User-Agent': options.userAgent
        }
      },
      metadataStreamTimeoutMs(options),
      streamAbort.signal
    );
    try {
      log(`Status: ${response.status}`);
      const metaintHeader = response.headers.get('icy-metaint');
      log(`MetaInt: ${metaintHeader}`);

      if (!metaintHeader) return { title: null, logs };

      const metaint = Number(metaintHeader);
      if (Number.isNaN(metaint) || metaint <= 0) {
        log('Invalid metaint');
        return { title: null, logs };
      }

      const body = response.body;
      if (!body) {
        log('No body');
        return { title: null, logs };
      }

      const reader = body.getReader ? body.getReader() : null;
      if (!reader) {
        log('No reader');
        return { title: null, logs };
      }

      let buffer = new Uint8Array(0);
      const maxBytes = metaint + 16384;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;

        const next = new Uint8Array(buffer.length + value.length);
        next.set(buffer);
        next.set(value, buffer.length);
        buffer = next;

        if (buffer.length >= metaint + 1) {
          const lengthByte = buffer[metaint] || 0;
          const metaLen = lengthByte * 16;

          if (metaLen === 0) {
            log('Empty metadata block found');
            return { title: null, logs };
          }

          if (buffer.length >= metaint + 1 + metaLen) {
            const metaBytes = buffer.slice(metaint + 1, metaint + 1 + metaLen);
            log('Raw meta found');
            const title = extractIcyTrackTitle(metaBytes, log);
            if (title) {
              return { title, logs, source: 'icy-stream' };
            }
            log('StreamTitle missing or not usable after decoding');
            return { title: null, logs };
          }
        }

        if (buffer.length > maxBytes) {
          log('Max bytes reached');
          break;
        }
      }
    } finally {
      // Abort BEFORE cleanup: cleanup() unbinds streamAbort from the fetch's
      // internal controller, so aborting after it would be a no-op and the
      // (possibly hung / never-fully-read) stream socket would linger until GC.
      // Aborting first, while still bound, drops the connection immediately.
      streamAbort.abort();
      cleanup();
    }
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { title: null, logs };
};

const TOP_RADIO_MAPPING: Record<string, string> = {
  'kazak.fm': 'kazak-fm',
  'radio.kazak.fm': 'kazak-fm'
};

const getTopRadioSlug = (streamUrl: string): string | null => {
  try {
    const host = new URL(streamUrl).host.toLowerCase();
    for (const [key, slug] of Object.entries(TOP_RADIO_MAPPING)) {
      if (host.includes(key)) {
        return slug;
      }
    }
  } catch {}
  return null;
};

const fetchFromTopRadio = async (
  slug: string,
  options: MediaRouteOptions
): Promise<string | null> => {
  try {
    const { response, cleanup } = await fetchWithDeadline(
      `https://top-radio.ru/web/${slug}`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
        }
      },
      metadataProbeTimeoutMs(options)
    );
    if (!response.ok) {
      cleanup();
      return null;
    }

    const html = await readTextWithLimit(response, options.fetchResponseLimitBytes);
    cleanup();
    const playlistSection = html.match(/Плейлист радиостанции[\s\S]*?Что сейчас играет:([\s\S]*?)Весь плей-лист/i);
    const contentToSearch = playlistSection?.[1] ?? html;
    const trackRegex = /class="artist"[^>]*>([^<]+)[\s\S]*?class="song"[^>]*>([^<]+)/gi;
    const matches = [...contentToSearch.matchAll(trackRegex)];

    if (matches.length > 0) {
      const artist = matches[0]?.[1]?.trim?.();
      const song = matches[0]?.[2]?.trim?.();
      if (artist && song) {
        return `${artist} - ${song}`;
      }
    }

    const fallbackMatch = html.match(/class="artist">([^<]+)<\/span>[\s\S]*?class="song">([^<]+)<\/span>/i);
    const fallbackArtist = fallbackMatch?.[1]?.trim?.();
    const fallbackSong = fallbackMatch?.[2]?.trim?.();
    if (fallbackArtist && fallbackSong) {
      return `${fallbackArtist} - ${fallbackSong}`;
    }
  } catch (error) {
    console.error(`[TopRadio] Error for ${slug}:`, error);
  }
  return null;
};

const get101ChannelId = (streamUrl: string): string | null => {
  try {
    const parsed = new URL(streamUrl);
    if (!parsed.hostname.includes('101.ru')) return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const segment = segments[index] || '';
      if (/^\d+$/.test(segment)) {
        return segment;
      }
    }
  } catch {}
  return null;
};

const fetchFrom101Ru = async (
  channelId: string,
  options: MediaRouteOptions
): Promise<string | null> => {
  const endpoints = [
    `https://101.ru/api/channel/getTrackOnAir/${encodeURIComponent(channelId)}/channelchannel/?dataFormat=json`,
    `https://101.ru/api/channel/getTrackOnAir/${encodeURIComponent(channelId)}`
  ];

  for (const endpoint of endpoints) {
    const data = await fetchMetadataPayload(endpoint, 'json', options);
    const short = (data as any)?.result?.short;
    const track =
      buildTrackTitle(short?.titleExecutor, short?.titleTrack) ||
      buildTrackTitle(undefined, short?.title);
    if (track) {
      return track;
    }
  }

  return null;
};

// radiovanya.ru's CDN doesn't expose /status-json.xsl and ICY
// metadata is intermittent. Their site uses a JSON playlist API:
//   GET /api/v1/streams/                  -> catalog of streams
//        items[].id, items[].link (= stream URL)
//   GET /api/v5/playlists/<stream_id>/    -> recent tracks
//        items[0].track.name + .artist.name = currently playing
// We cache the catalog for an hour and resolve each stream URL
// to its numeric stream_id once.

type RadioVanyaStream = {
  id: number;
  link: string;
  slug?: string;
};

const RADIO_VANYA_HOSTS = new Set([
  'icecast-radiovanya.cdnvideo.ru',
  'radiovanya.ru',
  'www.radiovanya.ru'
]);

const RADIO_VANYA_CATALOG_URL = 'https://radiovanya.ru/api/v1/streams/';
const RADIO_VANYA_CATALOG_TTL_MS = 60 * 60 * 1000;

let radioVanyaCatalogCache: { ts: number; streams: RadioVanyaStream[] } | null = null;

export const isRadioVanyaUrl = (streamUrl: string): boolean => {
  try {
    const host = new URL(streamUrl).host.toLowerCase();
    return RADIO_VANYA_HOSTS.has(host);
  } catch {
    return false;
  }
};

const getRadioVanyaCatalog = async (
  options: MediaRouteOptions
): Promise<RadioVanyaStream[] | null> => {
  if (
    radioVanyaCatalogCache &&
    Date.now() - radioVanyaCatalogCache.ts < RADIO_VANYA_CATALOG_TTL_MS
  ) {
    return radioVanyaCatalogCache.streams;
  }

  const data = await fetchMetadataPayload(RADIO_VANYA_CATALOG_URL, 'json', options);
  if (!data || typeof data !== 'object') return null;

  const items = (data as any)?.items;
  if (!Array.isArray(items)) return null;

  const streams: RadioVanyaStream[] = [];
  for (const item of items) {
    if (
      item &&
      typeof item === 'object' &&
      typeof item.id === 'number' &&
      typeof item.link === 'string'
    ) {
      streams.push({
        id: item.id,
        link: item.link,
        slug: typeof item.slug === 'string' ? item.slug : undefined
      });
    }
  }

  if (!streams.length) return null;

  radioVanyaCatalogCache = { ts: Date.now(), streams };
  return streams;
};

export const resolveRadioVanyaStreamId = (
  streamUrl: string,
  catalog: RadioVanyaStream[]
): number | null => {
  let parsedTarget: URL;
  try {
    parsedTarget = new URL(streamUrl);
  } catch {
    return null;
  }
  const targetHost = parsedTarget.host.toLowerCase();
  const targetPath = parsedTarget.pathname.replace(/\/+$/, '').toLowerCase();

  for (const entry of catalog) {
    try {
      const parsedEntry = new URL(entry.link);
      const entryHost = parsedEntry.host.toLowerCase();
      const entryPath = parsedEntry.pathname.replace(/\/+$/, '').toLowerCase();
      if (entryHost === targetHost && entryPath === targetPath) {
        return entry.id;
      }
    } catch {
      // ignore malformed catalog entries
    }
  }

  // Fallback: trailing slug match. Catalog links look like
  // ".../rv_90", incoming URLs may be the same with extra
  // trailing path segments or query string.
  for (const entry of catalog) {
    if (!entry.slug) continue;
    const segment = `/${entry.slug.toLowerCase()}`;
    if (targetPath === segment || targetPath.endsWith(segment)) {
      return entry.id;
    }
  }

  return null;
};

const fetchFromRadioVanya = async (
  streamUrl: string,
  options: MediaRouteOptions,
  log: (msg: string) => void
): Promise<string | null> => {
  const catalog = await getRadioVanyaCatalog(options);
  if (!catalog) {
    log('RadioVanya catalog unavailable');
    return null;
  }

  const streamId = resolveRadioVanyaStreamId(streamUrl, catalog);
  if (streamId === null) {
    log(`RadioVanya: no catalog match for ${streamUrl}`);
    return null;
  }

  const playlistUrl = `https://radiovanya.ru/api/v5/playlists/${streamId}/`;
  log(`Trying RadioVanya playlist: ${playlistUrl}`);
  const data = await fetchMetadataPayload(playlistUrl, 'json', options);
  if (!data || typeof data !== 'object') return null;

  const items = (data as any)?.items;
  const first = Array.isArray(items) ? items[0] : null;
  if (!first || typeof first !== 'object') return null;

  const track = (first as any).track;
  if (!track || typeof track !== 'object') return null;

  const title = buildTrackTitle(track.artist?.name, track.name);
  return title;
};

export const createMetadataHandler = (options: MediaRouteOptions) => {
  const guard = new ProtectedMediaRoute<{
    status: number;
    body: Record<string, unknown>;
    cacheTtlMs: number;
  }>({
    routeName: 'metadata',
    maxConcurrency: options.metadataConcurrency || 4,
    sharedMaxConcurrency: options.sharedConcurrency || 8,
    rateLimitPerWindow: options.metadataRateLimitPerWindow || 120,
    rateLimitWindowMs: options.rateLimitWindowMs || 60_000
  });

  return async (req: express.Request, res: express.Response) => {
    const url = req.query.url;
    if (!url || typeof url !== 'string') {
      sendJsonError(res, 400, 'url is required');
      return;
    }

    const validated = await parseAndValidateHttpUrl(url);
    if ('error' in validated) {
      sendJsonError(res, validated.status, validated.error);
      return;
    }

    const cached = metadataCache.get(url);
    if (cached && Date.now() - cached.ts < options.metadataCacheTtlMs) {
      if (cached.result.title) {
        res.json(cached.result);
        return;
      }
      res.status(404).json({ error: 'No metadata found', ...cached.result });
      return;
    }

    const cachedResponse = guard.getCached(url);
    if (cachedResponse) {
      res.status(cachedResponse.status).json(cachedResponse.body);
      return;
    }

    const retryAfter = guard.checkRateLimit(req);
    if (retryAfter !== null) {
      res.setHeader('Retry-After', String(retryAfter));
      sendJsonError(res, 429, 'metadata rate limit exceeded');
      return;
    }

    try {
      const result = await guard.run(url, async () => {
        const metadata = await fetchStreamMetadata(url, options);
        writeMetadataCacheEntry(
          metadataCache,
          url,
          { ts: Date.now(), result: metadata },
          options.metadataCacheTtlMs,
          metadataCacheMaxEntries(options)
        );
        const { title, logs, source } = metadata;

        // Radio Vanya: their playlist API is the AUTHORITATIVE now-playing
        // source (it's what radiovanya.ru itself shows), so prefer it over the
        // generic ICY StreamTitle — several of their mounts (e.g. the main
        // /radiovanya and /rv_Happy_Dance) advertise the station ident
        // "radiovanya.ru" in ICY instead of the track, which would otherwise
        // win the early-return below. Falls back to the ICY title (or the other
        // providers further down) when the playlist yields nothing, so this
        // never makes a station worse than before.
        if (isRadioVanyaUrl(url)) {
          const log = (msg: string) => {
            console.log(`[Metadata] ${msg}`);
            logs.push(msg);
          };
          // Non-fatal: a radiovanya.ru outage must fall back to the ICY title
          // below, never 502 a station that the generic probe already resolved.
          let radioVanyaTitle: string | null = null;
          try {
            radioVanyaTitle = await fetchFromRadioVanya(url, options, log);
          } catch (radioVanyaError) {
            logs.push(
              `RadioVanya playlist lookup failed: ${
                radioVanyaError instanceof Error ? radioVanyaError.message : 'error'
              }`
            );
          }
          if (radioVanyaTitle) {
            logs.push(`Got from RadioVanya playlist API: ${radioVanyaTitle}`);
            const body = { title: radioVanyaTitle, logs, source: 'radiovanya' };
            writeMetadataCacheEntry(
              metadataCache,
              url,
              { ts: Date.now(), result: { title: radioVanyaTitle, logs, source: 'radiovanya' } },
              options.metadataCacheTtlMs,
              metadataCacheMaxEntries(options)
            );
            return {
              status: 200,
              body,
              cacheTtlMs: options.metadataCacheTtlMs
            };
          }
        }

        if (title) {
          return {
            status: 200,
            body: { title, logs, source },
            cacheTtlMs: options.metadataCacheTtlMs
          };
        }

        const oneOhOneChannelId = get101ChannelId(url);
        if (oneOhOneChannelId) {
          logs.push(`Trying 101.ru fallback for ${oneOhOneChannelId}`);
          const oneOhOneTitle = await fetchFrom101Ru(oneOhOneChannelId, options);
          if (oneOhOneTitle) {
            logs.push(`Got from 101.ru: ${oneOhOneTitle}`);
            const body = { title: oneOhOneTitle, logs, source: '101.ru' };
            writeMetadataCacheEntry(
              metadataCache,
              url,
              { ts: Date.now(), result: { title: oneOhOneTitle, logs, source: '101.ru' } },
              options.metadataCacheTtlMs,
              metadataCacheMaxEntries(options)
            );
            return {
              status: 200,
              body,
              cacheTtlMs: options.metadataCacheTtlMs
            };
          }
        }

        const slug = getTopRadioSlug(url);
        if (slug) {
          logs.push(`Trying top-radio.ru fallback for ${slug}`);
          const topRadioTitle = await fetchFromTopRadio(slug, options);
          if (topRadioTitle) {
            logs.push(`Got from top-radio: ${topRadioTitle}`);
            const body = { title: topRadioTitle, logs, source: 'top-radio.ru' };
            writeMetadataCacheEntry(
              metadataCache,
              url,
              { ts: Date.now(), result: { title: topRadioTitle, logs, source: 'top-radio.ru' } },
              options.metadataCacheTtlMs,
              metadataCacheMaxEntries(options)
            );
            return {
              status: 200,
              body,
              cacheTtlMs: options.metadataCacheTtlMs
            };
          }
        }

        return {
          status: 404,
          body: { error: 'No metadata found', logs, source },
          cacheTtlMs: options.metadataNegativeCacheTtlMs || Math.min(5_000, options.metadataCacheTtlMs)
        };
      });

      guard.setCached(url, result, result.cacheTtlMs);
      res.status(result.status).json(result.body);
    } catch (error) {
      if (error instanceof MediaOverloadError) {
        res.setHeader('Retry-After', String(error.retryAfterSec));
        sendJsonError(res, 503, error.message);
        return;
      }
      sendJsonError(res, 502, error instanceof Error ? error.message : 'metadata failed');
    }
  };
};
