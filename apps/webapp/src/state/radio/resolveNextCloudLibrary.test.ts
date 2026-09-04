import { describe, expect, it } from 'vitest';

import { resolveNextCloudLibrary } from './helpers';
import type { CloudLibrary } from '../../domain/contracts';

/**
 * The one-line defect that switched off cloud sync for every new account.
 *
 * `applySessionSnapshot` kept the previous library when it "matched" the one the
 * server sent. `cloudLibraryMatches` normalises null to EMPTY — correct for the
 * question it answers — so on a first sign-in, where the server's library IS
 * empty, `null` matched and `null` was kept. `useCloudLibrarySync` returns early
 * on `!cloudLibrary`, which killed both of its effects: the sign-in merge that
 * uploads what the device already holds, and the debounced watcher that syncs
 * everything afterwards.
 *
 * Measured 2026-09-04 in a browser with a find seeded before a first sign-in:
 * zero `PUT /me/library` after `POST /auth/google`. It only started working once
 * a station was liked, because that path calls `replaceCloudLibrary` directly
 * and its 200 returns a non-empty library. So the bug was invisible in any
 * session that happened to like something, and total for somebody who only
 * caught finds.
 *
 * `tests/finds-sync-failure.spec.ts` gates this in a real browser, but CI runs
 * Playwright without gating — hence this, which runs where the gate is.
 */

const library = (overrides: Partial<CloudLibrary> = {}): CloudLibrary =>
  ({
    favorites: [],
    recent: [],
    trackHistory: [],
    collections: [],
    followedStations: [],
    followedRegions: [],
    alerts: [],
    tasteProfile: null,
    updatedAt: 0,
    ...overrides
  }) as CloudLibrary;

describe('the library a session holds after the server answers', () => {
  it('takes the server copy when there was none, even though it is empty', () => {
    // ⚠ THE defect. An empty server library is not "no library": it is the
    // starting point every account has, and the object has to exist before
    // anything can be synced into it.
    const next = library();
    expect(resolveNextCloudLibrary(null, next)).toBe(next);
  });

  it('takes the server copy when there was none and it is not empty', () => {
    const next = library({ recent: [{ stationuuid: 'a', name: 'A', url_resolved: 'u' }] as never });
    expect(resolveNextCloudLibrary(null, next)).toBe(next);
  });

  it('keeps the previous object when nothing changed, so the tree does not re-render', () => {
    // The optimisation this line was written for is still worth having — it is
    // only the null case that was wrong.
    const previous = library({
      trackHistory: [
        { id: 'f1', stationId: 's1', stationName: 'S', track: 'A - B', timestamp: 1 }
      ] as never
    });
    const next = library({
      trackHistory: [
        { id: 'f1', stationId: 's1', stationName: 'S', track: 'A - B', timestamp: 1 }
      ] as never
    });
    expect(resolveNextCloudLibrary(previous, next)).toBe(previous);
  });

  it('takes the server copy when the finds differ', () => {
    const previous = library();
    const next = library({
      trackHistory: [
        { id: 'f1', stationId: 's1', stationName: 'S', track: 'A - B', timestamp: 1 }
      ] as never
    });
    expect(resolveNextCloudLibrary(previous, next)).toBe(next);
  });
});
