import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type CatalogMode = 'fast' | 'full';

/**
 * Where the fallback catalogue snapshot lives.
 *
 * The default resolves next to the built API — which on the VPS means
 * `/opt/RadioAtlas/releases/<sha>/apps/api/data/`, i.e. INSIDE the release. The
 * snapshot is therefore recreated from scratch by every deploy and deleted with
 * the release it belonged to, which is the same trap the observability store
 * and the harvester database were both caught in. Production sets
 * `CATALOG_DATA_DIR` to the shared volume (see `ecosystem.config.cjs`).
 *
 * It also gives tests somewhere harmless to write: an integration test that
 * spawns the API with fake mirrors used to overwrite the developer's own
 * 70MB catalogue snapshot with its two fixture stations.
 */
const configuredDir = String(process.env.CATALOG_DATA_DIR || '').trim();
// `resolve` + `pathToFileURL` rather than URL joining: it handles either path
// separator without this file needing to care which platform it is on.
const dataFile = (name: string) =>
  configuredDir
    ? pathToFileURL(resolve(configuredDir, name))
    : new URL(`../data/${name}`, import.meta.url);
const DATA_DIR_PATH = configuredDir ? resolve(configuredDir) : fileURLToPath(new URL('../data/', import.meta.url));
const DATA_FILE_URLS: Record<CatalogMode, URL> = {
  fast: dataFile('catalog-fast.json'),
  full: dataFile('catalog-full.json')
};

export const readPersistedCatalog = async <T>(mode: CatalogMode) => {
  const raw = await readFile(DATA_FILE_URLS[mode], 'utf8');
  return JSON.parse(raw) as T[];
};

/**
 * Stations per write. Small enough that the serialized chunk stays a few
 * hundred KB, large enough that a 60k-row catalogue is ~120 writes rather than
 * 60 000.
 */
const SNAPSHOT_CHUNK = 500;

/**
 * The snapshot is written in chunks because `JSON.stringify` of the whole
 * catalogue was the single largest allocation in the API.
 *
 * Measured against the live 60 309-station catalogue: `JSON.stringify(stations)`
 * materialises one 68.5M-character string (+137MB on the JS heap, since the
 * Cyrillic content forces UTF-16), and `writeFile` then encodes that into a
 * Buffer (+69MB external). ~206MB, in one shot, to write a file that only
 * matters when the upstream mirrors are down — and it happens on the SAME
 * 30-minute refresh that is already holding two copies of the catalogue.
 * Production sat at ~450MB idle and pm2 killed it at 1020-1114MB against a
 * 896MB cap, four times on 2026-08-15, once mid-conversation for a real
 * listener.
 *
 * Chunked, the peak is the chunk, not the catalogue. The write also goes to a
 * temp file and is renamed into place: a process killed mid-write used to leave
 * a truncated snapshot that `readPersistedCatalog` could only throw on.
 */
let pendingWriteId = 0;

export const persistCatalogSnapshot = async <T>(mode: CatalogMode, stations: T[]) => {
  await mkdir(DATA_DIR_PATH, { recursive: true });
  const target = fileURLToPath(DATA_FILE_URLS[mode]);
  // The temp name is unique per call. A shared `<target>.tmp` looked fine until
  // two snapshot writes overlapped — the boot warm-up and a request-triggered
  // refresh — and the second `rename` failed with ENOENT because the first had
  // already moved the file away. Since the call sites are fire-and-forget, that
  // rejection took the whole API process down. CI caught it; production had not
  // happened to overlap yet.
  pendingWriteId += 1;
  const pending = `${target}.${process.pid}.${pendingWriteId}.tmp`;
  try {
    const handle = await open(pending, 'w');
    try {
      await handle.write('[');
      for (let index = 0; index < stations.length; index += SNAPSHOT_CHUNK) {
        const chunk = stations.slice(index, index + SNAPSHOT_CHUNK);
        const serialized = chunk.map((station) => JSON.stringify(station)).join(',');
        await handle.write(index === 0 ? serialized : `,${serialized}`);
      }
      await handle.write(']');
    } finally {
      await handle.close();
    }
    await rename(pending, target);
  } catch (error) {
    // ANY failure - a serialization error, a full disk, a lost rename - takes
    // the partial file with it. Temp names are unique per call, so a leak here
    // would accumulate one dead 70MB file per refresh.
    await unlink(pending).catch(() => {});
    throw error;
  }
};
