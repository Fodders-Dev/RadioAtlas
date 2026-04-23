import type { AccountAuditEventType, AccountProvider } from './types.js';
import { AUDIT_LIMIT_DEFAULT, mapAuditEvent } from './helpers.js';
import { getDb, recordAuditEventSync } from './repository.js';

export const recordAccountEvent = async (
  accountId: string,
  type: AccountAuditEventType,
  payload: Record<string, unknown> = {},
  provider?: Pick<AccountProvider, 'kind' | 'externalId'>
) => {
  const db = await getDb();
  recordAuditEventSync(db, accountId, type, payload, provider);
};

export const getAccountAuditTrail = async (accountId: string, limit = AUDIT_LIMIT_DEFAULT) => {
  const db = await getDb();
  const safeLimit = Math.max(1, Math.min(limit, 50));
  return db
    .prepare(`
      SELECT *
      FROM audit_events
      WHERE account_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(accountId, safeLimit)
    .map(mapAuditEvent);
};
