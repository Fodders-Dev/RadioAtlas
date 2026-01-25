import 'dotenv/config';
import express from 'express';
import { Readable } from 'node:stream';

const API_URLS = [
  'https://de1.api.radio-browser.info/json/stations/search',
  'https://nl1.api.radio-browser.info/json/stations/search',
  'https://fr1.api.radio-browser.info/json/stations/search',
  'https://all.api.radio-browser.info/json/stations/search'
];

const USER_AGENT = 'RadioAtlas/1.0';
const CACHE_TTL_MS = 1000 * 60 * 30;
const PAGE_LIMIT = 10000;
const FAST_LIMIT = 10000;
const MAX_PAGES = 5;
const EXTRACTOR_URL = process.env.EXTRACTOR_URL || 'http://127.0.0.1:4001';
const BLOCKED_HOSTS = [
  'youtube.com',
  'youtu.be',
  'music.youtube.com',
  'youtube-nocookie.com'
];

type Station = {
  stationuuid: string;
  name: string;
  url: string;
  url_resolved: string;
  homepage: string;
  favicon: string;
  tags: string;
  country: string;
  countrycode: string;
  state: string;
  language: string;
  codec: string;
  bitrate: number;
  geo_lat: number | null;
  geo_long: number | null;
};

type CacheEntry = {
  ts: number;
  data: Station[];
};

const app = express();
app.set('trust proxy', 1);

const corsHeaders = (res: express.Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Length, Content-Range, Accept-Ranges, Content-Type'
  );
};

app.use((req, res, next) => {
  corsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

let fastCache: CacheEntry | null = null;
let fullCache: CacheEntry | null = null;

const normalizeStation = (raw: Station): Station => ({
  ...raw,
  name: raw.name?.trim() || 'Unknown Station',
  url_resolved: raw.url_resolved || raw.url,
  geo_lat: raw.geo_lat === null ? null : Number(raw.geo_lat),
  geo_long: raw.geo_long === null ? null : Number(raw.geo_long)
});

const getHost = (value: string) => {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return '';
  }
};

const isBlockedHost = (value: string) =>
  BLOCKED_HOSTS.some((host) => getHost(value).includes(host));

const fetchWithTimeout = async (url: string, ms: number) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        'X-User-Agent': USER_AGENT
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
};

const fetchFromEndpoint = async (endpoint: string, limit: number, maxPages: number) => {
  const collected: Station[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(endpoint);
    url.searchParams.set('order', 'clickcount');
    url.searchParams.set('reverse', 'true');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(page * limit));

    const response = await fetchWithTimeout(url.toString(), 8000);
    if (!response.ok) {
      throw new Error(`Radio Browser error: ${response.status}`);
    }
    const raw = (await response.json()) as Station[];
    collected.push(...raw);
    if (raw.length < limit) {
      break;
    }
  }
  return collected;
};

const getCatalog = async (mode: 'fast' | 'full') => {
  const cache = mode === 'fast' ? fastCache : fullCache;
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return cache.data;
  }

  const limit = mode === 'fast' ? FAST_LIMIT : PAGE_LIMIT;
  const maxPages = mode === 'fast' ? 1 : MAX_PAGES;

  let raw: Station[] = [];
  const tasks = API_URLS.map((endpoint) =>
    fetchFromEndpoint(endpoint, limit, maxPages).then((data) => {
      if (!data.length) {
        throw new Error('Empty response');
      }
      return data;
    })
  );

  raw = await Promise.any(tasks);

  const byId = new Map<string, Station>();
  raw.forEach((item) => {
    if (!item?.stationuuid) return;
    if (!byId.has(item.stationuuid)) {
      byId.set(item.stationuuid, item);
    }
  });

  const stations = Array.from(byId.values())
    .map(normalizeStation)
    .filter((station) => Boolean(station.url_resolved));

  const entry = { ts: Date.now(), data: stations };
  if (mode === 'fast') {
    fastCache = entry;
  } else {
    fullCache = entry;
  }
  return stations;
};

const toAbsoluteUrl = (value: string, base: string) => {
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
};

const rewriteM3U8 = (body: string, sourceUrl: string, proxyBase: string) => {
  const lines = body.split('\n');
  const rewritten = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const absolute = toAbsoluteUrl(trimmed, sourceUrl);
    return `${proxyBase}/stream?url=${encodeURIComponent(absolute)}`;
  });
  return rewritten.join('\n');
};

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/catalog', async (req, res) => {
  try {
    const mode = req.query.mode === 'fast' ? 'fast' : 'full';
    const data = await getCatalog(mode);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.get('/stream', async (req, res) => {
  const url = req.query.url;
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'url is required' });
    return;
  }

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    res.status(400).json({ error: 'invalid url' });
    return;
  }

  if (!['http:', 'https:'].includes(target.protocol)) {
    res.status(400).json({ error: 'invalid protocol' });
    return;
  }

  try {
    const range = req.headers.range;
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT
    };
    if (range) {
      headers.Range = range;
    }
    const candidates: URL[] = [];
    if (target.protocol === 'http:') {
      const upgraded = new URL(target.toString());
      upgraded.protocol = 'https:';
      candidates.push(upgraded);
    }
    candidates.push(target);

    let upstream: Response | null = null;
    let lastError: Error | null = null;
    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate.toString(), { headers });
        if (!response.ok) {
          lastError = new Error(`Upstream ${response.status}`);
          continue;
        }
        upstream = response;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error('Upstream failed');
      }
    }

    if (!upstream) {
      res.status(502).json({ error: lastError?.message || 'Upstream failed' });
      return;
    }

    const contentType = upstream.headers.get('content-type') || '';
    const proxyBase =
      process.env.PUBLIC_URL ||
      `${req.protocol}://${req.get('host')}`;

    if (contentType.includes('application/vnd.apple.mpegurl') || target.pathname.endsWith('.m3u8')) {
      const body = await upstream.text();
      const rewritten = rewriteM3U8(body, target.toString(), proxyBase);
      res.setHeader('content-type', 'application/vnd.apple.mpegurl');
      res.send(rewritten);
      return;
    }

    const length = upstream.headers.get('content-length');
    const contentRange = upstream.headers.get('content-range');
    const acceptRanges = upstream.headers.get('accept-ranges');

    res.status(upstream.status);
    if (length) res.setHeader('content-length', length);
    if (contentRange) res.setHeader('content-range', contentRange);
    if (acceptRanges) res.setHeader('accept-ranges', acceptRanges);
    res.setHeader('content-type', contentType || 'application/octet-stream');
    res.setHeader('cache-control', 'no-store');

    if (!upstream.body) {
      res.status(204).end();
      return;
    }

    // Use a PassThrough stream with a buffer (highWaterMark) to smooth out network jitter
    const bufferStream = new (await import('node:stream')).PassThrough({
      highWaterMark: 512 * 1024 // 512KB buffer
    });

    Readable.fromWeb(upstream.body as any).pipe(bufferStream).pipe(res);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

const fetchStreamMetadata = async (url: string): Promise<{ title: string | null; logs: string[] }> => {
  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(`[Metadata] ${msg}`);
    logs.push(msg);
  };

  log(`Fetching: ${url}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      headers: {
        'Icy-MetaData': '1',
        'User-Agent': USER_AGENT
      },
      redirect: 'follow',
      signal: controller.signal
    });

    log(`Status: ${response.status}`);
    const metaintHeader = response.headers.get('icy-metaint');
    log(`MetaInt: ${metaintHeader}`);

    if (!metaintHeader) return { title: null, logs };

    const metaint = Number(metaintHeader);
    if (isNaN(metaint) || metaint <= 0) {
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

      // We need at least metaint + 1 byte (length byte)
      if (buffer.length >= metaint + 1) {
        const lengthByte = buffer[metaint] || 0;
        const metaLen = lengthByte * 16;

        if (metaLen === 0) {
          log('Empty metadata block found');
          return { title: null, logs };
        }

        if (buffer.length >= metaint + 1 + metaLen) {
          const metaBytes = buffer.slice(metaint + 1, metaint + 1 + metaLen);
          const text = new TextDecoder('utf-8').decode(metaBytes);
          log(`Raw meta found`);
          const match = text.match(/StreamTitle='([^']*)'/) || text.match(/StreamTitle=([^;]*)/);
          if (match?.[1]) {
            return { title: match[1].trim(), logs };
          } else {
            log(`StreamTitle not found in: ${text}`);
            return { title: null, logs };
          }
        }
      }

      if (buffer.length > maxBytes) {
        log('Max bytes reached');
        break;
      }
    }

  } catch (e) {
    log(`Error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
  return { title: null, logs };
};

// Top-Radio.ru fallback for Russian stations
const TOP_RADIO_MAPPING: Record<string, string> = {
  'kazak.fm': 'kazak-fm',
  'radio.kazak.fm': 'kazak-fm',
  // Add more Russian stations as needed
};

const getTopRadioSlug = (streamUrl: string): string | null => {
  try {
    const host = new URL(streamUrl).host.toLowerCase();
    for (const [key, slug] of Object.entries(TOP_RADIO_MAPPING)) {
      if (host.includes(key)) {
        return slug;
      }
    }
  } catch { }
  return null;
};

const fetchFromTopRadio = async (slug: string): Promise<string | null> => {
  try {
    // '/web/' pages are more live than '/playlist/' pages which are often cached
    const res = await fetch(`https://top-radio.ru/web/${slug}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });
    if (!res.ok) return null;

    const html = await res.text();

    // Look for the "playlist" section which contains live track data
    // Usually it has a label like "Что сейчас играет:" followed by track items
    const playlistSection = html.match(
      /Плейлист радиостанции[\s\S]*?Что сейчас играет:([\s\S]*?)Весь плей-лист/i
    );
    const contentToSearch = playlistSection?.[1] ?? html;

    // Structure is typically: <a class="artist">Artist</a> <span class="song">Song</span>
    const trackRegex = /class="artist"[^>]*>([^<]+)[\s\S]*?class="song"[^>]*>([^<]+)/gi;
    const matches = [...contentToSearch.matchAll(trackRegex)];

    if (matches.length > 0) {
      const artist = matches[0]?.[1]?.trim?.();
      const song = matches[0]?.[2]?.trim?.();

      if (artist && song) {
        return `${artist} - ${song}`;
      }
    }

    // Fallback if the specific section wasn't found or structure differs
    const fallbackMatch = html.match(
      /class="artist">([^<]+)<\/span>[\s\S]*?class="song">([^<]+)<\/span>/i
    );
    const fallbackArtist = fallbackMatch?.[1]?.trim?.();
    const fallbackSong = fallbackMatch?.[2]?.trim?.();
    if (fallbackArtist && fallbackSong) {
      return `${fallbackArtist} - ${fallbackSong}`;
    }

  } catch (e) {
    console.error(`[TopRadio] Error for ${slug}:`, e);
  }
  return null;
};

app.get('/metadata', async (req, res) => {
  const url = req.query.url;
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'url is required' });
    return;
  }

  const { title, logs } = await fetchStreamMetadata(url);
  if (title) {
    res.json({ title, logs });
    return;
  }

  // Fallback: Try top-radio.ru for Russian stations
  const slug = getTopRadioSlug(url);
  if (slug) {
    logs.push(`Trying top-radio.ru fallback for ${slug}`);
    const topRadioTitle = await fetchFromTopRadio(slug);
    if (topRadioTitle) {
      logs.push(`Got from top-radio: ${topRadioTitle}`);
      res.json({ title: topRadioTitle, logs, source: 'top-radio.ru' });
      return;
    }
  }

  res.status(404).json({ error: 'No metadata found', logs });
});

app.get('/extract', async (req, res) => {
  const url = req.query.url;
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'url is required' });
    return;
  }

  if (isBlockedHost(url)) {
    res.status(403).json({ error: 'blocked host' });
    return;
  }

  try {
    const base = EXTRACTOR_URL.replace(/\/+$/, '');
    const upstream = await fetch(
      `${base}/extract?url=${encodeURIComponent(url)}`,
      {
        headers: { 'User-Agent': USER_AGENT }
      }
    );
    const body = await upstream.text();
    const type = upstream.headers.get('content-type');
    if (type) res.setHeader('content-type', type);
    res.status(upstream.status).send(body);
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Extractor failed'
    });
  }
});

app.get('/fetch', async (req, res) => {
  const url = req.query.url;
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'url is required' });
    return;
  }

  try {
    const target = new URL(url);
    if (!['http:', 'https:'].includes(target.protocol)) {
      res.status(400).json({ error: 'invalid protocol' });
      return;
    }

    const response = await fetch(target.toString(), {
      headers: { 'User-Agent': USER_AGENT }
    });

    // Forward status code
    res.status(response.status);

    // Forward content-type if present
    const type = response.headers.get('content-type');
    if (type) res.setHeader('content-type', type);

    const text = await response.text();
    res.send(text);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  console.log(`RadioAtlas API on ${port}`);
});
