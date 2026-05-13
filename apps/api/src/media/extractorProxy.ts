import type express from 'express';
import type { MediaRouteOptions } from './types.js';
import { parseAndValidateHttpUrl, sendJsonError } from './shared.js';

export const createExtractorHandler = (options: MediaRouteOptions) =>
  async (req: express.Request, res: express.Response) => {
    const validated = await parseAndValidateHttpUrl(req.query.url);
    if ('error' in validated) {
      sendJsonError(res, validated.status, validated.error);
      return;
    }

    if (!options.extractorUrl.trim()) {
      sendJsonError(res, 503, 'extractor is not configured');
      return;
    }

    try {
      const base = options.extractorUrl.replace(/\/+$/, '');
      const upstream = await fetch(
        `${base}/extract?url=${encodeURIComponent(validated.target.toString())}`,
        {
          headers: { 'User-Agent': options.userAgent }
        }
      );
      const body = await upstream.text();
      const type = upstream.headers.get('content-type');
      if (type) res.setHeader('content-type', type);
      res.status(upstream.status).send(body);
    } catch (error) {
      sendJsonError(res, 502, error instanceof Error ? error.message : 'Extractor failed');
    }
  };
