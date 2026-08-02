import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';
import { catalogCacheStorageKey, CATALOG_CACHE_VERSION } from '../src/lib/catalogCache';

// T2.21: three server-signal discovery rails — Trending (clicktrend),
// Top voted (votes), Around the world (daily-rotating country). The ranking is
// computed server-side; the webapp consumes the ready-made pools from the
// catalogue summary and renders them as rails. This spec drives Home with a
// summary that carries those pools and asserts the rails appear.

const COUNTRIES = 12;
const GENRES = 12;
const bigCatalog = Array.from({ length: 120 }, (_, i) => {
  const base = stations[i % stations.length];
  return {
    ...base,
    stationuuid: `disc-${i}`,
    name: `Station ${i + 1}`,
    country: `Country ${i % COUNTRIES}`,
    tags: `genre${i % GENRES},sub${i % 5}`
  };
});

const spotlight = (label: string, slice: typeof bigCatalog) => ({ label, stations: slice });

// Distinct, non-overlapping pools so the rails stay full shelves after the
// client de-dupes them against the personalised fresh-now rail.
const summaryBody = JSON.stringify({
  generatedAt: Date.now(),
  counts: { stations: bigCatalog.length, countries: COUNTRIES, languages: 9, genres: GENRES },
  catalogPool: bigCatalog.slice(0, 18),
  freshSignals: bigCatalog.slice(0, 12),
  searchLaunch: bigCatalog.slice(12, 24),
  sponsored: bigCatalog.slice(0, 2),
  countrySpotlight: spotlight('Country 0', bigCatalog.filter((s) => s.country === 'Country 0').slice(0, 8)),
  genreSpotlight: spotlight('genre1', bigCatalog.filter((s) => s.tags.startsWith('genre1,')).slice(0, 8)),
  trending: bigCatalog.slice(30, 42),
  topVoted: bigCatalog.slice(42, 54),
  // Disjoint 12-slice (label set explicitly) so the mood shelves below, which
  // would otherwise share Country-5 stations, don't shrink this rail under de-dup.
  aroundTheWorld: spotlight('Country 5', bigCatalog.slice(100, 112)),
  // Server-bucketed mood shelves, distinct catalogue slices so they survive de-dup.
  moodRails: [
    { id: 'mood-late-night', stations: bigCatalog.slice(60, 70) },
    { id: 'mood-workout', stations: bigCatalog.slice(70, 80) },
    { id: 'mood-focus', stations: bigCatalog.slice(80, 90) },
    { id: 'mood-driving', stations: bigCatalog.slice(90, 100) }
  ]
});

const seedSummary = async (page: Page) => {
  const json = (payload: string) => (route: import('@playwright/test').Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: payload });
  const catalogBody = JSON.stringify(bigCatalog);
  await page.route('**/catalog-fast.json', json(catalogBody));
  await page.route('**/catalog-full.json', json(catalogBody));
  await page.route('**/catalog/summary**', json(summaryBody));
};

const openHome = async (page: Page) => {
  // A listener with NO history now gets the first-run screen (hero + the
  // top-voted shelf only). These specs are about the DISCOVERY SURFACE, which
  // is what a returning listener sees — so seed one play to be that listener.
  await seedRadioState(page, { playbackHistory: [stations[0]] });
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible({ timeout: 15_000 });
  // (No dock wait here: with nothing playing the dormant dock renders nothing,
  // and the feed-entry assertion above is already the load anchor. Do NOT use
  // .app-navigation-mobile — it is display:none at >=960, where these suites run.)
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => window.scrollY === 0);
  await page.waitForTimeout(150);
};

const railTiles = (page: Page, id: string) =>
  page.locator(`[data-home-rail="${id}"] [data-home-station]`).count();

const aboveFoldTileCount = (page: Page) =>
  page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return Array.from(document.querySelectorAll('[data-home-station]')).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top < vh && r.bottom > 0 && r.left < vw && r.right > 0;
    }).length;
  });

test.describe('T2.21 discovery rails', () => {
  test.beforeEach(async ({ page }) => {
    await installMediaMocks(page);
    await mockStations(page);
    await seedSummary(page);
  });

  test('desktop: Trending / Top voted / Around the world rails render with stations', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await openHome(page);

    // All three new shelves are present in the surface.
    await expect(page.locator('[data-home-rail="trending"]')).toHaveCount(1);
    await expect(page.locator('[data-home-rail="top-voted"]')).toHaveCount(1);
    await expect(page.locator('[data-home-rail="around-the-world"]')).toHaveCount(1);

    // Each carries a full shelf (6 tiles) after de-duplication.
    expect(await railTiles(page, 'trending')).toBe(6);
    expect(await railTiles(page, 'top-voted')).toBe(6);
    expect(await railTiles(page, 'around-the-world')).toBe(6);

    // Around the world surfaces its rotating country as the rail's label chip.
    await expect(
      page.locator('[data-home-rail="around-the-world"] .home-section-badge')
    ).toContainText('Country 5');

    // T2.22: all four mood shelves render, in fixed display order between
    // Top voted and Around the world.
    for (const mood of ['mood-late-night', 'mood-workout', 'mood-focus', 'mood-driving']) {
      await expect(page.locator(`[data-home-rail="${mood}"]`)).toHaveCount(1);
    }

    // Order: fresh-now leads, Trending #2, moods sit between Top voted and Around the world.
    const railIds = await page.locator('[data-home-rail]').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-home-rail'))
    );
    expect(railIds[0]).toBe('fresh-now');
    // The reference-led order brings the dedicated new-stations shelf directly
    // after the lead recommendation rail.
    expect(railIds[1]).toBe('home-new-stations');
    expect(railIds.indexOf('trending')).toBe(2);
    expect(railIds.indexOf('mood-late-night')).toBeGreaterThan(railIds.indexOf('top-voted'));
    expect(railIds.indexOf('mood-driving')).toBeLessThan(railIds.indexOf('around-the-world'));
    // Fixed mood display order.
    expect(railIds.indexOf('mood-late-night')).toBeLessThan(railIds.indexOf('mood-workout'));
    expect(railIds.indexOf('mood-workout')).toBeLessThan(railIds.indexOf('mood-focus'));
    expect(railIds.indexOf('mood-focus')).toBeLessThan(railIds.indexOf('mood-driving'));

    // The reference hero owns most of the first fold, while one useful row of
    // large station cards still peeks into view on desktop.
    expect(await aboveFoldTileCount(page)).toBeGreaterThanOrEqual(4);
  });

  test('mobile: discovery + mood rails present in the dense surface', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHome(page);

    await expect(page.locator('[data-home-rail="trending"]')).toHaveCount(1);
    await expect(page.locator('[data-home-rail="top-voted"]')).toHaveCount(1);
    await expect(page.locator('[data-home-rail="around-the-world"]')).toHaveCount(1);
    // At least two mood shelves reach the dense surface (DENSE_RAIL_LIMIT fits all).
    const moodCount = await page.locator(
      '[data-home-rail="mood-late-night"], [data-home-rail="mood-workout"], [data-home-rail="mood-focus"], [data-home-rail="mood-driving"]'
    ).count();
    expect(moodCount).toBeGreaterThanOrEqual(2);
  });
});

// T2.23: variety pass — anchor chip-row, featured lead tile, logo-strip lane.
test.describe('T2.23 variety pass', () => {
  test.beforeEach(async ({ page }) => {
    await installMediaMocks(page);
    await mockStations(page);
    await seedSummary(page);
  });

  test('desktop: fresh-now leads with a featured tile wider than its siblings', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await openHome(page);

    const tiles = page.locator('[data-home-rail="fresh-now"] [data-home-station]');
    const first = tiles.first();
    await expect(first).toHaveClass(/home-station-tile--featured/);
    const featuredW = await first.evaluate((el) => el.getBoundingClientRect().width);
    const standardW = await tiles.nth(1).evaluate((el) => el.getBoundingClientRect().width);
    expect(featuredW).toBeGreaterThan(standardW);
    // Only the lead tile is featured.
    expect(await page.locator('[data-home-rail="fresh-now"] .home-station-tile--featured').count()).toBe(1);
  });

  test('desktop: top-voted renders as an artwork-only logo strip with accessible names', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await openHome(page);

    const rail = page.locator('[data-home-rail="top-voted"]');
    await expect(rail).toHaveAttribute('data-home-rail-variant', 'logo-strip');
    // No visible station title text in the logo strip.
    await expect(rail.locator('.home-station-title')).toHaveCount(0);
    // Tiles still play and keep an accessible name (aria-label carries the station name).
    const logoButton = rail.locator('.home-logo-play').first();
    await expect(logoButton).toBeVisible();
    const label = await logoButton.getAttribute('aria-label');
    expect((label || '').length).toBeGreaterThan(0);
  });

  test('mobile: Feed copy stays complete and station cards expose one play action', async ({ page }) => {
    for (const width of [360, 390, 412]) {
      await page.setViewportSize({ width, height: 844 });
      await openHome(page);

      const feedCopy = page.locator('.home-feed-entry-sub');
      await expect(feedCopy).toBeVisible();
      const copyMetrics = await feedCopy.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return {
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          clientWidth: element.clientWidth,
          // The natural width of the TEXT, not of the box. `scrollWidth` is
          // clamped to the box for a nowrap+ellipsis element in some engines, so
          // measuring the range is the only reading that cannot lie.
          textWidth: range.getBoundingClientRect().width,
          lineClamp: window.getComputedStyle(element).webkitLineClamp
        };
      });
      expect(copyMetrics.scrollHeight).toBeLessThanOrEqual(copyMetrics.clientHeight + 1);
      expect(copyMetrics.lineClamp).toBe('none');
      // The test above only ever compared HEIGHTS, so for months the line read
      // «Потяни вниз — станции одна за др...» on every phone width and nothing
      // failed: 221px of text in a 184px box. Horizontal truncation is the way
      // this copy actually breaks, so it is the thing that has to be asserted.
      expect(copyMetrics.textWidth).toBeLessThanOrEqual(copyMetrics.clientWidth);

      const firstTile = page.locator('[data-home-rail="fresh-now"] [data-home-station]').first();
      await expect(firstTile.locator('.home-station-primary-action')).toHaveCount(1);
      await expect(firstTile.locator('button.home-action-btn-play')).toHaveCount(0);
      // Cards no longer render a like/favorite button — only the play target.
      await expect(firstTile.locator('.home-action-btn-like')).toHaveCount(0);

      const mobileMetrics = await page.evaluate(() => {
        const rect = (selector: string) => {
          const box = document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
          return box ? { width: box.width, height: box.height } : null;
        };
        const fontSize = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector);
          return element ? Number.parseFloat(window.getComputedStyle(element).fontSize) : null;
        };
        return {
          settings: rect('.mobile-settings-trigger'),
          account: rect('.app-topbar-primary-cta'),
          navLabelFont: fontSize('.mobile-nav-item span:last-child'),
          stationTitleFont: fontSize('.home-station-title')
        };
      });
      expect(Math.round(mobileMetrics.settings?.width ?? 0)).toBeGreaterThanOrEqual(44);
      expect(Math.round(mobileMetrics.settings?.height ?? 0)).toBeGreaterThanOrEqual(44);
      expect(Math.round(mobileMetrics.account?.width ?? 0)).toBeGreaterThanOrEqual(44);
      expect(Math.round(mobileMetrics.account?.height ?? 0)).toBeGreaterThanOrEqual(44);
      expect(mobileMetrics.navLabelFont).toBeGreaterThanOrEqual(10);
      expect(mobileMetrics.navLabelFont).toBeLessThanOrEqual(11);
      expect(mobileMetrics.stationTitleFont).toBeGreaterThanOrEqual(13);
      expect(mobileMetrics.stationTitleFont).toBeLessThanOrEqual(15);
    }
  });

  // T_mobile_1 B: the tile-sized primary button starts the station — the small
  // play-icon glyph is decorative (live mobile feedback "играй на клик по квадратику").
  test('T_mobile_1 B: clicking the tile play target starts that station', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await openHome(page);

    const firstTile = page.locator('[data-home-rail="fresh-now"] [data-home-station]').first();
    const stationName = await firstTile.locator('.home-station-title').textContent();
    expect(stationName).toBeTruthy();

    // Click the semantic overlay that makes the whole visual tile a play target.
    await firstTile.locator('.home-station-primary-action').click();
    await expect(page.locator('.player-dock-bar')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.player-dock-title')).toContainText(stationName!.trim());

    // Cards no longer expose a like button — the play target is the only control.
    await expect(firstTile.locator('.home-action-btn-like')).toHaveCount(0);
  });

  // Reference-led Home restores the computed recommendation hero while keeping
  // companions inside that hero (never as an orphan discovery rail).
  test('reference Home renders one playable hero; fresh-now still leads the rails', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 });
    await openHome(page);

    await expect(page.locator('.home-hero-card')).toHaveCount(1);
    await expect(page.locator('[data-home-hero]')).toBeVisible();
    await expect(page.locator('[data-home-hero] .home-hero-play')).toHaveCount(1);
    await expect(page.locator('[data-home-rail$="-companions"]')).toHaveCount(0);

    // fresh-now is the very first rail in document order.
    const firstRailId = await page
      .locator('[data-home-rail]')
      .first()
      .evaluate((el) => el.getAttribute('data-home-rail'));
    expect(firstRailId).toBe('fresh-now');
  });
});

// T_audit_10: the cold-load stale-cache freeze. A prior cold-load that hit the
// 6 s network timeout writes a radio-browser FALLBACK summary to the cache — a
// v2 entry whose shape is only 5 rails (no trending/topVoted/aroundTheWorld/
// moodRails). On the next (healthy) cold-load the cache-hit path renders that
// 5-rail payload and the home snapshot freezes on it; the background network
// revalidation then lands the full 12-rail payload but the seed/version
// snapshot gate ignores it, so the user is stuck at 5 rails until they hit
// refresh. The fix: the snapshot also revalidates against the summary's rail
// composition (summaryRailSignature), so the fuller payload rebuilds the
// surface automatically. This is the red→green proof.
const SPRINT_V2_RAILS = [
  'trending',
  'top-voted',
  'around-the-world',
  'mood-late-night',
  'mood-workout',
  'mood-focus',
  'mood-driving'
];

// The reduced shape a fallback summary leaves in the cache: the base rails only.
const staleFallbackSummary = JSON.stringify({
  generatedAt: Date.now(),
  counts: { stations: bigCatalog.length, countries: COUNTRIES, languages: 9, genres: GENRES },
  catalogPool: bigCatalog.slice(0, 18),
  freshSignals: bigCatalog.slice(0, 12),
  searchLaunch: bigCatalog.slice(12, 24),
  sponsored: bigCatalog.slice(0, 2),
  countrySpotlight: spotlight('Country 0', bigCatalog.filter((s) => s.country === 'Country 0').slice(0, 8)),
  genreSpotlight: spotlight('genre1', bigCatalog.filter((s) => s.tags.startsWith('genre1,')).slice(0, 8))
  // No trending / topVoted / aroundTheWorld / moodRails — the fallback shape.
});

test.describe('T_audit_10 cold-load stale-cache surface', () => {
  test.beforeEach(async ({ page }) => {
    await installMediaMocks(page);
    await mockStations(page);
    // Seed a FRESH (unexpired), current-version cache entry holding the reduced
    // 5-rail fallback payload — exactly what a timed-out cold-load leaves behind.
    await page.addInitScript(
      ({ storageKey, cacheVersion, cachedSummary }) => {
        const now = Date.now();
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({
            'summary:v2': {
              version: cacheVersion,
              key: 'summary:v2',
              payload: JSON.parse(cachedSummary),
              createdAt: now,
              expiresAt: now + 60 * 60 * 1000
            }
          })
        );
      },
      {
        storageKey: catalogCacheStorageKey,
        cacheVersion: CATALOG_CACHE_VERSION,
        cachedSummary: staleFallbackSummary
      }
    );
    // The network serves the full 12-rail payload, slightly delayed so the
    // cache-hit 5-rail paint lands first (the precise ordering that froze the
    // snapshot in prod).
    await page.route('**/catalog-fast.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bigCatalog) })
    );
    await page.route('**/catalog-full.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bigCatalog) })
    );
    await page.route('**/catalog/summary**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      await route.fulfill({ status: 200, contentType: 'application/json', body: summaryBody });
    });
  });

  test('cold-load rebuilds to the full Sprint-v2 surface without a manual refresh', async ({
    page
  }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    // A listener with NO history now gets the first-run screen (hero + the
  // top-voted shelf only). These specs are about the DISCOVERY SURFACE, which
  // is what a returning listener sees — so seed one play to be that listener.
  await seedRadioState(page, { playbackHistory: [stations[0]] });
    await page.goto('/?api=/api');

    // Home hydrates from the cached payload first (5 base rails).
    await expect(page.locator('[data-home-feed-entry]')).toBeVisible({ timeout: 15_000 });

    // Without any refresh click, the background network revalidation must
    // rebuild the surface to the full Sprint-v2 set. Pre-fix the snapshot froze
    // on the 5-rail cache and these never appeared.
    for (const railId of SPRINT_V2_RAILS) {
      await expect(page.locator(`[data-home-rail="${railId}"]`)).toHaveCount(1, { timeout: 10_000 });
    }

    // And we got here without ever touching the relocated refresh control.
    // (Sanity: the refresh button exists but was not clicked.)
    await expect(page.locator('[data-action="refresh-feed"]')).toHaveCount(1);
  });
});
