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

  app.get('/catalog', async (req, res) => {
    try {
      const mode = req.query.mode === 'fast' ? 'fast' : 'full';
      res.json(await catalog.getCatalog(mode));
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : 'Failed' });
    }
  });

  app.get('/catalog/summary', async (req, res) => {
    try {
      const seed = typeof req.query.seed === 'string' ? Number(req.query.seed) || Date.now() : Date.now();
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
          cursor: parseCursor(req.query.cursor)
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
};
