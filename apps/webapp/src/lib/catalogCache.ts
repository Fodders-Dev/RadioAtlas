export type CatalogCacheEntry<T> = {
  version: 1;
  key: string;
  payload: T;
  createdAt: number;
  expiresAt: number;
};

type ReadOptions = {
  allowExpired?: boolean;
};

const DB_NAME = 'radioatlas-catalog-cache';
const DB_VERSION = 1;
const STORE_NAME = 'entries';
const LOCAL_STORAGE_KEY = 'radio:catalog-cache:v1';

let dbPromise: Promise<IDBDatabase | null> | null = null;

const hasIndexedDb = () => typeof indexedDB !== 'undefined';

const openCatalogCacheDatabase = async () => {
  if (!hasIndexedDb()) return null;
  dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
};

const withStore = async <T,>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T> | void
) => {
  const db = await openCatalogCacheDatabase();
  if (!db) return null;

  return new Promise<T | null>((resolve) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = action(store);
    let resolved = false;

    if (request) {
      request.onsuccess = () => {
        resolved = true;
        resolve(request.result);
      };
      request.onerror = () => {
        resolved = true;
        resolve(null);
      };
    }

    transaction.oncomplete = () => {
      if (!resolved) {
        resolve(null);
      }
    };
    transaction.onerror = () => {
      if (!resolved) {
        resolve(null);
      }
    };
  });
};

const readLocalCache = () => {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, CatalogCacheEntry<unknown>>)
      : {};
  } catch {
    return {};
  }
};

const writeLocalCache = (cache: Record<string, CatalogCacheEntry<unknown>>) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage quota and private-mode failures.
  }
};

const deleteLocalByPrefix = (prefix: string) => {
  const cache = readLocalCache();
  let changed = false;
  for (const key of Object.keys(cache)) {
    if (key.startsWith(prefix)) {
      delete cache[key];
      changed = true;
    }
  }
  if (changed) {
    writeLocalCache(cache);
  }
};

const isFreshEnough = <T,>(entry: CatalogCacheEntry<T>, options?: ReadOptions) =>
  options?.allowExpired || entry.expiresAt > Date.now();

export const readCatalogCache = async <T,>(
  key: string,
  options?: ReadOptions
): Promise<CatalogCacheEntry<T> | null> => {
  const indexedEntry = await withStore<CatalogCacheEntry<T>>('readonly', (store) =>
    store.get(key)
  );
  const localEntry = readLocalCache()[key] as CatalogCacheEntry<T> | undefined;
  const entry = indexedEntry || localEntry || null;
  if (!entry || entry.version !== 1 || entry.key !== key) {
    return null;
  }
  if (isFreshEnough(entry, options)) {
    return entry;
  }
  await deleteCatalogCacheByKey(key);
  return null;
};

export const writeCatalogCache = async <T,>(
  key: string,
  payload: T,
  ttlMs: number
): Promise<CatalogCacheEntry<T>> => {
  const now = Date.now();
  const entry: CatalogCacheEntry<T> = {
    version: 1,
    key,
    payload,
    createdAt: now,
    expiresAt: now + ttlMs
  };

  const saved = await withStore<IDBValidKey>('readwrite', (store) => store.put(entry));
  if (saved === null) {
    const cache = readLocalCache();
    cache[key] = entry as CatalogCacheEntry<unknown>;
    writeLocalCache(cache);
  }
  return entry;
};

export const deleteCatalogCacheByKey = async (key: string) => {
  await withStore<undefined>('readwrite', (store) => store.delete(key));
  const cache = readLocalCache();
  if (cache[key]) {
    delete cache[key];
    writeLocalCache(cache);
  }
};

export const deleteCatalogCacheByPrefix = async (prefix: string) => {
  const keys = await withStore<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
  if (keys) {
    await Promise.all(
      keys
        .map(String)
        .filter((key) => key.startsWith(prefix))
        .map((key) => withStore<undefined>('readwrite', (store) => store.delete(key)))
    );
  }
  deleteLocalByPrefix(prefix);
};

export const clearCatalogCacheStorage = async () => {
  await withStore<undefined>('readwrite', (store) => store.clear());
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
  }
};

export const catalogCacheStorageKey = LOCAL_STORAGE_KEY;
