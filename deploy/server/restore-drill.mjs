#!/usr/bin/env node
/**
 * Pull a backup back out of R2 and prove it restores.
 *
 * WHY THIS EXISTS: `replicated 580KB` in the log is a claim about a PUT, not
 * evidence that anything is recoverable. The bytes could be truncated, signed
 * into the wrong bucket, or gzipped from a torn snapshot, and the nightly job
 * would look identical. A backup nobody has restored is not a backup — so this
 * downloads the real object, gunzips it, opens it, and compares it against the
 * live database table by table.
 *
 * It is READ-ONLY on both sides: it never writes to the live store. The actual
 * restore procedure (stopping the API, moving the file into place, deleting the
 * -wal/-shm sidecars) is in RUNBOOK.md and stays a deliberate human act.
 *
 *   node deploy/server/restore-drill.mjs             # every store
 *   node deploy/server/restore-drill.mjs account-store
 */
import { DatabaseSync } from 'node:sqlite';
import { getObject } from './s3put.mjs';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, readdir, writeFile } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { createGunzip } from 'node:zlib';

const DATA_DIR = process.env.RADIOATLAS_DATA_DIR || '/opt/RadioAtlas/shared/data';
const BACKUP_DIR = process.env.RADIOATLAS_BACKUP_DIR || '/opt/RadioAtlas/backups';

/** Kept identical to backup-sqlite.mjs, so the drill reads what the job wrote. */
const R2 = {
  accountId: process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || '',
  bucket: process.env.R2_BUCKET || 'radioatlas-backups',
  accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || ''
};

const STORES = [
  { prefix: 'account-store', live: 'account-store.sqlite', sentinelTable: 'accounts' },
  { prefix: 'station-intelligence', live: 'station-intelligence.sqlite', sentinelTable: null }
];

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

const rowCounts = (path) => {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);
    return Object.fromEntries(
      tables.map((name) => [name, db.prepare(`SELECT count(*) AS n FROM "${name}"`).get().n])
    );
  } finally {
    db.close();
  }
};

const integrityOf = (path) => {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return String(db.prepare('PRAGMA integrity_check').get()?.integrity_check || '');
  } finally {
    db.close();
  }
};

/**
 * The uploader keys objects as `<prefix>/<basename of the local .gz>`, so the
 * newest local snapshot names the newest remote one. Deriving the key this way
 * keeps the drill working with a token that can only read and write objects —
 * no bucket-listing permission required.
 */
const newestKeyFor = async (prefix) => {
  const names = (await readdir(BACKUP_DIR))
    .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith('.sqlite.gz'))
    .sort();
  const newest = names.at(-1);
  return newest ? { key: `${prefix}/${newest}`, localPath: join(BACKUP_DIR, newest) } : null;
};

const drill = async (store, workDir) => {
  const target = await newestKeyFor(store.prefix);
  if (!target) {
    return { store: store.prefix, ok: false, why: `no local snapshot for ${store.prefix}` };
  }

  const remote = await getObject({ ...R2, key: target.key });
  if (!remote.ok) {
    return {
      store: store.prefix,
      ok: false,
      why: `GET ${target.key} failed (${remote.status}): ${remote.text.slice(0, 160)}`
    };
  }

  // Byte-identical to the local copy means the object in the bucket really is
  // the snapshot that was verified at backup time, not a re-encoded lookalike.
  // Checked first: if this fails, everything below is measuring the wrong file.
  const localBytes = await readFile(target.localPath);
  if (sha256(remote.body) !== sha256(localBytes)) {
    return {
      store: store.prefix,
      ok: false,
      why:
        `${target.key} DIFFERS from the local snapshot ` +
        `(remote ${remote.body.length}B, local ${localBytes.length}B)`
    };
  }

  const gzPath = join(workDir, `${store.prefix}.sqlite.gz`);
  const sqlitePath = join(workDir, `${store.prefix}.sqlite`);
  await writeFile(gzPath, remote.body);
  await pipeline(createReadStream(gzPath), createGunzip(), createWriteStream(sqlitePath));

  const integrity = integrityOf(sqlitePath);
  if (integrity !== 'ok') {
    return { store: store.prefix, ok: false, why: `integrity_check said "${integrity}"` };
  }

  const restored = rowCounts(sqlitePath);
  const live = rowCounts(join(DATA_DIR, store.live));

  const tables = [...new Set([...Object.keys(restored), ...Object.keys(live)])].sort();
  const missing = tables.filter((name) => !(name in restored));
  // Rows written after the snapshot are expected, not a fault — the drill runs
  // against a live database. Anything MISSING from the copy is the real signal.
  const short = tables.filter((name) => name in restored && (restored[name] ?? 0) < (live[name] ?? 0));
  const drift = short.map((name) => `${name} ${restored[name]}/${live[name]}`);

  const sentinelRows = store.sentinelTable ? restored[store.sentinelTable] : null;
  if (store.sentinelTable && !sentinelRows) {
    return { store: store.prefix, ok: false, why: `${store.sentinelTable} is empty in the restored copy` };
  }
  if (missing.length) {
    return { store: store.prefix, ok: false, why: `tables missing from the copy: ${missing.join(', ')}` };
  }

  const total = Object.values(restored).reduce((sum, n) => sum + n, 0);
  return {
    store: store.prefix,
    ok: true,
    why:
      `${target.key}: ${(remote.body.length / 1024).toFixed(0)}KB downloaded` +
      `, byte-identical to local` +
      `, integrity ok, ${tables.length} tables, ${total} rows` +
      (sentinelRows === null ? '' : `, ${store.sentinelTable}=${sentinelRows}`) +
      (drift.length ? `, behind live on: ${drift.join(', ')}` : ', 0 tables behind live')
  };
};

const run = async () => {
  if (!Object.values(R2).every((value) => value.length > 0)) {
    console.error(
      'R2 is not configured — nothing to drill. Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY ' +
        'in shared/env/api.env. See RUNBOOK.md "Backups".'
    );
    process.exitCode = 1;
    return;
  }

  const only = process.argv[2];
  const stores = only ? STORES.filter((s) => s.prefix === only) : STORES;
  if (!stores.length) {
    console.error(`unknown store "${only}" — expected one of: ${STORES.map((s) => s.prefix).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const workDir = await mkdtemp(join(tmpdir(), 'radioatlas-drill-'));
  try {
    let failures = 0;
    for (const store of stores) {
      // A corrupt download makes gunzip throw and SQLite refuse to open the
      // file. That is the drill working, so it has to read as a reported
      // failure — not as an unhandled rejection that kills the run before the
      // remaining stores are checked.
      let result;
      try {
        result = await drill(store, workDir);
      } catch (error) {
        result = {
          store: store.prefix,
          ok: false,
          why: `unreadable copy: ${error instanceof Error ? error.message : error}`
        };
      }
      if (result.ok) {
        console.log(`ok ${result.store}: ${result.why}`);
      } else {
        failures += 1;
        console.error(`FAILED ${result.store}: ${result.why}`);
      }
    }
    if (failures > 0) process.exitCode = 1;
  } finally {
    // Includes the -wal/-shm sidecars that opening the copy leaves behind; a
    // stray -wal next to a restored database is how restores go wrong.
    await rm(workDir, { recursive: true, force: true });
  }
};

await run();
