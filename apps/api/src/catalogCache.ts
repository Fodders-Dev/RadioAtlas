import { mkdir, readFile, writeFile } from 'node:fs/promises';

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

export const persistCatalogSnapshot = async <T>(mode: CatalogMode, stations: T[]) => {
  await mkdir(DATA_DIR_URL, { recursive: true });
  await writeFile(DATA_FILE_URLS[mode], JSON.stringify(stations), 'utf8');
};
