import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { spawnSync } from 'node:child_process';
import express from 'express';
import { MediaOverloadError, ProtectedMediaRoute } from '../src/media/protection.js';

process.env.ACCOUNT_STORE_PATH = join(
  await mkdtemp(join(tmpdir(), 'radioatlas-collection-share-')),
  'accounts.sqlite'
);

const [{ getDb, saveAccount }, { buildAccountSkeleton, sanitizeLibrary }, { createSessionForAccount, deleteAccountCompletely }, { registerCollectionShareRoutes }] = await Promise.all([
  import('../src/account/core/repository.js'),
  import('../src/account/core/helpers.js'),
  import('../src/accountStore.js'),
  import('../src/collectionShareRoutes.js')
]);

const startServer = async () => {
  const app = express();
  app.use(express.json());
  registerCollectionShareRoutes(app);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, base };
};

const postJson = (url: string, token: string, collection: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ collection })
  });

test('collection share routes publish explicit snapshots with owner and revocation boundaries', async () => {
  const db = await getDb();
  const privateLibrary = sanitizeLibrary({
    favorites: [{ stationuuid: 'private-favorite', name: 'Private', url: 'https://private.invalid' }],
    collections: [{ id: 'mix', name: 'Private mix', stationIds: ['private-station'] }]
  });
  saveAccount(db, buildAccountSkeleton({ id: 'share-owner', library: privateLibrary }));
  saveAccount(db, buildAccountSkeleton({ id: 'share-other' }));
  const ownerToken = await createSessionForAccount('share-owner');
  const otherToken = await createSessionForAccount('share-other');
  const { server, base } = await startServer();
  try {
    const unauthenticated = await fetch(`${base}/me/collection-shares`, { method: 'POST' });
    assert.equal(unauthenticated.status, 401);

    const ids = Array.from({ length: 128 }, (_, i) => `station-${i}`);
    const collection = { id: 'mix', name: '  My mix  ', description: '  Shared note  ', stationIds: ids };
    const published = await postJson(`${base}/me/collection-shares`, ownerToken, collection);
    assert.equal(published.status, 200);
    const publishedBody = await published.json() as { share: Record<string, unknown> };
    const firstShare = publishedBody.share;
    assert.deepEqual(Object.keys(firstShare).sort(), ['collectionId', 'description', 'name', 'stationIds', 'token', 'updatedAt']);
    assert.equal(firstShare.collectionId, 'mix');
    assert.equal(firstShare.name, 'My mix');
    assert.equal(firstShare.description, 'Shared note');
    assert.deepEqual(firstShare.stationIds, ids);
    assert.match(String(firstShare.token), /^[A-Za-z0-9_-]{32}$/);

    const shareToken = String(firstShare.token);
    const publicResponse = await fetch(`${base}/share/collections/${shareToken}`);
    assert.equal(publicResponse.status, 200);
    assert.equal(publicResponse.headers.get('cache-control'), 'no-store');
    const publicBody = await publicResponse.json() as { playlist: Record<string, unknown> };
    assert.deepEqual(Object.keys(publicBody), ['playlist']);
    assert.deepEqual(Object.keys(publicBody.playlist).sort(), ['description', 'name', 'stationIds', 'updatedAt']);
    assert.deepEqual(publicBody.playlist.stationIds, ids);
    assert.equal(JSON.stringify(publicBody).includes('private-favorite'), false);
    assert.equal(JSON.stringify(publicBody).includes(shareToken), false);

    const ownerRead = await fetch(`${base}/me/collection-shares/mix`, {
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    assert.equal(ownerRead.status, 200);
    assert.equal(ownerRead.headers.get('cache-control'), 'no-store');
    assert.equal((await ownerRead.json() as { share: { token: string } }).share.token, shareToken);
    const crossOwnerRead = await fetch(`${base}/me/collection-shares/mix`, {
      headers: { authorization: `Bearer ${otherToken}` }
    });
    assert.equal(crossOwnerRead.status, 404);

    const invalidCases = [
      { ...collection, name: '   ' },
      { ...collection, name: 'x'.repeat(49) },
      { ...collection, description: 'x'.repeat(321) },
      { ...collection, stationIds: [] },
      { ...collection, stationIds: ['ok', 'bad/id'] },
      { ...collection, stationIds: ['same', 'same'] },
      { ...collection, stationIds: Array.from({ length: 129 }, (_, i) => `station-${i}`) },
      { ...collection, unexpected: true }
    ];
    for (const invalid of invalidCases) {
      assert.equal((await postJson(`${base}/me/collection-shares`, ownerToken, invalid)).status, 400);
    }

    const nullableDescription = await postJson(`${base}/me/collection-shares`, ownerToken, {
      id: 'nullable-description', name: 'Another mix', description: null, stationIds: ['one']
    });
    assert.equal(nullableDescription.status, 200);
    assert.equal((await nullableDescription.json() as { share: { description: string } }).share.description, '');

    const updatedIds = ['first', 'second', 'third'];
    const updated = await postJson(`${base}/me/collection-shares`, ownerToken, {
      id: 'mix', name: 'Updated', description: '', stationIds: updatedIds
    });
    const updatedShare = (await updated.json() as { share: { token: string; stationIds: string[]; updatedAt: number } }).share;
    assert.equal(updatedShare.token, shareToken, 'republishing an active collection reuses its token');
    assert.deepEqual(updatedShare.stationIds, updatedIds);
    assert.deepEqual((await (await fetch(`${base}/share/collections/${shareToken}`)).json() as { playlist: { stationIds: string[] } }).playlist.stationIds, updatedIds);

    // Cloud library sync can change the private collection after publishing; the
    // public link remains the exact server-published snapshot.
    const { updateAccountLibrary } = await import('../src/account/core/libraryService.js');
    await updateAccountLibrary('share-owner', { ...privateLibrary, collections: [] });
    assert.deepEqual((await (await fetch(`${base}/share/collections/${shareToken}`)).json() as { playlist: { stationIds: string[] } }).playlist.stationIds, updatedIds);

    const otherDelete = await fetch(`${base}/me/collection-shares/mix`, {
      method: 'DELETE', headers: { authorization: `Bearer ${otherToken}` }
    });
    assert.equal(otherDelete.status, 204);
    assert.equal((await fetch(`${base}/share/collections/${shareToken}`)).status, 200);

    assert.equal((await fetch(`${base}/me/collection-shares/mix`, {
      method: 'DELETE', headers: { authorization: `Bearer ${ownerToken}` }
    })).status, 204);
    assert.equal((await fetch(`${base}/me/collection-shares/mix`, {
      method: 'DELETE', headers: { authorization: `Bearer ${ownerToken}` }
    })).status, 204, 'revocation is idempotent');
    assert.equal((await fetch(`${base}/share/collections/${shareToken}`)).status, 404);
    assert.equal((await fetch(`${base}/share/collections/not-a-token`)).status, 404);

    const republished = await postJson(`${base}/me/collection-shares`, ownerToken, {
      id: 'mix', name: 'New link', description: '', stationIds: ['fresh']
    });
    const nextToken = (await republished.json() as { share: { token: string } }).share.token;
    assert.notEqual(nextToken, shareToken, 'a revoked token is never resurrected');
    assert.equal((await fetch(`${base}/share/collections/${shareToken}`)).status, 404);

    const stored = db.prepare('SELECT payload_json, owner_account_id FROM collection_shares WHERE token = ?').get(nextToken) as { payload_json: string; owner_account_id: string };
    assert.equal(stored.owner_account_id, 'share-owner');
    assert.deepEqual(JSON.parse(stored.payload_json), { id: 'mix', name: 'New link', description: '', stationIds: ['fresh'] });

    // Keep the generated token's shape and database/API checks, but rewrite
    // this isolated fixture row to a valid base64url token beginning with '-'.
    // That makes the child-process argument-boundary case deterministic.
    const childToken = `-${nextToken.slice(1)}`;
    const persisted = await fetch(`${base}/share/collections/${nextToken}`).then((response) => response.json()) as { playlist: { updatedAt: number } };
    db.prepare('UPDATE collection_shares SET token = ? WHERE token = ?').run(childToken, nextToken);
    const childPublic = await fetch(`${base}/share/collections/${childToken}`);
    assert.equal(childPublic.status, 200, 'the rewritten fixture token remains publicly resolvable');

    const childRead = spawnSync(process.execPath, [
      '--import', 'tsx', '--input-type=module', '-e',
      "const { getPublicCollectionShare } = await import('./src/account/core/collectionShareService.ts'); const value = await getPublicCollectionShare(process.argv[1]); process.stdout.write(JSON.stringify(value && { name: value.name, description: value.description, stationIds: value.stationIds, updatedAt: value.updatedAt }));",
      '--', childToken
    ], {
      cwd: new URL('../', import.meta.url),
      env: { ...process.env, ACCOUNT_STORE_PATH: process.env.ACCOUNT_STORE_PATH },
      encoding: 'utf8'
    });
    assert.equal(childRead.status, 0, `fresh-process read failed: ${childRead.stderr}`);
    assert.deepEqual(JSON.parse(childRead.stdout), {
      name: 'New link', description: '', stationIds: ['fresh'], updatedAt: persisted.playlist.updatedAt
    });

    await deleteAccountCompletely('share-owner');
    assert.equal((await fetch(`${base}/share/collections/${childToken}`)).status, 404, 'account deletion cascades to share rows');
    const remaining = db.prepare('SELECT COUNT(*) AS count FROM collection_shares WHERE owner_account_id = ?').get('share-owner') as { count: number | bigint };
    assert.equal(Number(remaining.count), 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('the owner cannot exceed 24 active links, while active republishes remain allowed at the limit', async () => {
  const db = await getDb();
  saveAccount(db, buildAccountSkeleton({ id: 'share-cap-owner' }));
  const token = await createSessionForAccount('share-cap-owner');
  const { server, base } = await startServer();
  try {
    let last: Response | null = null;
    for (let i = 0; i < 24; i += 1) {
      last = await postJson(`${base}/me/collection-shares`, token, {
        id: `mix-${i}`, name: `Mix ${i}`, description: '', stationIds: [`station-${i}`]
      });
      assert.equal(last.status, 200);
    }
    const refresh = await postJson(`${base}/me/collection-shares`, token, {
      id: 'mix-0', name: 'Mix updated', description: '', stationIds: ['new-station']
    });
    assert.equal(refresh.status, 200);
    const rejected = await postJson(`${base}/me/collection-shares`, token, {
      id: 'mix-24', name: 'Too many', description: '', stationIds: ['station-24']
    });
    assert.equal(rejected.status, 409);
    const count = db.prepare('SELECT COUNT(*) AS count FROM collection_shares WHERE owner_account_id = ?').get('share-cap-owner') as { count: number | bigint };
    assert.equal(Number(count.count), 24);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('collection share routes enforce the configured IP rate limit', async () => {
  const previousLimit = process.env.COLLECTION_SHARE_RATE_LIMIT_PER_WINDOW;
  process.env.COLLECTION_SHARE_RATE_LIMIT_PER_WINDOW = '2';
  const db = await getDb();
  saveAccount(db, buildAccountSkeleton({ id: 'share-rate-owner' }));
  const token = await createSessionForAccount('share-rate-owner');
  const { publishCollectionShare } = await import('../src/account/core/collectionShareService.js');
  const share = await publishCollectionShare('share-rate-owner', {
    id: 'rate-mix', name: 'Rate mix', description: '', stationIds: ['station']
  });
  const { server, base } = await startServer();
  process.env.COLLECTION_SHARE_RATE_LIMIT_PER_WINDOW = previousLimit;
  try {
    const first = await fetch(`${base}/share/collections/${share.token}`);
    const second = await fetch(`${base}/share/collections/${share.token}`);
    const limited = await fetch(`${base}/share/collections/${share.token}`);
    const ownerLimited = await fetch(`${base}/me/collection-shares/rate-mix`, {
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(limited.status, 429);
    assert.equal(ownerLimited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('malformed share path escapes return a generic uncached 400 without logging the raw segment', async () => {
  const { server, base } = await startServer();
  const marker = 'SharePrivacyMarker-DoNotLog';
  const logs: string[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
  console.warn = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
  try {
    for (const path of [
      `/share/collections/${marker}%E0%A4%A`,
      `/me/collection-shares/${marker}%E0%A4%A`
    ]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 400);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.text();
      assert.equal(body.includes(marker), false);
      assert.match(body, /invalid collection share path/);
    }
    assert.equal(logs.join('\n').includes(marker), false, 'raw malformed URL segment must never reach console logging');
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('collection share concurrency guard sheds excess work while a slot is held', async () => {
  const guard = new ProtectedMediaRoute<string>({
    routeName: 'collection-share',
    maxConcurrency: 1,
    sharedMaxConcurrency: 8,
    rateLimitPerWindow: 100,
    rateLimitWindowMs: 60_000
  });
  let release!: (value: string) => void;
  const active = guard.run(null, () => new Promise<string>((resolve) => { release = resolve; }));
  await Promise.resolve();
  await assert.rejects(guard.run(null, async () => 'should not run'), MediaOverloadError);
  release('finished');
  assert.equal(await active, 'finished');
});
