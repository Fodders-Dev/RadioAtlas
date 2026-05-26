import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

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
  await seedRadioState(page);
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible({ timeout: 15_000 });
  await page.locator('.player-dock').first().waitFor({ state: 'visible', timeout: 5000 });
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
    expect(railIds.indexOf('trending')).toBe(1);
    expect(railIds.indexOf('mood-late-night')).toBeGreaterThan(railIds.indexOf('top-voted'));
    expect(railIds.indexOf('mood-driving')).toBeLessThan(railIds.indexOf('around-the-world'));
    // Fixed mood display order.
    expect(railIds.indexOf('mood-late-night')).toBeLessThan(railIds.indexOf('mood-workout'));
    expect(railIds.indexOf('mood-workout')).toBeLessThan(railIds.indexOf('mood-focus'));
    expect(railIds.indexOf('mood-focus')).toBeLessThan(railIds.indexOf('mood-driving'));

    // T2.20 density is not regressed: still ≥12 tiles above the fold.
    expect(await aboveFoldTileCount(page)).toBeGreaterThanOrEqual(12);
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
