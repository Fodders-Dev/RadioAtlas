import type express from 'express';
import type { MediaRouteOptions } from './types.js';
import { isBlockedHost, sendJsonError } from './shared.js';

export const createExtractorHandler = (options: MediaRouteOptions) =>
  async (req: express.Request, res: express.Response) => {
    const url = req.query.url;
    if (!url || typeof url !== 'string') {
      sendJsonError(res, 400, 'url is required');
      return;
    }

    if (isBlockedHost(url, options.blockedHosts)) {
      sendJsonError(res, 403, 'blocked host');
      return;
    }

    if (!options.extractorUrl.trim()) {
      sendJsonError(res, 503, 'extractor is not configured');
      return;
    }

    try {
      const base = options.extractorUrl.replace(/\/+$/, '');
      const upstream = await fetch(`${base}/extract?url=${encodeURIComponent(url)}`, {
        headers: { 'User-Agent': options.userAgent }
      });
      const body = await upstream.text();
      const type = upstream.headers.get('content-type');
      if (type) res.setHeader('content-type', type);
      res.status(upstream.status).send(body);
    } catch (error) {
      sendJsonError(res, 502, error instanceof Error ? error.message : 'Extractor failed');
    }
  };
