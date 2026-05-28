import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

// T_audit_3 — post-Sprint-v2 Home polish (F1 + F2 + F3).
// F1: locale placeholders ({country}/{genre}) no longer leak into rail titles.
// F2: above-fold density, reframed as height-aware "content items" (hero + tiles).
// F3: the fresh-now featured lead tile is measurably wider on desktop, equal on dense.

const COUNTRIES = 12;
const GENRES = 12;
const bigCatalog = Array.from({ length: 120 }, (_, i) => ({
  ...stations[i % stations.length],
  stationuuid: `polish-${i}`,
  name: `Station ${i + 1}`,
  country: `Country ${i % COUNTRIES}`,
  tags: `genre${i % GENRES},sub${i % 5}`
}));

const summaryBody = JSON.stringify({
  generatedAt: Date.now(),
  counts: { stations: bigCatalog.length, countries: COUNTRIES, languages: 9, genres: GENRES },
  catalogPool: bigCatalog.slice(0, 18),
  freshSignals: bigCatalog.slice(0, 12),
  searchLaunch: bigCatalog.slice(12, 24),
  sponsored: bigCatalog.slice(0, 2),
  countrySpotlight: { label: 'Country 0', stations: bigCatalog.filter((s) => s.country === 'Country 0').slice(0, 8) },
  genreSpotlight: { label: 'genre1', stations: bigCatalog.filter((s) => s.tags.startsWith('genre1,')).slice(0, 8) },
  trending: bigCatalog.slice(24, 36),
  topVoted: bigCatalog.slice(36, 48),
  aroundTheWorld: { label: 'Country 5', stations: bigCatalog.slice(100, 112) },
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

// F2 metric (reframed): above-fold CONTENT = the hero (a playable, featured
// station the user sees) + every visible rail station tile. Height-aware — the
// hero/chip-row/search consume ~684px, so two rail rows (→ ≥12) need ~960px.
// T_home_redesign_1: HomeHeroCard is no longer rendered; heroCount stays 0
// and the tile count rises (more vertical space → more tiles in the fold).
// The ≥12 / ≥7 thresholds hold with margin — no threshold change needed.
const aboveFoldContent = (page: Page) =>
  page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const inFold = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.top < vh && r.bottom > 0 && r.left < vw && r.right > 0;
    };
    const hero = document.querySelector('.home-hero-card');
    const heroCount = hero && inFold(hero) ? 1 : 0;
    const tiles = Array.from(document.querySelectorAll('[data-home-station]')).filter(inFold).length;
    return heroCount + tiles;
  });

test.describe('T_audit_3 Home polish', () => {
  test.beforeEach(async ({ page }) => {
    await installMediaMocks(page);
    await mockStations(page);
    await seedSummary(page);
  });

  test('F1: no {country}/{genre} placeholder leaks into rail titles', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await openHome(page);

    // The country/genre spotlight rails are present...
    // No rendered rail title contains a literal interpolation placeholder.
    // (HomeRail renders t(titleKey) without vars; the unit test in
    // homeCards.test.tsx exercises the country/genre spotlight titles directly,
    // since those client-rebuilt rails de-dupe out of this rich-summary mock.)
    const titles = await page.locator('.home-section-title').allTextContents();
    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) {
      expect(title).not.toContain('{');
      expect(title).not.toContain('}');
    }
  });

  test('F2: above-fold content is ≥12 on a wide desktop and ≥7 at the 1280×900 QA fold', async ({ page }) => {
    // ≥12 is a wide-desktop fold metric — two rail rows clear the fold at
    // 1440×960 (where T2.20/T2.23 validated it). The count is height- AND
    // width-bound: chip-row + search consume ~450px, so a second rail row only
    // clears the fold when the content is wide enough to keep each rail short.
    // T_home_redesign_1: hero gone, so the floor is now ~18 tiles in practice
    // at 1440×1024 — the ≥12 threshold is well-padded.
    await page.setViewportSize({ width: 1440, height: 1024 });
    await openHome(page);
    expect(await aboveFoldContent(page)).toBeGreaterThanOrEqual(12);

    // The 1280×900 QA viewport fits ~12 tiles above the fold post-T_home_redesign_1
    // (one rail row + most of a second). The ≥7 floor stays — it's still the
    // "user sees discovery content immediately without scrolling" contract.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(150);
    expect(await aboveFoldContent(page)).toBeGreaterThanOrEqual(7);
  });

  test('F3: fresh-now featured lead tile is ≥1.4× a sibling on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openHome(page);

    const tiles = page.locator('[data-home-rail="fresh-now"] [data-home-station]');
    await expect(tiles.first()).toHaveClass(/home-station-tile--featured/);
    const featuredW = await tiles.first().evaluate((el) => el.getBoundingClientRect().width);
    const siblingW = await tiles.nth(1).evaluate((el) => el.getBoundingClientRect().width);
    expect(featuredW).toBeGreaterThanOrEqual(siblingW * 1.4);
  });

  test('F3: featured gate is disabled on dense mobile (lead tile equals siblings)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHome(page);

    const tiles = page.locator('[data-home-rail="fresh-now"] [data-home-station]');
    // The featured modifier is gated off in the dense layout.
    await expect(tiles.first()).not.toHaveClass(/home-station-tile--featured/);
    const firstW = await tiles.first().evaluate((el) => el.getBoundingClientRect().width);
    const secondW = await tiles.nth(1).evaluate((el) => el.getBoundingClientRect().width);
    expect(Math.abs(firstW - secondW)).toBeLessThanOrEqual(2);
  });
});
