import { Buffer } from 'node:buffer';
import { PassThrough, Readable } from 'node:stream';
import type express from 'express';
import type { MediaRouteOptions } from './types.js';
import {
  drainResponseBody,
  fetchUrlCandidates,
  fetchWithDeadline,
  fetchWithTimeout,
  parseAndValidateHttpUrl,
  readBytesWithLimit,
  readTextWithLimit,
  rewriteM3U8,
  sendJsonError
} from './shared.js';
import { MediaOverloadError, ProtectedMediaRoute } from './protection.js';

const proxyTimeoutMs = (options: MediaRouteOptions) => options.upstreamTimeoutMs || 12_000;

/**
 * Tear down the upstream read when the client disconnects mid-stream.
 *
 * A live radio response effectively never ends — the client (skip station, app
 * close, network drop) is what closes `res`. Node's pipe unpipes `res` on that
 * close but never destroys the source, so the upstream connection and the
 * 512KB PassThrough buffer leak until the upstream itself ends (for live radio:
 * never), accumulating per abandoned listen. Destroying the source on a
 * PREMATURE close cancels the upstream web body, which fires the agent-disposal
 * wrapper (shared.ts wrapResponseWithAgentDisposal) and releases the pinned
 * socket. A normal completion (`res.writableEnded`) is left untouched, so the
 * happy path is unchanged.
 */
export const wireClientDisconnectTeardown = (
  res: { writableEnded: boolean; on: (event: 'close', listener: () => void) => void },
  ...streams: Array<{ destroy: () => void }>
) => {
  res.on('close', () => {
    if (res.writableEnded) return;
    for (const stream of streams) {
      stream.destroy();
    }
  });
};

const IMAGE_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const IMAGE_NEGATIVE_CACHE_TTL_MS = 1000 * 60 * 15;
const IMAGE_PROXY_MAX_BYTES = 1024 * 1024 * 2;

type StreamManifestResult = {
  kind: 'manifest';
  status: number;
  body: string;
  cacheTtlMs: number;
  contentType: string;
};

type StreamLiveResult = {
  kind: 'stream';
  status: number;
  body: NonNullable<Response['body']>;
  contentType: string;
  length: string | null;
  contentRange: string | null;
  acceptRanges: string | null;
};

type StreamEmptyResult = {
  kind: 'empty';
  status: number;
  contentType: string;
};

type StreamRouteResult = StreamManifestResult | StreamLiveResult | StreamEmptyResult;

type ImageRouteResult = {
  status: number;
  body: Buffer;
  contentType: string;
  cacheControl: string;
  etag: string | null;
  lastModified: string | null;
  cacheTtlMs: number;
  fallback: boolean;
};

const buildStreamFailurePayload = (
  target: URL,
  error: string,
  {
    failureKind = 'stream-unavailable',
    recoverable = true
  }: {
    failureKind?: 'rate-limited' | 'overloaded' | 'stream-unavailable';
    recoverable?: boolean;
  } = {}
) => ({
  error,
  failureKind,
  recoverable,
  url: target.toString()
});

const sendStreamFailure = (
  res: express.Response,
  status: number,
  target: URL,
  error: string,
  options?: {
    failureKind?: 'rate-limited' | 'overloaded' | 'stream-unavailable';
    recoverable?: boolean;
  }
) => {
  res.status(status).json(buildStreamFailurePayload(target, error, options));
};

const sanitizeArtworkLabel = (value: string) =>
  value
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .slice(0, 14) || 'Radio';

const toArtworkFallback = (target: URL, reason: string): ImageRouteResult => {
  const hostLabel = sanitizeArtworkLabel(target.hostname.split('.')[0] || target.hostname || 'Radio');
  const reasonLabel = sanitizeArtworkLabel(reason);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" role="img" aria-label="${hostLabel}">
  <defs>
    <linearGradient id="bg" x1="0%" x2="100%" y1="0%" y2="100%">
      <stop offset="0%" stop-color="#7ed7ff"/>
      <stop offset="50%" stop-color="#5cccb8"/>
      <stop offset="100%" stop-color="#1b3042"/>
    </linearGradient>
  </defs>
  <rect width="160" height="160" rx="28" fill="url(#bg)"/>
  <circle cx="46" cy="48" r="24" fill="rgba(255,255,255,0.18)"/>
  <circle cx="120" cy="122" r="34" fill="rgba(11,27,41,0.22)"/>
  <rect x="20" y="102" width="120" height="22" rx="11" fill="rgba(7,14,22,0.28)"/>
  <text x="80" y="76" text-anchor="middle" fill="#f5fbff" font-family="Arial, sans-serif" font-size="30" font-weight="700">${hostLabel.slice(0, 6)}</text>
  <text x="80" y="118" text-anchor="middle" fill="rgba(245,251,255,0.82)" font-family="Arial, sans-serif" font-size="11">${reasonLabel.slice(0, 16)}</text>
</svg>`;
  return {
    status: 200,
    body: Buffer.from(svg, 'utf8'),
    contentType: 'image/svg+xml; charset=utf-8',
    cacheControl: 'public, max-age=900, s-maxage=900',
    etag: null,
    lastModified: null,
    cacheTtlMs: IMAGE_NEGATIVE_CACHE_TTL_MS,
    fallback: true
  };
};

const isManifestRequest = (target: URL) => target.pathname.toLowerCase().endsWith('.m3u8');

const isImageContentType = (value: string) =>
  value.startsWith('image/') || value.includes('svg+xml');

const createStreamGuard = (options: MediaRouteOptions) =>
  new ProtectedMediaRoute<StreamRouteResult>({
    routeName: 'stream',
    maxConcurrency: options.streamConcurrency || 6,
    sharedMaxConcurrency: options.sharedConcurrency || 8,
    rateLimitPerWindow: options.streamRateLimitPerWindow || 90,
    rateLimitWindowMs: options.rateLimitWindowMs || 60_000
  });

const createImageGuard = (options: MediaRouteOptions) =>
  new ProtectedMediaRoute<ImageRouteResult>({
    routeName: 'image',
    maxConcurrency: options.imageConcurrency || 8,
    sharedMaxConcurrency: options.sharedConcurrency || 8,
    rateLimitPerWindow: options.imageRateLimitPerWindow || 180,
    rateLimitWindowMs: options.rateLimitWindowMs || 60_000
  });

export const createStreamHandler = (options: MediaRouteOptions) => {
  const guard = createStreamGuard(options);

  return async (req: express.Request, res: express.Response) => {
    const parsed = await parseAndValidateHttpUrl(req.query.url);
    if ('error' in parsed) {
      sendJsonError(res, parsed.status, parsed.error);
      return;
    }

    const retryAfter = guard.checkRateLimit(req);
    if (retryAfter !== null) {
      res.setHeader('Retry-After', String(retryAfter));
      sendStreamFailure(res, 429, parsed.target, 'stream rate limit exceeded', {
        failureKind: 'rate-limited'
      });
      return;
    }

    const range = typeof req.headers.range === 'string' ? req.headers.range : null;
    const manifestKey = !range && isManifestRequest(parsed.target) ? parsed.target.toString() : null;
    const cachedManifest = manifestKey ? guard.getCached(manifestKey) : null;
    if (cachedManifest && cachedManifest.kind === 'manifest') {
      res.status(cachedManifest.status);
      res.setHeader('content-type', cachedManifest.contentType);
      res.setHeader('cache-control', 'no-store');
      res.send(cachedManifest.body);
      return;
    }

    try {
      const result = await guard.run(manifestKey, async () => {
        const headers: Record<string, string> = {
          'User-Agent': options.userAgent
        };
        if (range) {
          headers.Range = range;
        }

        let upstream: Response | null = null;
        let lastError: Error | null = null;
        for (const candidate of fetchUrlCandidates(parsed.target)) {
          try {
            const response = await fetchWithTimeout(
              candidate.toString(),
              { headers },
              proxyTimeoutMs(options)
            );
            if (!response.ok) {
              // Drain the abandoned body so its agent-disposal wrapper closes
              // the pinned socket; dead/redirecting stream URLs are common, and
              // a bare `continue` here leaks an Agent per failed candidate.
              await drainResponseBody(response);
              lastError = new Error(`Upstream ${response.status}`);
              continue;
            }
            upstream = response;
            break;
          } catch (error) {
            lastError = error instanceof Error ? error : new Error('Upstream failed');
          }
        }

        if (!upstream) {
          throw lastError || new Error('Upstream failed');
        }

        const contentType = upstream.headers.get('content-type') || '';
        const proxyBase = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

        if (
          contentType.includes('application/vnd.apple.mpegurl') ||
          isManifestRequest(parsed.target)
        ) {
          const body = await upstream.text();
          return {
            kind: 'manifest',
            status: upstream.status,
            body: rewriteM3U8(body, parsed.target.toString(), proxyBase),
            cacheTtlMs: options.fetchCacheTtlMs || 5_000,
            contentType: 'application/vnd.apple.mpegurl'
          } satisfies StreamManifestResult;
        }

        if (!upstream.body) {
          return {
            kind: 'empty',
            status: 204,
            contentType: contentType || 'application/octet-stream'
          } satisfies StreamEmptyResult;
        }

        return {
          kind: 'stream',
          status: upstream.status,
          body: upstream.body,
          contentType: contentType || 'application/octet-stream',
          length: upstream.headers.get('content-length'),
          contentRange: upstream.headers.get('content-range'),
          acceptRanges: upstream.headers.get('accept-ranges')
        } satisfies StreamLiveResult;
      });

      if (manifestKey && result.kind === 'manifest') {
        guard.setCached(manifestKey, result, result.cacheTtlMs);
      }

      if (result.kind === 'manifest') {
        res.status(result.status);
        res.setHeader('content-type', result.contentType);
        res.setHeader('cache-control', 'no-store');
        res.send(result.body);
        return;
      }

      if (result.kind === 'empty') {
        res.status(result.status);
        res.setHeader('content-type', result.contentType);
        res.end();
        return;
      }

      res.status(result.status);
      if (result.length) res.setHeader('content-length', result.length);
      if (result.contentRange) res.setHeader('content-range', result.contentRange);
      if (result.acceptRanges) res.setHeader('accept-ranges', result.acceptRanges);
      res.setHeader('content-type', result.contentType);
      res.setHeader('cache-control', 'no-store');

      const bufferStream = new PassThrough({
        highWaterMark: 512 * 1024
      });
      const sourceStream = Readable.fromWeb(result.body as any);
      sourceStream.on('error', () => bufferStream.destroy());
      bufferStream.on('error', () => {
        if (!res.writableEnded) {
          res.destroy();
        }
      });
      wireClientDisconnectTeardown(res, sourceStream, bufferStream);
      sourceStream.pipe(bufferStream).pipe(res);
    } catch (error) {
      if (error instanceof MediaOverloadError) {
        res.setHeader('Retry-After', String(error.retryAfterSec));
        sendStreamFailure(res, 503, parsed.target, error.message, {
          failureKind: 'overloaded'
        });
        return;
      }
      sendStreamFailure(
        res,
        502,
        parsed.target,
        error instanceof Error ? error.message : 'stream upstream failed'
      );
    }
  };
};

export const createImageHandler = (options: MediaRouteOptions) => {
  const guard = createImageGuard(options);

  return async (req: express.Request, res: express.Response) => {
    const parsed = await parseAndValidateHttpUrl(req.query.url);
    if ('error' in parsed) {
      sendJsonError(res, parsed.status, parsed.error);
      return;
    }

    const key = parsed.target.toString();
    const cached = guard.getCached(key);
    if (cached) {
      res.status(cached.status);
      res.setHeader('content-type', cached.contentType);
      res.setHeader('content-length', String(cached.body.byteLength));
      res.setHeader('cache-control', cached.cacheControl);
      if (cached.etag) res.setHeader('etag', cached.etag);
      if (cached.lastModified) res.setHeader('last-modified', cached.lastModified);
      if (cached.fallback) {
        res.setHeader('x-radioatlas-fallback', 'artwork-unavailable');
      }
      res.send(cached.body);
      return;
    }

    const retryAfter = guard.checkRateLimit(req);
    if (retryAfter !== null) {
      const fallback = toArtworkFallback(parsed.target, 'rate limit');
      res.setHeader('Retry-After', String(retryAfter));
      res.setHeader('x-radioatlas-fallback', 'artwork-rate-limited');
      res.status(fallback.status);
      res.setHeader('content-type', fallback.contentType);
      res.setHeader('content-length', String(fallback.body.byteLength));
      res.setHeader('cache-control', fallback.cacheControl);
      res.send(fallback.body);
      return;
    }

    try {
      const result = await guard.run(key, async () => {
        let upstream: Response | null = null;
        let lastError: Error | null = null;

        for (const candidate of fetchUrlCandidates(parsed.target)) {
          try {
            const response = await fetchWithTimeout(
              candidate.toString(),
              {
                headers: {
                  'User-Agent': options.userAgent,
                  Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
                }
              },
              proxyTimeoutMs(options)
            );
            if (!response.ok) {
              // Same leak as the stream loop: artwork URLs 404/redirect often,
              // so drain the discarded body to release the pinned Agent.
              await drainResponseBody(response);
              lastError = new Error(`Upstream ${response.status}`);
              continue;
            }
            upstream = response;
            break;
          } catch (error) {
            lastError = error instanceof Error ? error : new Error('Upstream failed');
          }
        }

        if (!upstream) {
          return toArtworkFallback(parsed.target, lastError?.message || 'Artwork missing');
        }

        const contentType = upstream.headers.get('content-type') || '';
        if (!isImageContentType(contentType)) {
          return toArtworkFallback(parsed.target, 'Bad artwork');
        }

        const contentLength = Number(upstream.headers.get('content-length') || 0);
        if (Number.isFinite(contentLength) && contentLength > IMAGE_PROXY_MAX_BYTES) {
          return toArtworkFallback(parsed.target, 'Artwork too large');
        }

        let body: Buffer;
        try {
          // Stream with a hard byte cap instead of arrayBuffer(): a missing or
          // false content-length skips the pre-check above, and an unbounded
          // arrayBuffer() would buffer the whole (possibly huge) body into RAM
          // before any limit — one oversized ?url= could OOM the API.
          body = await readBytesWithLimit(upstream, IMAGE_PROXY_MAX_BYTES);
        } catch {
          return toArtworkFallback(parsed.target, 'Artwork too large');
        }
        if (!body.byteLength) {
          return toArtworkFallback(parsed.target, 'Artwork missing');
        }

        return {
          status: upstream.status,
          body,
          contentType: contentType || 'image/*',
          cacheControl:
            upstream.headers.get('cache-control') ||
            'public, max-age=21600, s-maxage=21600, stale-while-revalidate=86400',
          etag: upstream.headers.get('etag'),
          lastModified: upstream.headers.get('last-modified'),
          cacheTtlMs: IMAGE_CACHE_TTL_MS,
          fallback: false
        } satisfies ImageRouteResult;
      });

      guard.setCached(key, result, result.cacheTtlMs);
      res.status(result.status);
      res.setHeader('content-type', result.contentType);
      res.setHeader('content-length', String(result.body.byteLength));
      res.setHeader('cache-control', result.cacheControl);
      if (result.etag) res.setHeader('etag', result.etag);
      if (result.lastModified) res.setHeader('last-modified', result.lastModified);
      if (result.fallback) {
        res.setHeader('x-radioatlas-fallback', 'artwork-unavailable');
      }
      res.send(result.body);
    } catch (error) {
      const fallback =
        error instanceof MediaOverloadError
          ? toArtworkFallback(parsed.target, 'Busy')
          : toArtworkFallback(parsed.target, error instanceof Error ? error.message : 'Artwork missing');
      if (error instanceof MediaOverloadError) {
        res.setHeader('Retry-After', String(error.retryAfterSec));
      }
      res.setHeader(
        'x-radioatlas-fallback',
        error instanceof MediaOverloadError ? 'artwork-overloaded' : 'artwork-unavailable'
      );
      res.status(fallback.status);
      res.setHeader('content-type', fallback.contentType);
      res.setHeader('content-length', String(fallback.body.byteLength));
      res.setHeader('cache-control', fallback.cacheControl);
      res.send(fallback.body);
    }
  };
};

export const createFetchHandler = (options: MediaRouteOptions) => {
  const guard = new ProtectedMediaRoute<{
    status: number;
    body: string;
    cacheTtlMs: number;
    contentType: string | null;
  }>({
    routeName: 'fetch',
    maxConcurrency: options.fetchConcurrency || 6,
    sharedMaxConcurrency: options.sharedConcurrency || 8,
    rateLimitPerWindow: options.fetchRateLimitPerWindow || 180,
    rateLimitWindowMs: options.rateLimitWindowMs || 60_000
  });

  return async (req: express.Request, res: express.Response) => {
    const parsed = await parseAndValidateHttpUrl(req.query.url);
    if ('error' in parsed) {
      sendJsonError(res, parsed.status, parsed.error);
      return;
    }

    try {
      const key = parsed.target.toString();
      const cached = guard.getCached(key);
      if (cached) {
        res.status(cached.status);
        if (cached.contentType) res.setHeader('content-type', cached.contentType);
        res.send(cached.body);
        return;
      }

      const retryAfter = guard.checkRateLimit(req);
      if (retryAfter !== null) {
        res.setHeader('Retry-After', String(retryAfter));
        sendJsonError(res, 429, 'fetch rate limit exceeded');
        return;
      }

      const result = await guard.run(key, async () => {
        const { response, cleanup } = await fetchWithDeadline(
          key,
          {
            headers: { 'User-Agent': options.userAgent }
          },
          proxyTimeoutMs(options)
        );
        try {
          return {
            status: response.status,
            body: await readTextWithLimit(response, options.fetchResponseLimitBytes),
            cacheTtlMs: response.ok
              ? options.fetchCacheTtlMs || 5_000
              : options.fetchNegativeCacheTtlMs || 2_500,
            contentType: response.headers.get('content-type')
          };
        } finally {
          cleanup();
        }
      });

      guard.setCached(key, result, result.cacheTtlMs);
      res.status(result.status);
      if (result.contentType) res.setHeader('content-type', result.contentType);
      res.send(result.body);
    } catch (error) {
      if (error instanceof MediaOverloadError) {
        res.setHeader('Retry-After', String(error.retryAfterSec));
        sendJsonError(res, 503, error.message);
        return;
      }
      sendJsonError(res, 502, error instanceof Error ? error.message : 'Failed');
    }
  };
};
