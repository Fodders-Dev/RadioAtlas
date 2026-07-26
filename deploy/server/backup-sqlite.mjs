#!/usr/bin/env node
/**
 * Consistent, verified snapshots of the SQLite stores.
 *
 * WHY THIS EXISTS: `account-store.sqlite` holds accounts, sessions, favourites,
 * playlists, referral links, the audit trail and Telegram Stars purchases — and
 * nothing on the box backed it up. The only timers matching "backup" belong to
 * dpkg and to two neighbouring projects.
 *
 * WHY NOT `cp`: the database runs in WAL mode with a WAL file larger than the
 * database itself, so a plain copy can capture a torn state. `node:sqlite`'s
 * `backup()` is SQLite's online backup API — it produces a consistent snapshot
 * while the API keeps writing.
 *
 * A snapshot nobody has restored is not a backup, so every run reopens what it
 * just wrote, runs `PRAGMA integrity_check`, and counts rows in a table that
 * must never be empty. A failure here is a non-zero exit, not a warning.
 */
import { backup, DatabaseSync } from 'node:sqlite';
import { putObject } from './s3put.mjs';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

const DATA_DIR = process.env.RADIOATLAS_DATA_DIR || '/opt/RadioAtlas/shared/data';
const BACKUP_DIR = process.env.RADIOATLAS_BACKUP_DIR || '/opt/RadioAtlas/backups';
const KEEP = Math.max(1, Number(process.env.RADIOATLAS_BACKUP_KEEP || 14));

/**
 * Off-box replication. A snapshot that shares a disk with its source survives a
 * bad DELETE but not a dead disk, and /opt is already at 92%.
 *
 * Cloudflare R2 by choice: the account already exists (Workers AI generates the
 * scene backgrounds), a year of daily snapshots is ~1.31GB against a 10GB free
 * tier, and R2 charges nothing for egress — which matters precisely when you are
 * restoring. The token must be a SEPARATE, write-scoped one: the existing
 * CLOUDFLARE_API_TOKEN is Workers-AI-only and returns 403 on R2 (verified).
 *
 * Absent config is not an error — it is reported, loudly, every run, so it
 * cannot quietly become permanent.
 */
// Only the two SECRET values need a human. The account id is already in this
// same env file for Workers AI, and the bucket name is ours to choose — asking
// someone to retype either at 2am is just an invitation to typo one of them.
const R2 = {
  accountId: process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || '',
  bucket: process.env.R2_BUCKET || 'radioatlas-backups',
  accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || ''
};
const r2Configured = Object.values(R2).every((value) => value.length > 0);

const replicate = async (gzPath, name) => {
  if (!r2Configured) return 'not-configured';
  const body = await readFile(gzPath);
  const result = await putObject({ ...R2, key: `${name}/${basename(gzPath)}`, body });
  if (!result.ok) {
    throw new Error(`R2 upload failed (${result.status}): ${result.text.slice(0, 160)}`);
  }
  return `replicated ${(body.length / 1024).toFixed(0)}KB`;
};

/** name -> a table that must have rows for the snapshot to be worth keeping. */
const SOURCES = [
  { file: 'account-store.sqlite', sentinelTable: 'accounts' },
  // Regenerable from the harvester, but cheap to keep and annoying to refill.
  { file: 'station-intelligence.sqlite', sentinelTable: null }
];

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

const gzipFile = async (from, to) => {
  await pipeline(createReadStream(from), createGzip({ level: 9 }), createWriteStream(to));
  await unlink(from);
};

const verifySnapshot = (path, sentinelTable) => {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get();
    const verdict = String(integrity?.integrity_check || '');
    if (verdict !== 'ok') {
      throw new Error(`integrity_check said "${verdict}"`);
    }
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name);
    if (tables.length === 0) {
      throw new Error('snapshot has no tables');
    }
    let sentinelRows = null;
    if (sentinelTable) {
      if (!tables.includes(sentinelTable)) {
        throw new Error(`sentinel table ${sentinelTable} is missing from the snapshot`);
      }
      sentinelRows = db.prepare(`SELECT count(*) AS n FROM ${sentinelTable}`).get().n;
      if (sentinelRows === 0) {
        throw new Error(`sentinel table ${sentinelTable} is empty — refusing to call this a backup`);
      }
    }
    return { tables: tables.length, sentinelRows };
  } finally {
    db.close();
  }
};

/**
 * Opening the snapshot to verify it leaves `-wal`/`-shm` beside it. They are
 * empty and harmless, but a restore that copies a stray `-wal` back next to a
 * database is exactly the kind of thing that goes wrong at 3am, so the backup
 * directory keeps only the `.gz` files.
 */
const dropSidecars = async (path) => {
  await Promise.all([
    rm(`${path}-wal`, { force: true }),
    rm(`${path}-shm`, { force: true })
  ]);
};

const pruneOld = async (prefix) => {
  const entries = (await readdir(BACKUP_DIR))
    .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith('.sqlite.gz'))
    .sort();
  const doomed = entries.slice(0, Math.max(0, entries.length - KEEP));
  for (const name of doomed) {
    await rm(join(BACKUP_DIR, name), { force: true });
  }
  return doomed.length;
};

const run = async () => {
  await mkdir(BACKUP_DIR, { recursive: true });
  const at = stamp();
  let failures = 0;

  for (const { file, sentinelTable } of SOURCES) {
    const source = join(DATA_DIR, file);
    const prefix = basename(file, '.sqlite');
    const raw = join(BACKUP_DIR, `${prefix}-${at}.sqlite`);
    const gz = `${raw}.gz`;

    try {
      await stat(source);
    } catch {
      console.log(`skip ${file}: not present at ${source}`);
      continue;
    }

    const db = new DatabaseSync(source, { readOnly: true });
    try {
      await backup(db, raw);
    } finally {
      db.close();
    }

    try {
      const { tables, sentinelRows } = verifySnapshot(raw, sentinelTable);
      await dropSidecars(raw);
      await gzipFile(raw, gz);
      const { size } = await stat(gz);
      const pruned = await pruneOld(prefix);
      const offbox = await replicate(gz, prefix);
      console.log(
        `ok ${file}: ${tables} tables` +
          (sentinelRows === null ? '' : `, ${sentinelTable}=${sentinelRows} rows`) +
          `, ${(size / 1024).toFixed(0)}KB gz` +
          (pruned ? `, pruned ${pruned} old` : '') +
          `, ${offbox}`
      );
    } catch (error) {
      failures += 1;
      await dropSidecars(raw);
      await rm(raw, { force: true });
      console.error(`FAILED ${file}: ${error instanceof Error ? error.message : error}`);
    }
  }

  if (!r2Configured) {
    console.error(
      'WARNING: off-box replication is NOT configured — every copy lives on the same disk as the source. ' +
        'Add R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY to shared/env/api.env (account id and bucket default themselves). ' +
        'See RUNBOOK.md "Backups".'
    );
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
};

await run();
