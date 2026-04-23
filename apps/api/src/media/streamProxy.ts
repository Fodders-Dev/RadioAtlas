import { Readable } from 'node:stream';
import type express from 'express';
import type { MediaRouteOptions } from './types.js';
import {
  fetchUrlCandidates,
  fetchWithDeadline,
  fetchWithTimeout,
  parseHttpUrl,
  readTextWithLimit,
  rewriteM3U8,
  sendJsonError
} from './shared.js';
import { MediaOverloadError, ProtectedMediaRoute } from './protection.js';

const proxyTimeoutMs = (options: MediaRouteOptions) => options.upstreamTimeoutMs || 12_000;

export const createStreamHandler = (options: MediaRouteOptions) =>
  async (req: express.Request, res: express.Response) => {
    const parsed = parseHttpUrl(req.query.url);
    if ('error' in parsed) {
      sendJsonError(res, parsed.error === 'url is required' ? 400 : 400, parsed.error);
      return;
    }

    try {
      const range = req.headers.range;
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
        sendJsonError(res, 502, lastError?.message || 'Upstream failed');
        return;
      }

      const contentType = upstream.headers.get('content-type') || '';
      const proxyBase = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

      if (contentType.includes('application/vnd.apple.mpegurl') || parsed.target.pathname.endsWith('.m3u8')) {
        const body = await upstream.text();
        const rewritten = rewriteM3U8(body, parsed.target.toString(), proxyBase);
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

      const bufferStream = new (await import('node:stream')).PassThrough({
        highWaterMark: 512 * 1024
      });
      Readable.fromWeb(upstream.body as any).pipe(bufferStream).pipe(res);
    } catch (error) {
      sendJsonError(res, 502, error instanceof Error ? error.message : 'Failed');
    }
  };

export const createImageHandler = (options: MediaRouteOptions) =>
  async (req: express.Request, res: express.Response) => {
    const parsed = parseHttpUrl(req.query.url);
    if ('error' in parsed) {
      sendJsonError(res, 400, parsed.error);
      return;
    }

    try {
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
        sendJsonError(res, 502, lastError?.message || 'Upstream failed');
        return;
      }

      const contentType = upstream.headers.get('content-type') || 'image/*';
      const cacheControl = upstream.headers.get('cache-control');
      const contentLength = upstream.headers.get('content-length');
      const etag = upstream.headers.get('etag');
      const lastModified = upstream.headers.get('last-modified');

      res.status(upstream.status);
      res.setHeader('content-type', contentType);
      res.setHeader('cache-control', cacheControl || 'public, max-age=21600, s-maxage=21600');
      if (contentLength) res.setHeader('content-length', contentLength);
      if (etag) res.setHeader('etag', etag);
      if (lastModified) res.setHeader('last-modified', lastModified);

      if (!upstream.body) {
        res.status(204).end();
        return;
      }

      Readable.fromWeb(upstream.body as any).pipe(res);
    } catch (error) {
      sendJsonError(res, 502, error instanceof Error ? error.message : 'Failed');
    }
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
    const parsed = parseHttpUrl(req.query.url);
    if ('error' in parsed) {
      sendJsonError(res, 400, parsed.error);
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
