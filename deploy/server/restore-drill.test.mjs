import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * The drill is the thing that runs when a database is already lost, so it gets
 * exercised here against real SQLite files and a stubbed R2 — the one moment to
 * find out it mis-derives a key or calls a truncated download "ok" is now, not
 * during an actual restore.
 */

/** A live store plus the gzipped snapshot the backup job would have written from it. */
const makeFixture = async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'drill-data-'));
  const backupDir = await mkdtemp(join(tmpdir(), 'drill-backups-'));
  const livePath = join(dataDir, 'account-store.sqlite');

  const db = new DatabaseSync(livePath);
  db.exec('CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT)');
  db.exec('CREATE TABLE sessions (id INTEGER PRIMARY KEY)');
  db.exec("INSERT INTO accounts (name) VALUES ('a'), ('b'), ('c')");
  db.exec('INSERT INTO sessions DEFAULT VALUES');
  db.close();

  const snapshotName = 'account-store-2026-07-26T04-20-23.sqlite.gz';
  const gz = gzipSync(await readFile(livePath));
  await writeFile(join(backupDir, snapshotName), gz);

  return { dataDir, backupDir, livePath, snapshotName, gz };
};

/**
 * The script reads its config at import time and runs on import, so each case
 * gets a fresh module instance via a cache-busting query string.
 */
const runDrill = async (caseId, { dataDir, backupDir }, fetchStub) => {
  process.env.RADIOATLAS_DATA_DIR = dataDir;
  process.env.RADIOATLAS_BACKUP_DIR = backupDir;
  process.env.R2_ACCOUNT_ID = 'acct123';
  process.env.R2_BUCKET = 'radioatlas-backups';
  process.env.R2_ACCESS_KEY_ID = 'AKIA_TEST';
  process.env.R2_SECRET_ACCESS_KEY = 'secret';
  process.argv[2] = 'account-store';

  const out = [];
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  const realError = console.error;
  globalThis.fetch = fetchStub;
  console.log = (line) => out.push(String(line));
  console.error = (line) => out.push(String(line));
  try {
    await import(`./restore-drill.mjs?case=${caseId}`);
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
    console.error = realError;
  }
  const failed = process.exitCode === 1;
  process.exitCode = 0;
  return { output: out.join('\n'), failed };
};

const cleanup = ({ dataDir, backupDir }) =>
  Promise.all([rm(dataDir, { recursive: true, force: true }), rm(backupDir, { recursive: true, force: true })]);

test('a good remote copy restores, matches the local snapshot, and is not behind live', async () => {
  const fixture = await makeFixture();
  let requestedUrl = '';
  const { output, failed } = await runDrill(1, fixture, async (url) => {
    requestedUrl = url;
    return { status: 200, ok: true, arrayBuffer: async () => fixture.gz };
  });
  await cleanup(fixture);

  assert.equal(failed, false, output);
  // The key must be derived from the newest local snapshot, no bucket listing.
  assert.equal(
    requestedUrl,
    `https://acct123.r2.cloudflarestorage.com/radioatlas-backups/account-store/${fixture.snapshotName}`,
    `unexpected object requested: ${requestedUrl}`
  );
  assert.match(output, /^ok account-store:/);
  assert.match(output, /byte-identical to local/);
  assert.match(output, /integrity ok, 2 tables, 4 rows, accounts=3/);
  assert.match(output, /0 tables behind live/);
});

test('a copy that is not the snapshot it claims to be fails the drill', async () => {
  const fixture = await makeFixture();
  // Same shape, different contents: a valid gzipped SQLite file with the same
  // tables that simply is not the verified snapshot — the case a
  // does-it-open check would happily wave through.
  const otherDb = join(fixture.dataDir, 'other.sqlite');
  const db = new DatabaseSync(otherDb);
  db.exec('CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT)');
  db.exec('CREATE TABLE sessions (id INTEGER PRIMARY KEY)');
  db.exec("INSERT INTO accounts (name) VALUES ('z')");
  db.exec('INSERT INTO sessions DEFAULT VALUES');
  db.close();
  const impostor = gzipSync(await readFile(otherDb));

  const { output, failed } = await runDrill(2, fixture, async () => ({
    status: 200,
    ok: true,
    arrayBuffer: async () => impostor
  }));
  await cleanup(fixture);

  assert.equal(failed, true);
  assert.match(output, /^FAILED account-store:/);
  assert.match(output, /DIFFERS from the local snapshot/);
});

test('an unreadable copy is reported, not thrown as an unhandled crash', async () => {
  const fixture = await makeFixture();
  // Corrupt on BOTH sides, so the byte-identity check passes and the damage is
  // only discovered at gunzip — the path that used to kill the whole run with a
  // stack trace before any remaining store was drilled.
  const rubbish = Buffer.from('this is not a gzip stream');
  await writeFile(join(fixture.backupDir, fixture.snapshotName), rubbish);

  const { output, failed } = await runDrill(3, fixture, async () => ({
    status: 200,
    ok: true,
    arrayBuffer: async () => rubbish
  }));
  await cleanup(fixture);

  assert.equal(failed, true, output);
  assert.match(output, /^FAILED account-store: unreadable copy:/);
  assert.doesNotMatch(output, /^ok /m);
});

test('an object the bucket will not hand back is a failure, not a silent pass', async () => {
  const fixture = await makeFixture();
  const { output, failed } = await runDrill(4, fixture, async () => ({
    status: 403,
    ok: false,
    text: async () => 'AccessDenied'
  }));
  await cleanup(fixture);

  assert.equal(failed, true);
  assert.match(output, /FAILED account-store: GET account-store\/.*failed \(403\).*AccessDenied/);
});
