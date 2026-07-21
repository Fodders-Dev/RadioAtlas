import { timingSafeEqual } from 'node:crypto';
import type express from 'express';
import {
  isValidSceneKey,
  type SceneArtworkExtension,
  type SceneArtworkService,
  type SceneArtworkStation
} from './sceneArtwork.js';

export type SceneArtworkRouteDeps = {
  artwork: SceneArtworkService;
  getStationById: (stationId: string) => Promise<SceneArtworkStation | null>;
  getTrackSignals?: (
    stationIds: readonly string[]
  ) => Promise<Map<string, Pick<SceneArtworkStation, 'recentTracks' | 'topArtists'>>>;
  internalToken?: string | null;
};

const MAX_BATCH_STATIONS = 50;
const MAX_STATION_ID_LENGTH = 200;
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const IMAGE_FILE_PATTERN = /^([a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?)\.(png|jpe?g)$/;

const hasInternalAccess = (candidate: string, configured: string | null | undefined) => {
  const expected = (configured || '').trim();
  if (!expected) return false;
  const supplied = candidate.trim();
  const expectedBytes = Buffer.from(expected, 'utf8');
  const suppliedBytes = Buffer.from(supplied, 'utf8');
  return (
    expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes)
  );
};

const parseStationIds = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BATCH_STATIONS) return null;
  const stationIds: string[] = [];
  const seen = new Set<string>();
  for (const valueItem of value) {
    if (typeof valueItem !== 'string') return null;
    const stationId = valueItem.trim();
    if (!stationId || stationId.length > MAX_STATION_ID_LENGTH) return null;
    if (!seen.has(stationId)) {
      seen.add(stationId);
      stationIds.push(stationId);
    }
  }
  return stationIds;
};

export const registerSceneArtworkRoutes = (
  app: express.Express,
  deps: SceneArtworkRouteDeps
) => {
  // Public metadata is deliberately read-only. Even a crafted query string can
  // only inspect the persistent cache; browser traffic never spends AI quota.
  app.get('/artwork/scene/:stationId', async (req, res) => {
    const stationId = String(req.params.stationId || '').trim();
    if (!stationId || stationId.length > MAX_STATION_ID_LENGTH) {
      res.status(404).json({ error: 'station not found' });
      return;
    }

    let station: SceneArtworkStation | null;
    try {
      station = await deps.getStationById(stationId);
    } catch {
      res.status(503).json({ error: 'catalog unavailable' });
      return;
    }
    if (!station) {
      res.status(404).json({ error: 'station not found' });
      return;
    }

    const result = await deps.artwork.resolve(station, { generate: false });
    res.status(200).json(result);
  });

  // Only a trusted server-side/admin caller may enqueue generation. Unknown
  // station ids are omitted, so random public ids can never mint cache keys or
  // consume the persisted daily allowance.
  app.post('/internal/artwork/scenes/generate', async (req, res) => {
    if (!hasInternalAccess(req.get('x-internal-token') || '', deps.internalToken)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const stationIds = parseStationIds(req.body?.stationIds);
    if (!stationIds) {
      res.status(400).json({ error: `stationIds must contain 1-${MAX_BATCH_STATIONS} ids` });
      return;
    }

    const stations = await Promise.all(
      stationIds.map(async (stationId) => {
        try {
          const station = await deps.getStationById(stationId);
          return station ? { stationId, station } : null;
        } catch {
          return null;
        }
      })
    );
    let trackSignals = new Map<
      string,
      Pick<SceneArtworkStation, 'recentTracks' | 'topArtists'>
    >();
    if (deps.getTrackSignals) {
      try {
        trackSignals = await deps.getTrackSignals(
          stations.flatMap((entry) => (entry ? [entry.stationId] : []))
        );
      } catch {
        // History is enrichment only. A missing/corrupt intelligence DB must not
        // block generation from the station name and curated catalog genres.
      }
    }
    const items = await Promise.all(
      stations
        .filter(
          (entry): entry is { stationId: string; station: SceneArtworkStation } => entry !== null
        )
        .map(async ({ stationId, station }) => ({
          stationId,
          ...(await deps.artwork.resolve(
            { ...station, ...(trackSignals.get(stationId) || {}) },
            { generate: true }
          ))
        }))
    );
    res.status(items.some((item) => item.status === 'queued') ? 202 : 200).json({ items });
  });

  app.get('/artwork/scenes/:file', async (req, res) => {
    const file = String(req.params.file || '');
    const match = IMAGE_FILE_PATTERN.exec(file);
    const sceneKey = match?.[1] || '';
    if (!sceneKey || !isValidSceneKey(sceneKey)) {
      res.status(404).json({ error: 'scene artwork not found' });
      return;
    }
    const extension: SceneArtworkExtension = match?.[2] === 'png' ? 'png' : 'jpg';
    const image = await deps.artwork.readImage(sceneKey, extension);
    if (!image) {
      res.status(404).json({ error: 'scene artwork not found' });
      return;
    }
    res.status(200);
    res.setHeader('content-type', image.mimeType);
    res.setHeader('content-length', String(image.data.byteLength));
    res.setHeader('cache-control', IMMUTABLE_CACHE_CONTROL);
    res.setHeader('x-content-type-options', 'nosniff');
    res.send(image.data);
  });
};
