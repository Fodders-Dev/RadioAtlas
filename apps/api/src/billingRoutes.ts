import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import type express from 'express';
import {
  confirmBillingPurchase,
  createBillingPurchase,
  getAccountAuditTrail,
  getAccountByToken,
  listBillingProducts
} from './accountStore.js';
import { createTelegramInvoiceLink, getBearerToken, toClientProfile } from './routeSupport.js';

const isValidWebhookToken = (expected: string, provided: string | undefined): boolean => {
  if (!expected || !provided) return false;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
};

export const registerBillingRoutes = (
  app: express.Express,
  options: {
    telegramBotToken: string;
    internalWebhookToken: string;
    enableTestAuthFixtures: boolean;
    nodeEnv: string;
  }
) => {
  app.get('/billing/telegram/products', async (_req, res) => {
    res.json({ products: await listBillingProducts() });
  });

  app.post('/billing/telegram/create-invoice', async (req, res) => {
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
    const productId = typeof req.body?.productId === 'string' ? req.body.productId : '';
    const recipientAccountId =
      typeof req.body?.recipientAccountId === 'string' ? req.body.recipientAccountId : null;
    try {
      const product = (await listBillingProducts()).find((candidate) => candidate.id === productId);
      if (!product) {
        res.status(400).json({ error: 'invalid billing product' });
        return;
      }
      const purchase = await createBillingPurchase(account.id, product.id, recipientAccountId);
      if (!purchase) {
        res.status(400).json({ error: 'invalid billing product' });
        return;
      }
      const invoiceLink = await createTelegramInvoiceLink(options.telegramBotToken, {
        title: purchase.product.title,
        description: purchase.product.description,
        payload: purchase.id,
        amount: purchase.product.amount
      });
      res.json({
        purchaseId: purchase.id,
        product: purchase.product,
        invoiceLink
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'invoice creation failed' });
    }
  });

  if (options.enableTestAuthFixtures && options.nodeEnv === 'production') {
    // Defence-in-depth, same shape as authRoutes: refuse to register
    // /test/billing/seed-purchase if a caller bypasses the boot
    // assertion and wires this with enableTestAuthFixtures=true under
    // NODE_ENV=production. Log loudly, do not throw - the real
    // /billing/telegram/* endpoints above must keep serving.
    console.error('test fixtures attempted to wire in production - refusing');
  } else if (options.enableTestAuthFixtures) {
    app.post('/test/billing/seed-purchase', async (req, res) => {
      const accountId = typeof req.body?.accountId === 'string' ? req.body.accountId : '';
      const productIdRaw =
        typeof req.body?.productId === 'string' ? req.body.productId : 'support-small';
      const recipientAccountId =
        typeof req.body?.recipientAccountId === 'string' ? req.body.recipientAccountId : null;
      try {
        const products = await listBillingProducts();
        const product = products.find((candidate) => candidate.id === productIdRaw);
        if (!product) {
          res.status(400).json({ error: 'invalid billing product' });
          return;
        }
        const purchase = await createBillingPurchase(accountId, product.id, recipientAccountId);
        if (!purchase) {
          res.status(400).json({ error: 'invalid billing product' });
          return;
        }
        res.json({ purchaseId: purchase.id, product: purchase.product });
      } catch (err) {
        res
          .status(400)
          .json({ error: err instanceof Error ? err.message : 'seed failed' });
      }
    });
  }

  app.post('/billing/telegram/webhook', async (req, res) => {
    // The webhook is only ever called by our own bot forwarding a Telegram
    // successful_payment update it pulled over its long-poll connection
    // (which is itself authenticated by BOT_TOKEN). The shared secret in
    // X-Internal-Token gates outsiders that try to flip a purchase to paid
    // by guessing or scraping the purchaseId. Empty server-side token is
    // treated as misconfigured and rejects every request.
    const provided = req.header('x-internal-token');
    if (!isValidWebhookToken(options.internalWebhookToken, provided ?? undefined)) {
      res.status(401).json({ error: 'unauthorized webhook' });
      return;
    }
    const purchaseId = typeof req.body?.purchaseId === 'string' ? req.body.purchaseId : '';
    if (!purchaseId) {
      res.status(400).json({ error: 'purchaseId is required' });
      return;
    }
    try {
      const account = await confirmBillingPurchase(
        purchaseId,
        typeof req.body?.telegramChargeId === 'string' ? req.body.telegramChargeId : null
      );
      if (!account) {
        res.status(404).json({ error: 'purchase not found' });
        return;
      }
      res.json({
        profile: toClientProfile(account),
        auditTrail: await getAccountAuditTrail(account.id)
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'billing confirmation failed'
      });
    }
  });
};
