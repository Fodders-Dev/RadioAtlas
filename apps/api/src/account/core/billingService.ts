import { randomUUID } from 'node:crypto';
import type { BillingProduct, BillingProductId, BillingPurchase } from './types.js';
import {
  BILLING_PRODUCTS,
  PREMIUM_ENTITLEMENTS,
  SUPPORTER_ENTITLEMENTS,
  safeNumber,
  safeText
} from './helpers.js';
import {
  applyEntitlementPreset,
  getAccountByIdSync,
  getBillingProductById,
  getDb,
  recordAuditEventSync,
  saveAccount
} from './repository.js';

export const listBillingProducts = async () => BILLING_PRODUCTS;

export const createBillingPurchase = async (
  accountId: string,
  productId: BillingProductId,
  recipientAccountId?: string | null
) => {
  const db = await getDb();
  const account = getAccountByIdSync(db, accountId);
  const product = getBillingProductById(productId);
  if (!account || !product) return null;
  const purchaseId = randomUUID();
  const payload = JSON.stringify({
    purchaseId,
    accountId,
    recipientAccountId: recipientAccountId || null,
    productId
  });
  const now = Date.now();
  db.prepare(`
    INSERT INTO billing_purchases (
      id, account_id, recipient_account_id, product_id, kind, amount, currency, status, provider,
      payload, telegram_charge_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    purchaseId,
    accountId,
    recipientAccountId || null,
    product.id,
    product.kind,
    product.amount,
    product.currency,
    'pending',
    'telegram-stars',
    payload,
    null,
    now,
    now
  );
  recordAuditEventSync(db, accountId, 'billing_purchase_created', {
    purchaseId,
    productId: product.id,
    amount: product.amount,
    kind: product.kind
  });
  return {
    id: purchaseId,
    accountId,
    recipientAccountId: recipientAccountId || null,
    product
  };
};

export const confirmBillingPurchase = async (
  purchaseId: string,
  telegramChargeId?: string | null
) => {
  const db = await getDb();
  const row = db.prepare('SELECT * FROM billing_purchases WHERE id = ? LIMIT 1').get(purchaseId);
  if (!row) return null;
  const purchase: BillingPurchase = {
    id: String(row.id),
    accountId: String(row.account_id),
    recipientAccountId: safeText(row.recipient_account_id) || null,
    productId: safeText(row.product_id) as BillingProductId,
    kind: safeText(row.kind) as BillingProduct['kind'],
    amount: safeNumber(row.amount) ?? 0,
    currency: 'XTR',
    status: safeText(row.status) as BillingPurchase['status'],
    provider: 'telegram-stars',
    payload: safeText(row.payload),
    telegramChargeId: safeText(row.telegram_charge_id) || null,
    createdAt: safeNumber(row.created_at) ?? Date.now(),
    updatedAt: safeNumber(row.updated_at) ?? Date.now()
  };
  const targetAccountId = purchase.recipientAccountId || purchase.accountId;

  if (purchase.status === 'paid') {
    return getAccountByIdSync(db, targetAccountId);
  }

  // Atomic flip: only the caller whose UPDATE actually changed the row
  // gets to grant entitlements / write the audit event. A second caller
  // on the same purchaseId (Telegram retry, bot restart) sees changes=0
  // and falls through to the idempotent return path. SQLite serialises
  // UPDATEs even in WAL mode, so this also protects against multi-process
  // deployments down the road.
  const updateResult = db
    .prepare(`
      UPDATE billing_purchases
      SET status = 'paid', telegram_charge_id = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'
    `)
    .run(telegramChargeId || null, Date.now(), purchaseId) as
    | { changes?: number | bigint }
    | undefined;

  if (Number(updateResult?.changes ?? 0) === 0) {
    return getAccountByIdSync(db, targetAccountId);
  }

  const targetAccount = getAccountByIdSync(db, targetAccountId);
  if (!targetAccount) return null;

  let nextAccount = targetAccount;
  if (purchase.productId === 'premium-month' || purchase.productId === 'premium-year' || purchase.productId === 'premium-gift') {
    nextAccount = applyEntitlementPreset(
      targetAccount,
      'premium',
      targetAccount.supporterTier === 'patron' ? 'patron' : 'supporter',
      [...targetAccount.entitlements, ...PREMIUM_ENTITLEMENTS],
      'telegram-stars'
    );
  } else {
    nextAccount = applyEntitlementPreset(
      targetAccount,
      targetAccount.premiumStatus === 'premium' ? 'premium' : 'supporter',
      purchase.productId === 'support-big' ? 'patron' : 'supporter',
      [...targetAccount.entitlements, ...SUPPORTER_ENTITLEMENTS],
      'telegram-stars'
    );
  }

  saveAccount(db, nextAccount);
  recordAuditEventSync(db, targetAccountId, 'billing_purchase_confirmed', {
    purchaseId,
    productId: purchase.productId,
    amount: purchase.amount
  });
  return getAccountByIdSync(db, targetAccountId);
};
