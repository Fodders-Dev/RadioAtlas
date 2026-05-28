import { describe, it, expect, beforeEach } from 'vitest';
import {
  CATALOG_CACHE_VERSION,
  catalogCacheStorageKey,
  readCatalogCache,
  writeCatalogCache
} from './catalogCache';

// 2026-05-27 incident: live prod returned only 5 of 11 Home rails because IDB
// cache (`radioatlas-catalog-cache`) had `/catalog/summary` entries written
// before T2.21/T2.22 added `trending` / `topVoted` / `aroundTheWorld` / `moodRails`
// to the API contract. The cached payload's TTL hadn't expired, so the stale
// shape kept being served. Fix: bump `CATALOG_CACHE_VERSION` so every entry
// from the previous shape fails the `entry.version !== CATALOG_CACHE_VERSION`
// guard in `readCatalogCache` and the network re-fetch wins.

describe('catalogCache versioning (2026-05-27 invalidation)', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') localStorage.clear();
  });

  it('CATALOG_CACHE_VERSION is past the legacy 1', () => {
    // The bumped literal is what invalidates pre-Sprint-v2 stale entries.
    expect(CATALOG_CACHE_VERSION).toBeGreaterThan(1);
  });

  it('readCatalogCache rejects a stale localStorage entry written under version 1', async () => {
    // Simulate the exact failure mode: a v1 entry sitting in the localStorage
    // fallback (the IDB path is symmetric — same guard in readCatalogCache).
    const stale = {
      ['catalog/summary']: {
        version: 1,
        key: 'catalog/summary',
        payload: { trending: undefined, moodRails: undefined },
        createdAt: Date.now(),
        expiresAt: Date.now() + 60 * 60 * 1000
      }
    };
    localStorage.setItem(catalogCacheStorageKey, JSON.stringify(stale));

    const entry = await readCatalogCache('catalog/summary');
    expect(entry).toBeNull();
  });

  it('readCatalogCache returns a freshly-written entry under the new version', async () => {
    await writeCatalogCache('catalog/test', { ok: true }, 60_000);
    const entry = await readCatalogCache<{ ok: boolean }>('catalog/test');
    expect(entry?.version).toBe(CATALOG_CACHE_VERSION);
    expect(entry?.payload).toEqual({ ok: true });
  });
});
