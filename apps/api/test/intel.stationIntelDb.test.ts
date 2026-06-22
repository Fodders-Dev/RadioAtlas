import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  OBSERVATION_RETENTION_MS,
  createStationIntelStore,
  resolveStationIntelDbPath
} from '../src/intel/stationIntelDb.js';

const memStore = () => createStationIntelStore(new DatabaseSync(':memory:'));

test('recordObservation inserts a row and upserts the artist index', () => {
  const store = memStore();
  store.recordObservation({ stationUuid: 's1', artist: 'Daft Punk', title: 'Aerodynamic', rawTitle: 'Daft Punk - Aerodynamic', observedAt: 100 });
  store.recordObservation({ stationUuid: 's1', artist: 'Daft Punk', title: 'Da Funk', rawTitle: 'Daft Punk - Da Funk', observedAt: 200 });
  store.recordObservation({ stationUuid: 's1', artist: 'Justice', title: 'Genesis', rawTitle: 'Justice - Genesis', observedAt: 300 });

  const artists = store.topArtists('s1');
  assert.equal(artists[0]?.artist, 'Daft Punk');
  assert.equal(artists[0]?.obsCount, 2); // upserted twice
  assert.equal(artists[0]?.lastSeen, 200);
  assert.equal(artists[1]?.artist, 'Justice');
  assert.equal(artists[1]?.obsCount, 1);
  store.close();
});

test('recordObservation dedups a CONSECUTIVE duplicate (same track still playing)', () => {
  const store = memStore();
  assert.equal(store.recordObservation({ stationUuid: 's1', artist: 'A', title: 'B', rawTitle: 'A - B', observedAt: 1 }), true);
  // same rawTitle again immediately → not re-recorded
  assert.equal(store.recordObservation({ stationUuid: 's1', artist: 'A', title: 'B', rawTitle: 'A - B', observedAt: 2 }), false);
  // a different track → recorded
  assert.equal(store.recordObservation({ stationUuid: 's1', artist: 'A', title: 'C', rawTitle: 'A - C', observedAt: 3 }), true);
  // back to the first track (no longer consecutive) → recorded again
  assert.equal(store.recordObservation({ stationUuid: 's1', artist: 'A', title: 'B', rawTitle: 'A - B', observedAt: 4 }), true);

  // 'A' seen 3 distinct times (the consecutive dup was skipped).
  assert.equal(store.topArtists('s1').find((a) => a.artist === 'A')?.obsCount, 3);
  store.close();
});

test('supports_metadata is NULL until checked, then 0/1', () => {
  const store = memStore();
  assert.equal(store.getSupportsMetadata('new'), null);
  store.setSupportsMetadata('new', 0, 1000, null);
  assert.equal(store.getSupportsMetadata('new'), 0);
  store.setSupportsMetadata('new', 1, 2000, 2000);
  assert.equal(store.getSupportsMetadata('new'), 1);
  store.close();
});

test('pruneObservations deletes only rows older than the retention window', () => {
  const store = memStore();
  const now = 1_000_000_000_000;
  store.recordObservation({ stationUuid: 's', artist: 'A', title: 'old', rawTitle: 'A - old', observedAt: now - OBSERVATION_RETENTION_MS - 1 });
  store.recordObservation({ stationUuid: 's', artist: 'A', title: 'recent', rawTitle: 'A - recent', observedAt: now - 1000 });

  const deleted = store.pruneObservations(now);
  assert.equal(deleted, 1);
  // The recent row survives → it's still the last raw title.
  assert.equal(store.lastRawTitle('s'), 'A - recent');
  store.close();
});

test('resolveStationIntelDbPath rejects a set-but-relative path (the prune footgun)', () => {
  const saved = process.env.STATION_INTEL_DB_PATH;
  try {
    process.env.STATION_INTEL_DB_PATH = 'data/station.sqlite'; // relative → fatal
    assert.throws(() => resolveStationIntelDbPath(), /ABSOLUTE/);

    process.env.STATION_INTEL_DB_PATH = process.platform === 'win32' ? 'C:\\tmp\\s.sqlite' : '/tmp/s.sqlite';
    assert.doesNotThrow(() => resolveStationIntelDbPath());

    delete process.env.STATION_INTEL_DB_PATH; // unset → module-relative default, no throw
    assert.ok(resolveStationIntelDbPath().length > 0);
  } finally {
    if (saved === undefined) delete process.env.STATION_INTEL_DB_PATH;
    else process.env.STATION_INTEL_DB_PATH = saved;
  }
});
