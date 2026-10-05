import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAccountSkeleton, sanitizeLibrary } from '../src/account/core/helpers.js';
import { libraryRevision } from '../src/account/core/libraryRevision.js';

test('stale device writes cannot replace the current persisted playlist', async () => {
  process.env.ACCOUNT_STORE_PATH = join(await mkdtemp(join(tmpdir(), 'radioatlas-library-revision-')), 'accounts.sqlite');
  const { getDb, getAccountByIdSync, saveAccount } = await import('../src/account/core/repository.js');
  const { updateAccountLibrary } = await import('../src/account/core/libraryService.js');
  const db = await getDb();
  const collection = { id: 'mix', name: 'Mix', description: '', isPublic: false, pinned: false, createdAt: 1, updatedAt: 1, stationIds: ['a'] };
  const base = sanitizeLibrary({ collections: [collection] });
  saveAccount(db, buildAccountSkeleton({ id: 'listener', library: base }));
  const baseRevision = libraryRevision(base);
  assert.equal(libraryRevision(getAccountByIdSync(db, 'listener')!.library), baseRevision);
  const phone = await updateAccountLibrary('listener', { collections: [{ ...collection, stationIds: ['a', 'phone'] }] }, baseRevision);
  assert.ok(phone);
  assert.notEqual(libraryRevision(phone.library), baseRevision);
  await assert.rejects(updateAccountLibrary('listener', { collections: [{ ...collection, stationIds: ['a', 'desktop'] }] }, baseRevision), { statusCode: 409 });
  assert.deepEqual(getAccountByIdSync(db, 'listener')!.library.collections[0]!.stationIds, ['a', 'phone']);
  const reconciled = await updateAccountLibrary('listener', { collections: [{ ...collection, stationIds: ['a', 'desktop', 'phone'] }] }, libraryRevision(phone.library));
  assert.deepEqual(reconciled!.library.collections[0]!.stationIds, ['a', 'desktop', 'phone']);
  const unchanged = await updateAccountLibrary('listener', reconciled!.library, libraryRevision(reconciled!.library));
  assert.equal(libraryRevision(unchanged!.library), libraryRevision(reconciled!.library));
});

test('library revision is stable across read timestamps and sensitive to saved membership', () => {
  const a = sanitizeLibrary({ favorites: [{ stationuuid: 'one', name: 'One', url: 'https://stream.example.com/one', url_resolved: 'https://stream.example.com/one' }] });
  assert.equal(libraryRevision(a), libraryRevision({ ...a, updatedAt: a.updatedAt + 99_999 }));
  assert.notEqual(libraryRevision(a), libraryRevision(sanitizeLibrary({ favorites: [] })));
});
