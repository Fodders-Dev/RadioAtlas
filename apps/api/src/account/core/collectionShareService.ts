import { randomBytes } from 'node:crypto';
import { getDb } from './repository.js';

export type CollectionShareSnapshot = {
  id: string;
  name: string;
  description: string;
  stationIds: string[];
};

export type CollectionShare = CollectionShareSnapshot & {
  token: string;
  updatedAt: number;
};

type CollectionShareRow = {
  token: unknown;
  collection_id: unknown;
  payload_json: unknown;
  updated_at: unknown;
};

const MAX_ACTIVE_SHARES = 24;
const makeToken = () => randomBytes(24).toString('base64url');

const fromRow = (row: CollectionShareRow): CollectionShare | null => {
  try {
    const payload = JSON.parse(String(row.payload_json)) as CollectionShareSnapshot;
    if (
      typeof payload.id !== 'string' ||
      typeof payload.name !== 'string' ||
      typeof payload.description !== 'string' ||
      !Array.isArray(payload.stationIds) ||
      !payload.stationIds.every((id) => typeof id === 'string')
    ) return null;
    return {
      token: String(row.token),
      id: String(row.collection_id),
      name: payload.name,
      description: payload.description,
      stationIds: payload.stationIds,
      updatedAt: Number(row.updated_at)
    };
  } catch {
    return null;
  }
};

const statusError = (message: string, statusCode: number) =>
  Object.assign(new Error(message), { statusCode });

/**
 * Publish an explicit snapshot. This never reads or changes accounts.library_json.
 * The immediate transaction serializes capacity checks and link creation across
 * concurrent requests that share the SQLite store.
 */
export const publishCollectionShare = async (
  ownerAccountId: string,
  snapshot: CollectionShareSnapshot
): Promise<CollectionShare> => {
  const db = await getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(ownerAccountId);
    if (!account) throw statusError('account not found', 404);

    const active = db.prepare(
      `SELECT token, collection_id, payload_json, updated_at FROM collection_shares
       WHERE owner_account_id = ? AND collection_id = ? LIMIT 1`
    ).get(ownerAccountId, snapshot.id) as CollectionShareRow | undefined;

    if (active) {
      const now = Math.max(Date.now(), Number(active.updated_at) + 1);
      db.prepare(
        `UPDATE collection_shares SET payload_json = ?, updated_at = ?
         WHERE token = ? AND owner_account_id = ?`
      ).run(JSON.stringify(snapshot), now, String(active.token), ownerAccountId);
      db.exec('COMMIT');
      return {
        token: String(active.token),
        ...snapshot,
        updatedAt: now
      };
    }

    const now = Date.now();
    const countRow = db.prepare(
      'SELECT COUNT(*) AS count FROM collection_shares WHERE owner_account_id = ?'
    ).get(ownerAccountId) as { count?: number | bigint } | undefined;
    if (Number(countRow?.count ?? 0) >= MAX_ACTIVE_SHARES) {
      throw statusError('active collection share limit reached', 409);
    }

    const token = makeToken();
    db.prepare(
      `INSERT INTO collection_shares
       (token, owner_account_id, collection_id, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(token, ownerAccountId, snapshot.id, JSON.stringify(snapshot), now, now);
    db.exec('COMMIT');
    return { token, ...snapshot, updatedAt: now };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* transaction may already be closed */ }
    throw error;
  }
};

export const getCollectionShareForOwner = async (
  ownerAccountId: string,
  collectionId: string
): Promise<CollectionShare | null> => {
  const db = await getDb();
  const row = db.prepare(
    `SELECT token, collection_id, payload_json, updated_at FROM collection_shares
     WHERE owner_account_id = ? AND collection_id = ? LIMIT 1`
  ).get(ownerAccountId, collectionId) as CollectionShareRow | undefined;
  return row ? fromRow(row) : null;
};

export const revokeCollectionShare = async (
  ownerAccountId: string,
  collectionId: string
): Promise<void> => {
  const db = await getDb();
  // Delete the snapshot so retired payloads cannot accumulate. Tokens are
  // random and are never reissued, so a later publish creates a fresh link.
  db.prepare(
    'DELETE FROM collection_shares WHERE owner_account_id = ? AND collection_id = ?'
  ).run(ownerAccountId, collectionId);
};

export const getPublicCollectionShare = async (token: string): Promise<CollectionShare | null> => {
  const db = await getDb();
  const row = db.prepare(
    `SELECT token, collection_id, payload_json, updated_at FROM collection_shares
     WHERE token = ? LIMIT 1`
  ).get(token) as CollectionShareRow | undefined;
  return row ? fromRow(row) : null;
};
