// station-intelligence.sqlite — the foundation of the future "stations DB".
// v1 stores harvested now-playing observations so we can later answer
// "which stations play artist X" and badge whether a station emits track
// titles at all. Same node:sqlite (DatabaseSync) driver as the account store.
//
// PATH SAFETY (mirrors ACCOUNT_STORE_PATH, but STRICTER): the file MUST live in
// shared/data via an ABSOLUTE STATION_INTEL_DB_PATH. A release-relative path is
// wiped by the deploy prune (~5th deploy), silently losing the DB — so a set-
// but-relative path is a hard error (fatal at boot + here).

import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

// 90-day retention on raw observations (the denormalized artist index is kept).
export const OBSERVATION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

const DEFAULT_DB_URL = new URL('../../data/station-intelligence.sqlite', import.meta.url);

// Resolve the DB path, refusing a set-but-relative env (the footgun). Unset →
// a module-relative dev default (production always sets the absolute env).
export const resolveStationIntelDbPath = (): string => {
  const configured = String(process.env.STATION_INTEL_DB_PATH || '').trim();
  if (!configured) return fileURLToPath(DEFAULT_DB_URL);
  if (!isAbsolute(configured)) {
    throw new Error(
      'STATION_INTEL_DB_PATH must be an ABSOLUTE path (a release-relative path is wiped by the deploy prune — like ACCOUNT_STORE_PATH).'
    );
  }
  return configured;
};

type SqliteStatement = {
  run: (...params: unknown[]) => unknown;
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  all: (...params: unknown[]) => Array<Record<string, unknown>>;
};
type SqliteDb = {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
  close?: () => void;
};

export type TrackObservation = {
  stationUuid: string;
  artist: string | null;
  title: string | null;
  rawTitle: string;
  observedAt: number;
};

export type ArtistIndexRow = { artist: string; obsCount: number; lastSeen: number };

export type StationIntelStore = {
  // Records an observation. Consecutive duplicates (same rawTitle as the last
  // one for this station) are NOT re-inserted — returns false in that case.
  recordObservation: (obs: TrackObservation) => boolean;
  lastRawTitle: (stationUuid: string) => string | null;
  // supports_metadata state: null = never checked, 0 = checked / no title,
  // 1 = a real title was seen.
  getSupportsMetadata: (stationUuid: string) => 0 | 1 | null;
  setSupportsMetadata: (
    stationUuid: string,
    value: 0 | 1,
    checkedAt: number,
    titleAt: number | null
  ) => void;
  // station_uuid → last_harvested_at (epoch ms), for all probed stations. Drives
  // least-recently-harvested-first rotation. Never-probed stations are absent.
  harvestedAtMap: () => Map<string, number>;
  topArtists: (stationUuid: string, limit?: number) => ArtistIndexRow[];
  pruneObservations: (now: number, retentionMs?: number) => number;
  close: () => void;
};

// Schema is created in one place so tests (which pass an in-memory DB) and prod
// share it exactly.
export const STATION_INTEL_SCHEMA = `
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS track_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    station_uuid TEXT NOT NULL,
    artist TEXT,
    title TEXT,
    raw_title TEXT NOT NULL,
    observed_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_track_obs_station ON track_observations(station_uuid, observed_at DESC);
  CREATE INDEX IF NOT EXISTS idx_track_obs_observed_at ON track_observations(observed_at);

  CREATE TABLE IF NOT EXISTS station_artist_index (
    station_uuid TEXT NOT NULL,
    artist TEXT NOT NULL,
    obs_count INTEGER NOT NULL DEFAULT 0,
    last_seen INTEGER NOT NULL,
    PRIMARY KEY (station_uuid, artist)
  );
  CREATE INDEX IF NOT EXISTS idx_artist_index_artist ON station_artist_index(artist);

  CREATE TABLE IF NOT EXISTS station_meta_state (
    station_uuid TEXT PRIMARY KEY,
    supports_metadata INTEGER,
    last_checked_at INTEGER,
    last_title_at INTEGER,
    -- Coverage rotation: the epoch-ms of the last probe (with OR without a
    -- title). least-recently-harvested-first ordering reads this so each run
    -- takes a fresh slice and the whole reachable catalog is covered over time.
    last_harvested_at INTEGER
  );
`;

// Bind the store methods to a DatabaseSync-like handle. Exported so tests can
// pass an in-memory `new DatabaseSync(':memory:')`.
export const createStationIntelStore = (db: SqliteDb): StationIntelStore => {
  db.exec(STATION_INTEL_SCHEMA);
  // Migration for DBs created before last_harvested_at existed (#110). ALTER
  // throws "duplicate column" on an already-migrated/fresh table — that's the
  // success path, so swallow it.
  try {
    db.exec(`ALTER TABLE station_meta_state ADD COLUMN last_harvested_at INTEGER`);
  } catch {
    /* column already present */
  }
  // Index AFTER the column is guaranteed to exist (the schema CREATE TABLE has it
  // for fresh DBs; the ALTER adds it to pre-rotation #110 DBs).
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_meta_state_harvested ON station_meta_state(last_harvested_at)`
  );

  const insertObs = db.prepare(
    `INSERT INTO track_observations (station_uuid, artist, title, raw_title, observed_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  const upsertArtist = db.prepare(
    `INSERT INTO station_artist_index (station_uuid, artist, obs_count, last_seen)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(station_uuid, artist)
     DO UPDATE SET obs_count = obs_count + 1, last_seen = excluded.last_seen`
  );
  const lastObsStmt = db.prepare(
    `SELECT raw_title FROM track_observations WHERE station_uuid = ?
     ORDER BY observed_at DESC, id DESC LIMIT 1`
  );
  const getStateStmt = db.prepare(
    `SELECT supports_metadata FROM station_meta_state WHERE station_uuid = ?`
  );
  const setStateStmt = db.prepare(
    `INSERT INTO station_meta_state (station_uuid, supports_metadata, last_checked_at, last_title_at, last_harvested_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(station_uuid)
     DO UPDATE SET supports_metadata = excluded.supports_metadata,
                   last_checked_at = excluded.last_checked_at,
                   last_title_at = COALESCE(excluded.last_title_at, station_meta_state.last_title_at),
                   last_harvested_at = excluded.last_harvested_at`
  );
  const harvestedAtStmt = db.prepare(
    `SELECT station_uuid, last_harvested_at FROM station_meta_state WHERE last_harvested_at IS NOT NULL`
  );
  const topArtistsStmt = db.prepare(
    `SELECT artist, obs_count, last_seen FROM station_artist_index
     WHERE station_uuid = ? ORDER BY obs_count DESC, last_seen DESC LIMIT ?`
  );
  const pruneStmt = db.prepare(`DELETE FROM track_observations WHERE observed_at < ?`);

  const lastRawTitle = (stationUuid: string): string | null => {
    const row = lastObsStmt.get(stationUuid);
    return row && typeof row.raw_title === 'string' ? row.raw_title : null;
  };

  return {
    lastRawTitle,
    recordObservation: (obs) => {
      // Skip a consecutive duplicate (same track still playing) — we don't want
      // a new row every harvest pass.
      if (lastRawTitle(obs.stationUuid) === obs.rawTitle) return false;
      insertObs.run(obs.stationUuid, obs.artist, obs.title, obs.rawTitle, obs.observedAt);
      if (obs.artist) upsertArtist.run(obs.stationUuid, obs.artist, obs.observedAt);
      return true;
    },
    getSupportsMetadata: (stationUuid) => {
      const row = getStateStmt.get(stationUuid);
      if (!row || row.supports_metadata === null || row.supports_metadata === undefined) return null;
      return Number(row.supports_metadata) === 1 ? 1 : 0;
    },
    setSupportsMetadata: (stationUuid, value, checkedAt, titleAt) => {
      // checkedAt IS the probe time → also stamp last_harvested_at (rotation).
      setStateStmt.run(stationUuid, value, checkedAt, titleAt, checkedAt);
    },
    harvestedAtMap: () => {
      const map = new Map<string, number>();
      for (const row of harvestedAtStmt.all()) {
        map.set(String(row.station_uuid), Number(row.last_harvested_at));
      }
      return map;
    },
    topArtists: (stationUuid, limit = 20) =>
      topArtistsStmt.all(stationUuid, limit).map((row) => ({
        artist: String(row.artist),
        obsCount: Number(row.obs_count),
        lastSeen: Number(row.last_seen)
      })),
    pruneObservations: (now, retentionMs = OBSERVATION_RETENTION_MS) => {
      const result = pruneStmt.run(now - retentionMs) as { changes?: number } | undefined;
      return Number(result?.changes ?? 0);
    },
    close: () => db.close?.()
  };
};

// Open (or create) the on-disk store at the resolved absolute path. Lazy
// node:sqlite import keeps it out of the bundled api unless actually used.
export const openStationIntelStore = async (dbPath?: string): Promise<StationIntelStore> => {
  const path = dbPath ?? resolveStationIntelDbPath();
  await mkdir(dirname(path), { recursive: true });
  const sqliteModuleName = 'node:sqlite';
  const sqlite = (await import(sqliteModuleName)) as {
    DatabaseSync: new (path: string) => SqliteDb;
  };
  return createStationIntelStore(new sqlite.DatabaseSync(path));
};
