import type express from 'express';
import { readFile } from 'node:fs/promises';
import { createRenderCache } from './share/storyCardCache.js';
import { renderStoryCard, type StoryCardStation } from './share/storyCard.js';

// T_share_3 (PR-A): GET /share/story/:id.png — public (Telegram fetches it
// server-side for shareToStory). Renders an on-brand 1080×1920 card per station,
// cached + single-flighted. Invalid/unknown ids serve ONE shared pre-rendered
// fallback PNG (never a per-id render → no cheap DoS via random ids), and any
// render-engine failure (e.g. the native resvg binary not resolving on a
// platform) also degrades to the fallback — only this endpoint is affected, not
// boot or other routes.

const STORY_CARD_TTL_MS = 1000 * 60 * 60 * 24 * 3; // 3 days — re-render picks up design/artwork changes
const STORY_CARD_MAX_ENTRIES = 256;
// Long but NOT immutable: the URL has no content hash, so a redesign / artwork
// change must be able to propagate. A few days balances render cost vs freshness.
const STORY_CACHE_CONTROL = `public, max-age=${60 * 60 * 24 * 3}`;

export type ShareRouteDeps = {
  getStationById: (id: string) => Promise<StoryCardStation | null>;
  assetsDir: URL;
  userAgent: string;
};

export const registerShareRoutes = (app: express.Express, deps: ShareRouteDeps) => {
  const renderCache = createRenderCache({
    maxEntries: STORY_CARD_MAX_ENTRIES,
    ttlMs: STORY_CARD_TTL_MS
  });

  let fallbackPng: Buffer | null = null;
  const loadFallback = async () => {
    if (!fallbackPng) {
      fallbackPng = await readFile(new URL('story-fallback.png', deps.assetsDir));
    }
    return fallbackPng;
  };

  const sendPng = (res: express.Response, png: Buffer, fallback: boolean) => {
    res.status(200);
    res.setHeader('content-type', 'image/png');
    res.setHeader('content-length', String(png.byteLength));
    res.setHeader('cache-control', STORY_CACHE_CONTROL);
    if (fallback) res.setHeader('x-radioatlas-fallback', 'story-card');
    res.send(png);
  };

  const serveFallback = async (res: express.Response) => {
    try {
      sendPng(res, await loadFallback(), true);
    } catch {
      // Even the bundled fallback is unreadable → 500, but never crash the route.
      res.status(500).json({ error: 'story card unavailable' });
    }
  };

  app.get('/share/story/:slug', async (req, res) => {
    const id = String(req.params.slug || '').replace(/\.png$/i, '');
    if (!id) {
      await serveFallback(res);
      return;
    }

    let station: StoryCardStation | null = null;
    try {
      station = await deps.getStationById(id);
    } catch {
      station = null;
    }
    // Unknown id → the single static fallback; do NOT render/cache per id.
    if (!station) {
      await serveFallback(res);
      return;
    }

    try {
      const png = await renderCache.resolve(station.stationuuid, () =>
        renderStoryCard(station, { assetsDir: deps.assetsDir, userAgent: deps.userAgent })
      );
      sendPng(res, png, false);
    } catch {
      // Render engine unavailable / render failure → degrade to the fallback.
      await serveFallback(res);
    }
  });
};
