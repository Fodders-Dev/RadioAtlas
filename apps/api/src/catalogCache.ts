import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

type CatalogMode = 'fast' | 'full';

const DATA_DIR_URL = new URL('../data/', import.meta.url);
const DATA_FILE_URLS: Record<CatalogMode, URL> = {
  fast: new URL('../data/catalog-fast.json', import.meta.url),
  full: new URL('../data/catalog-full.json', import.meta.url)
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
export const persistCatalogSnapshot = async <T>(mode: CatalogMode, stations: T[]) => {
  await mkdir(DATA_DIR_URL, { recursive: true });
  const target = fileURLToPath(DATA_FILE_URLS[mode]);
  const pending = `${target}.tmp`;
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
  try {
    await rename(pending, target);
  } catch (error) {
    await unlink(pending).catch(() => {});
    throw error;
  }
};
