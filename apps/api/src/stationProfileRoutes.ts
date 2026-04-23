import type express from 'express';
import {
  claimStationForAccount,
  getAccountByToken,
  getStationAnalytics,
  getStationProfile,
  recordPromotionEvent,
  updateStationProfile
} from './accountStore.js';
import { getBearerToken } from './routeSupport.js';

export const registerStationProfileRoutes = (app: express.Express) => {
  app.post('/stations/:id/claim', async (req, res) => {
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'authorization required' });
      return;
    }
    const account = await getAccountByToken(token);
    if (!account) {
      res.status(401).json({ error: 'session is invalid' });
      return;
    }
    try {
      const profile = await claimStationForAccount(account.id, req.params.id, {
        displayName:
          typeof req.body?.displayName === 'string' ? req.body.displayName : 'Claimed station',
        websiteUrl: typeof req.body?.websiteUrl === 'string' ? req.body.websiteUrl : null,
        description: typeof req.body?.description === 'string' ? req.body.description : null,
        artworkUrl: typeof req.body?.artworkUrl === 'string' ? req.body.artworkUrl : null
      });
      res.json({ profile });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'station claim failed' });
    }
  });

  app.get('/stations/:id/profile', async (req, res) => {
    const profile = await getStationProfile(req.params.id);
    if (!profile) {
      res.status(404).json({ error: 'station profile not found' });
      return;
    }
    res.json({ profile });
  });

  app.put('/stations/:id/profile', async (req, res) => {
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'authorization required' });
      return;
    }
    const account = await getAccountByToken(token);
    if (!account) {
      res.status(401).json({ error: 'session is invalid' });
      return;
    }
    try {
      const profile = await updateStationProfile(account.id, req.params.id, {
        displayName: req.body?.displayName,
        description: req.body?.description,
        artworkUrl: req.body?.artworkUrl,
        websiteUrl: req.body?.websiteUrl,
        scheduleNote: req.body?.scheduleNote,
        editorialPitch: req.body?.editorialPitch,
        socialLinks: req.body?.socialLinks,
        isPromoted: req.body?.isPromoted,
        promotedUntil: req.body?.promotedUntil
      });
      res.json({ profile });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'station profile update failed'
      });
    }
  });

  app.get('/stations/:id/analytics', async (req, res) => {
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'authorization required' });
      return;
    }
    const account = await getAccountByToken(token);
    if (!account) {
      res.status(401).json({ error: 'session is invalid' });
      return;
    }
    try {
      res.json({ analytics: await getStationAnalytics(account.id, req.params.id) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'station analytics failed' });
    }
  });

  app.post('/promotions/impression', async (req, res) => {
    const stationuuid = typeof req.body?.stationuuid === 'string' ? req.body.stationuuid : '';
    if (!stationuuid) {
      res.status(400).json({ error: 'stationuuid is required' });
      return;
    }
    const token = getBearerToken(req);
    const account = token ? await getAccountByToken(token) : null;
    await recordPromotionEvent(
      stationuuid,
      'impression',
      typeof req.body?.sourceId === 'string' ? req.body.sourceId : null,
      account?.id || null
    );
    res.json({ ok: true });
  });

  app.post('/promotions/click', async (req, res) => {
    const stationuuid = typeof req.body?.stationuuid === 'string' ? req.body.stationuuid : '';
    if (!stationuuid) {
      res.status(400).json({ error: 'stationuuid is required' });
      return;
    }
    const token = getBearerToken(req);
    const account = token ? await getAccountByToken(token) : null;
    await recordPromotionEvent(
      stationuuid,
      'click',
      typeof req.body?.sourceId === 'string' ? req.body.sourceId : null,
      account?.id || null
    );
    res.json({ ok: true });
  });
};
