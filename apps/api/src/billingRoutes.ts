import type express from 'express';
import {
  confirmBillingPurchase,
  createBillingPurchase,
  getAccountAuditTrail,
  getAccountByToken,
  listBillingProducts
} from './accountStore.js';
import { createTelegramInvoiceLink, getBearerToken, toClientProfile } from './routeSupport.js';

export const registerBillingRoutes = (
  app: express.Express,
  options: {
    telegramBotToken: string;
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
      const purchase = await createBillingPurchase(account.id, productId as any, recipientAccountId);
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

  app.post('/billing/telegram/webhook', async (req, res) => {
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
