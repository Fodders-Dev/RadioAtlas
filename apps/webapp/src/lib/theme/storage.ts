import type { RadioAtlasTheme, ThemeAsset, ThemeAssetInput, ThemeDraftInput } from './types';

const DB_NAME = 'radioatlas-theme-db';
const DB_VERSION = 1;
const THEME_STORE = 'themes';
const ASSET_STORE = 'assets';

type StoreName = typeof THEME_STORE | typeof ASSET_STORE;

const memoryThemes = new Map<string, RadioAtlasTheme>();
const memoryAssets = new Map<string, ThemeAsset>();

let dbPromise: Promise<IDBDatabase | null> | null = null;

const hasIndexedDb = () => typeof indexedDB !== 'undefined';

const cloneTheme = (theme: RadioAtlasTheme): RadioAtlasTheme => ({
  ...theme,
  layers: {
    ...theme.layers,
    accent: theme.layers.accent ? { ...theme.layers.accent } : undefined,
    background: theme.layers.background ? { ...theme.layers.background } : undefined,
    icons: theme.layers.icons ? { ...theme.layers.icons } : undefined,
    font: theme.layers.font ? { ...theme.layers.font } : undefined,
    stickers: theme.layers.stickers ? theme.layers.stickers.map((item) => ({ ...item })) : undefined,
    gifs: theme.layers.gifs ? theme.layers.gifs.map((item) => ({ ...item })) : undefined,
    emojiReactions: theme.layers.emojiReactions
      ? theme.layers.emojiReactions.map((item) => ({ ...item }))
      : undefined
  }
});

const cloneAsset = (asset: ThemeAsset): ThemeAsset => ({
  ...asset
});

const normalizeTheme = (theme: ThemeDraftInput): RadioAtlasTheme => {
  const now = Date.now();
  return {
    ...theme,
    version: 1,
    createdAt: theme.createdAt || now,
    updatedAt: theme.updatedAt || now,
    builtin: false,
    layers: {
      ...theme.layers
    }
  };
};

const normalizeAsset = (asset: ThemeAssetInput): ThemeAsset => {
  const now = Date.now();
  return {
    ...asset,
    version: 1,
    createdAt: asset.createdAt || now,
    updatedAt: asset.updatedAt || now
  };
};

const openThemeDatabase = async () => {
  if (!hasIndexedDb()) return null;
  dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(THEME_STORE)) {
        db.createObjectStore(THEME_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(ASSET_STORE)) {
        db.createObjectStore(ASSET_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return dbPromise;
};

const withStore = async <T,>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T> | void
) => {
  const db = await openThemeDatabase();
  if (!db) return null;

  return new Promise<T | null>((resolve) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
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

export const listStoredThemes = async () => {
  if (!hasIndexedDb()) {
    return Array.from(memoryThemes.values()).map(cloneTheme);
  }

  const themes = await withStore<RadioAtlasTheme[]>(THEME_STORE, 'readonly', (store) =>
    store.getAll()
  );
  if (themes === null) {
    return Array.from(memoryThemes.values()).map(cloneTheme);
  }
  return themes.map(cloneTheme);
};

export const saveStoredTheme = async (theme: ThemeDraftInput) => {
  const normalized = normalizeTheme(theme);
  if (!hasIndexedDb()) {
    memoryThemes.set(normalized.id, cloneTheme(normalized));
    return normalized;
  }

  const saved = await withStore<IDBValidKey>(THEME_STORE, 'readwrite', (store) =>
    store.put(normalized)
  );
  if (saved === null) {
    memoryThemes.set(normalized.id, cloneTheme(normalized));
  }
  return normalized;
};

export const deleteStoredTheme = async (themeId: string) => {
  if (!hasIndexedDb()) {
    memoryThemes.delete(themeId);
    return;
  }

  const deleted = await withStore<undefined>(THEME_STORE, 'readwrite', (store) =>
    store.delete(themeId)
  );
  if (deleted === null) {
    memoryThemes.delete(themeId);
  }
};

export const listStoredAssets = async () => {
  if (!hasIndexedDb()) {
    return Array.from(memoryAssets.values()).map(cloneAsset);
  }

  const assets = await withStore<ThemeAsset[]>(ASSET_STORE, 'readonly', (store) => store.getAll());
  if (assets === null) {
    return Array.from(memoryAssets.values()).map(cloneAsset);
  }
  return assets.map(cloneAsset);
};

export const getStoredAsset = async (assetId: string) => {
  if (!hasIndexedDb()) {
    const asset = memoryAssets.get(assetId);
    return asset ? cloneAsset(asset) : null;
  }

  const asset = await withStore<ThemeAsset>(ASSET_STORE, 'readonly', (store) =>
    store.get(assetId)
  );
  if (asset === null) {
    const memoryAsset = memoryAssets.get(assetId);
    return memoryAsset ? cloneAsset(memoryAsset) : null;
  }
  return asset ? cloneAsset(asset) : null;
};

export const saveStoredAsset = async (asset: ThemeAssetInput) => {
  const normalized = normalizeAsset(asset);
  if (!hasIndexedDb()) {
    memoryAssets.set(normalized.id, cloneAsset(normalized));
    return normalized;
  }

  const saved = await withStore<IDBValidKey>(ASSET_STORE, 'readwrite', (store) =>
    store.put(normalized)
  );
  if (saved === null) {
    memoryAssets.set(normalized.id, cloneAsset(normalized));
  }
  return normalized;
};

export const deleteStoredAsset = async (assetId: string) => {
  if (!hasIndexedDb()) {
    memoryAssets.delete(assetId);
    return;
  }

  const deleted = await withStore<undefined>(ASSET_STORE, 'readwrite', (store) =>
    store.delete(assetId)
  );
  if (deleted === null) {
    memoryAssets.delete(assetId);
  }
};

export const clearThemeStorageForTests = async () => {
  memoryThemes.clear();
  memoryAssets.clear();
  if (!hasIndexedDb()) return;

  await withStore<undefined>(THEME_STORE, 'readwrite', (store) => store.clear());
  await withStore<undefined>(ASSET_STORE, 'readwrite', (store) => store.clear());
};
