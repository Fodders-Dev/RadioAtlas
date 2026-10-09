import type express from 'express';
import { getAccountByToken } from './accountStore.js';
import {
  getCollectionShareForOwner,
  getPublicCollectionShare,
  publishCollectionShare,
  revokeCollectionShare,
  type CollectionShare,
  type CollectionShareSnapshot
} from './account/core/collectionShareService.js';
import { MediaOverloadError, ProtectedMediaRoute } from './media/protection.js';
import { getBearerToken } from './routeSupport.js';

const STATION_ID = /^[a-zA-Z0-9._:-]{1,160}$/;
const COLLECTION_ID = /^[a-zA-Z0-9._:-]{1,160}$/;
const SHARE_TOKEN = /^[A-Za-z0-9_-]{32}$/;
const NO_STORE = 'no-store';

const parseSnapshot = (value: unknown): CollectionShareSnapshot | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const collection = value as Record<string, unknown>;
  const allowed = new Set(['id', 'name', 'description', 'stationIds']);
  if (Object.keys(collection).some((key) => !allowed.has(key))) return null;
  if (typeof collection.id !== 'string' || !COLLECTION_ID.test(collection.id)) return null;
  if (typeof collection.name !== 'string') return null;
  const name = collection.name.trim();
  if (name.length < 1 || name.length > 48) return null;
  if (collection.description !== null && typeof collection.description !== 'string') return null;
  const description = typeof collection.description === 'string' ? collection.description.trim() : '';
  if (description.length > 320) return null;
  if (!Array.isArray(collection.stationIds) || collection.stationIds.length < 1 || collection.stationIds.length > 128) return null;
  const stationIds = collection.stationIds;
  if (!stationIds.every((id) => typeof id === 'string' && STATION_ID.test(id))) return null;
  if (new Set(stationIds).size !== stationIds.length) return null;
  return { id: collection.id, name, description, stationIds: [...stationIds] as string[] };
};

const managerShare = (share: CollectionShare) => ({
  token: share.token,
  collectionId: share.id,
  name: share.name,
  description: share.description,
  stationIds: share.stationIds,
  updatedAt: share.updatedAt
});

const statusCodeOf = (error: unknown) =>
  typeof error === 'object' && error !== null && 'statusCode' in error
    ? Number((error as { statusCode?: unknown }).statusCode)
    : 0;

export const registerCollectionShareRoutes = (app: express.Express) => {
  const guard = new ProtectedMediaRoute<CollectionShare | null>({
    routeName: 'collection-share',
    maxConcurrency: Number(process.env.COLLECTION_SHARE_CONCURRENCY || 4),
    sharedMaxConcurrency: Number(process.env.MEDIA_SHARED_CONCURRENCY || 8),
    rateLimitPerWindow: Number(process.env.COLLECTION_SHARE_RATE_LIMIT_PER_WINDOW || 90),
    rateLimitWindowMs: Number(process.env.MEDIA_RATE_LIMIT_WINDOW_MS || 60_000),
    maxRateLimitKeys: 10_000
  });

  const rateLimited = (req: express.Request, res: express.Response) => {
    const retryAfter = guard.checkRateLimit(req);
    if (retryAfter === null) return false;
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({ error: 'collection share rate limit exceeded' });
    return true;
  };

  const guarded = (task: () => Promise<CollectionShare | null | void>) =>
    guard.run(null, async () => {
      try {
        return await task() || null;
      } catch (error) {
        const status = statusCodeOf(error);
        if (status === 409 || status === 404) {
          throw Object.assign(
            new Error(status === 409 ? 'share capacity reached' : 'account not found'),
            { statusCode: status }
          );
        }
        // ProtectedMediaRoute records failure reasons in persistent counters.
        // Keep SQLite/provider details out of those metrics as well as responses.
        throw new Error('collection share operation failed');
      }
    });

  app.post('/me/collection-shares', async (req, res) => {
    res.setHeader('Cache-Control', NO_STORE);
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'authorization required' });
      return;
    }
    const account = await getAccountByToken(token).catch(() => null);
    if (!account) {
      res.status(401).json({ error: 'session is invalid' });
      return;
    }
    if (rateLimited(req, res)) return;
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !('collection' in body)) {
      res.status(400).json({ error: 'invalid collection snapshot' });
      return;
    }
    const snapshot = parseSnapshot((body as { collection?: unknown }).collection);
    if (!snapshot) {
      res.status(400).json({ error: 'invalid collection snapshot' });
      return;
    }
    try {
      const share = await guarded(() => publishCollectionShare(account.id, snapshot));
      if (!share) {
        res.status(500).json({ error: 'collection share unavailable' });
        return;
      }
      res.json({ share: managerShare(share) });
    } catch (error) {
      if (error instanceof MediaOverloadError) {
        res.setHeader('Retry-After', String(error.retryAfterSec));
        res.status(503).json({ error: 'collection share service is busy' });
        return;
      }
      const status = statusCodeOf(error);
      if (status === 409 || status === 404) {
        res.status(status).json({ error: status === 409 ? 'active collection share limit reached' : 'account not found' });
        return;
      }
      res.status(500).json({ error: 'collection share unavailable' });
    }
  });

  app.get('/me/collection-shares/:collectionId', async (req, res) => {
    res.setHeader('Cache-Control', NO_STORE);
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'authorization required' });
      return;
    }
    const account = await getAccountByToken(token).catch(() => null);
    if (!account) {
      res.status(401).json({ error: 'session is invalid' });
      return;
    }
    if (rateLimited(req, res)) return;
    const collectionId = String(req.params.collectionId || '');
    if (!COLLECTION_ID.test(collectionId)) {
      res.status(404).json({ error: 'collection share not found' });
      return;
    }
    try {
      const share = await guarded(() => getCollectionShareForOwner(account.id, collectionId));
      if (!share) {
        res.status(404).json({ error: 'collection share not found' });
        return;
      }
      res.json({ share: managerShare(share) });
    } catch (error) {
      if (error instanceof MediaOverloadError) {
        res.setHeader('Retry-After', String(error.retryAfterSec));
        res.status(503).json({ error: 'collection share service is busy' });
        return;
      }
      res.status(500).json({ error: 'collection share unavailable' });
    }
  });

  app.delete('/me/collection-shares/:collectionId', async (req, res) => {
    res.setHeader('Cache-Control', NO_STORE);
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'authorization required' });
      return;
    }
    const account = await getAccountByToken(token).catch(() => null);
    if (!account) {
      res.status(401).json({ error: 'session is invalid' });
      return;
    }
    if (rateLimited(req, res)) return;
    const collectionId = String(req.params.collectionId || '');
    if (!COLLECTION_ID.test(collectionId)) {
      res.status(204).end();
      return;
    }
    try {
      await guarded(() => revokeCollectionShare(account.id, collectionId));
      res.status(204).end();
    } catch (error) {
      if (error instanceof MediaOverloadError) {
        res.setHeader('Retry-After', String(error.retryAfterSec));
        res.status(503).json({ error: 'collection share service is busy' });
        return;
      }
      res.status(500).json({ error: 'collection share unavailable' });
    }
  });

  app.get('/share/collections/:token', async (req, res) => {
    res.setHeader('Cache-Control', NO_STORE);
    const token = String(req.params.token || '');
    if (!SHARE_TOKEN.test(token)) {
      res.status(404).json({ error: 'collection share not found' });
      return;
    }
    if (rateLimited(req, res)) return;
    try {
      const share = await guarded(() => getPublicCollectionShare(token));
      if (!share) {
        res.status(404).json({ error: 'collection share not found' });
        return;
      }
      res.json({
        playlist: {
          name: share.name,
          description: share.description,
          stationIds: share.stationIds,
          updatedAt: share.updatedAt
        }
      });
    } catch (error) {
      if (error instanceof MediaOverloadError) {
        res.setHeader('Retry-After', String(error.retryAfterSec));
        res.status(503).json({ error: 'collection share service is busy' });
        return;
      }
      res.status(500).json({ error: 'collection share unavailable' });
    }
  });

  // Express decodes route parameters before entering the handlers above. A bad
  // percent-encoded token/id therefore bypasses their generic responses and
  // reaches finalhandler, which logs the URIError (including the raw segment).
  // Catch only these decoding errors under the two share URL prefixes; leave
  // every unrelated application error on Express's existing path.
  app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    const sharePath = /^\/(?:share\/collections|me\/collection-shares)(?:\/|$)/i.test(req.path);
    if (error instanceof URIError && sharePath) {
      res.setHeader('Cache-Control', NO_STORE);
      res.status(400).json({ error: 'invalid collection share path' });
      return;
    }
    next(error);
  });
};
