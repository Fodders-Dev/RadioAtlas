import type express from 'express';
import {
  createLinkRequest,
  getAccountAuditTrail,
  getAccountByToken,
  unlinkProvider,
  updateAccountAlerts,
  updateAccountCollections,
  updateAccountFollows,
  updateAccountLibrary
} from './accountStore.js';
import { getBearerToken, parseMergeStrategy, toClientProfile } from './routeSupport.js';

export const registerAccountRoutes = (app: express.Express) => {
  app.get('/me', async (req, res) => {
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

    res.json({
      profile: toClientProfile(account),
      auditTrail: await getAccountAuditTrail(account.id)
    });
  });

  app.put('/me/library', async (req, res) => {
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

    const nextAccount = await updateAccountLibrary(account.id, req.body);
    if (!nextAccount) {
      res.status(404).json({ error: 'account not found' });
      return;
    }

    res.json({
      profile: toClientProfile(nextAccount),
      auditTrail: await getAccountAuditTrail(nextAccount.id)
    });
  });

  app.get('/me/entitlements', async (req, res) => {
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
    res.json({
      premiumStatus: account.premiumStatus,
      supporterTier: account.supporterTier,
      entitlements: account.entitlements,
      billingProvider: account.billingProvider
    });
  });

  app.put('/me/collections', async (req, res) => {
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
    const nextAccount = await updateAccountCollections(account.id, req.body?.collections);
    if (!nextAccount) {
      res.status(404).json({ error: 'account not found' });
      return;
    }
    res.json({
      profile: toClientProfile(nextAccount),
      auditTrail: await getAccountAuditTrail(nextAccount.id)
    });
  });

  app.put('/me/follows', async (req, res) => {
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
    const nextAccount = await updateAccountFollows(account.id, {
      followedStations: req.body?.followedStations,
      followedRegions: req.body?.followedRegions
    });
    if (!nextAccount) {
      res.status(404).json({ error: 'account not found' });
      return;
    }
    res.json({
      profile: toClientProfile(nextAccount),
      auditTrail: await getAccountAuditTrail(nextAccount.id)
    });
  });

  app.put('/me/alerts', async (req, res) => {
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
    const nextAccount = await updateAccountAlerts(account.id, req.body?.alerts);
    if (!nextAccount) {
      res.status(404).json({ error: 'account not found' });
      return;
    }
    res.json({
      profile: toClientProfile(nextAccount),
      auditTrail: await getAccountAuditTrail(nextAccount.id)
    });
  });

  app.post('/me/link-request', async (req, res) => {
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

    const request = await createLinkRequest(account.id, parseMergeStrategy(req.body?.mergeStrategy));
    res.json({
      code: request.code,
      mergeStrategy: request.mergeStrategy,
      expiresAt: request.expiresAt,
      auditTrail: await getAccountAuditTrail(account.id)
    });
  });

  app.delete('/me/providers/:kind', async (req, res) => {
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

    const kind = req.params.kind;
    if (kind !== 'telegram' && kind !== 'google' && kind !== 'vk') {
      res.status(400).json({ error: 'provider kind is invalid' });
      return;
    }

    try {
      const nextAccount = await unlinkProvider(account.id, kind);
      if (!nextAccount) {
        res.status(404).json({ error: 'account not found' });
        return;
      }

      res.json({
        profile: toClientProfile(nextAccount),
        auditTrail: await getAccountAuditTrail(nextAccount.id)
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'provider unlink failed' });
    }
  });

  app.get('/me/audit', async (req, res) => {
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

    const limit = Math.max(1, Math.min(Number(req.query.limit || 12), 50));
    res.json({ auditTrail: await getAccountAuditTrail(account.id, limit) });
  });
};
