import type express from 'express';
import {
  createCatalogService,
  normalizeCatalogText,
  normalizeQuery,
  parseCursor,
  parseLimit,
  type CatalogDependencies
} from './catalog/service.js';

export const registerCatalogRoutes = (
  app: express.Express,
  dependencies: CatalogDependencies
) => {
  const catalog = createCatalogService(dependencies);
  const parseSeed = (value: unknown) => {
    if (typeof value !== 'string') return Date.now();
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now();
  };

  // The bare GET /catalog route used to JSON.stringify the full ~32 MB
  // catalog onto the response in one shot, blocking the event loop and
  // serving as a free DoS amplifier. No webapp / bot / script path ever
  // called it - the audit and code-review (T0.6) confirmed it was dead
  // but dangerous. Removed deliberately. Use the paginated
  // /catalog/summary, /catalog/search, /catalog/areas, /catalog/points,
  // /catalog/areas/:id/stations and /catalog/stations/:id surfaces
  // instead. The catalog.getCatalog method on the service object stays
  // intact because every other route still composes its response on top
  // of it internally.

  app.get('/catalog/summary', async (req, res) => {
    try {
      const seed = parseSeed(req.query.seed);
      res.json(await catalog.getSummary(seed));
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : 'Catalog summary failed' });
    }
  });

  app.get('/catalog/search', async (req, res) => {
    try {
      res.json(
        await catalog.search({
          q: normalizeQuery(req.query.q),
          country: normalizeCatalogText(req.query.country),
          language: normalizeCatalogText(req.query.language),
          tag: normalizeQuery(req.query.tag),
          continent: typeof req.query.continent === 'string' ? req.query.continent : '',
          limit: parseLimit(req.query.limit, 50),
          cursor: parseCursor(req.query.cursor),
          seed: parseSeed(req.query.seed)
        })
      );
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : 'Catalog search failed' });
    }
  });

  app.get('/catalog/areas', async (req, res) => {
    try {
      const zoom = typeof req.query.zoom === 'string' ? Number(req.query.zoom) || 1 : 1;
      res.json(await catalog.listAreas(zoom));
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : 'Catalog areas failed' });
    }
  });

  app.get('/catalog/points', async (_req, res) => {
    try {
      res.set('Cache-Control', 'public, max-age=600');
      res.json(await catalog.listPoints());
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : 'Catalog points failed' });
    }
  });

  app.get('/catalog/areas/:id/stations', async (req, res) => {
    try {
      res.json(
        await catalog.listAreaStations(
          req.params.id,
          parseLimit(req.query.limit, 50),
          parseCursor(req.query.cursor)
        )
      );
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : 'Catalog area stations failed'
      });
    }
  });

  app.get('/catalog/stations/:id', async (req, res) => {
    try {
      res.json({ item: await catalog.getStationById(req.params.id) });
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : 'Catalog station failed' });
    }
  });

  // T_api_bootwarm: hand the service back so index.ts can prime the profiled
  // 'full' catalog at boot (backward-compatible — existing callers ignore it).
  return catalog;
};
