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
const FAST_LIMIT = 2000;
const MAX_PAGES = 5;

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
      'User-Agent': USER_AGENT,
      'Icy-MetaData': '1'
    };
    if (range) {
      headers.Range = range;
    }

    const upstream = await fetch(target.toString(), { headers });

    if (!upstream.ok) {
      res.status(upstream.status).end();
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

    Readable.fromWeb(upstream.body as any).pipe(res);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  console.log(`RadioAtlas API on ${port}`);
});
