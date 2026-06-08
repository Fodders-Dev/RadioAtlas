import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

// T2.20 Home density pass. The screen was "хуйня + станций очень мало": a tall
// hero (with a catalogue-stats row), a search-launcher that rendered a full
// live-preview list, and a footer nav-promo card all stacked above the rails,
// pushing the actual catalogue below the fold. This pass drops those
// decorations, blanks the topbar kicker, compacts the search launcher to a
// form + chips, and narrows the rail tiles — so far more stations sit above
// the fold without touching the data/API layer.
//
// The shipped fixture only carries 12 stations, which caps how many distinct
// tiles can exist; seed a richer catalogue so the rails have enough material
// to actually fill the reclaimed space. The overrides register AFTER
// mockStations, so Playwright (last-registered-wins) serves these instead.
// Diverse synthetic catalogue: the home feed derives its country/genre
// "spotlight" rails from catalogue buckets (≥3 stations each) and de-dupes
// stations already used by earlier rails. With only a few countries/tags the
// spotlight rails collapse to a couple of stations and get hidden as "thin";
// real production data has many distinct regions/genres, so each spotlight is
// a full shelf. Reproduce that here: 10 countries × 10 genres, 6 stations apiece.
const COUNTRIES = 12;
const GENRES = 12;
const bigCatalog = Array.from({ length: 120 }, (_, i) => {
  const base = stations[i % stations.length];
  return {
    ...base,
    stationuuid: `density-${i}`,
    name: `Station ${i + 1}`,
    country: `Country ${i % COUNTRIES}`,
    tags: `genre${i % GENRES},sub${i % 5}`
  };
});

// generatedAt MUST be a numeric epoch (the home surface math floors it into a
// 2h "session bucket"); an ISO string yields NaN, which never matches the
// current bucket and drives an infinite refresh loop. Use "now" so the feed
// settles on first paint instead of re-deriving every render.
const summaryBody = JSON.stringify({
  generatedAt: Date.now(),
  counts: { stations: bigCatalog.length, countries: 12, languages: 9, genres: 14 },
  catalogPool: bigCatalog,
  freshSignals: bigCatalog.slice(0, 18),
  searchLaunch: bigCatalog.slice(6, 24),
  sponsored: bigCatalog.slice(0, 2),
  countrySpotlight: { label: 'Japan', stations: bigCatalog.slice(0, 10) },
  genreSpotlight: { label: 'jpop', stations: bigCatalog.slice(10, 20) }
});

const seedBigCatalog = async (page: Page) => {
  const body = JSON.stringify(bigCatalog);
  const json = (payload: string) => (route: import('@playwright/test').Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: payload });
  await page.route('**/catalog-fast.json', json(body));
  await page.route('**/catalog-full.json', json(body));
  await page.route('**/catalog/summary**', json(summaryBody));
};

const openHome = async (page: Page) => {
  // A few favourites give the feed material for personalised shelves without a
  // tall resume strip dominating the fold. The catalogue's country/genre
  // diversity supplies the spotlight rails on its own.
  await seedRadioState(page, { favorites: bigCatalog.slice(0, 4) });
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible({ timeout: 15_000 });
  await page.locator('.player-dock').first().waitFor({ state: 'visible', timeout: 5000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => window.scrollY === 0);
  await page.waitForTimeout(150);
};

// Count station tiles that are genuinely above the fold: their box must
// intersect the viewport both vertically and horizontally. Rails below the
// fold are content-visibility:auto (their tiles report empty boxes), and rail
// tiles scrolled off to the right sit past innerWidth — both are excluded, so
// this measures what a user actually sees on first paint.
const aboveFoldTileCount = (page: Page) =>
  page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return Array.from(document.querySelectorAll('[data-home-station]')).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top < vh && r.bottom > 0 && r.left < vw && r.right > 0;
    }).length;
  });

test.describe('T2.20 Home density', () => {
  test.beforeEach(async ({ page }) => {
    await installMediaMocks(page);
    await mockStations(page);
    await seedBigCatalog(page);
  });

  test('desktop: ≥12 station tiles above the fold + decorations dropped', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await openHome(page);

    // Density target: dropping the decorations + fixing the rail over-blocking
    // (so multiple shelves form) puts at least a dozen stations above the fold
    // on first paint, where the old layout showed ~5.
    expect(await aboveFoldTileCount(page)).toBeGreaterThanOrEqual(12);

    // Dropped decorations: the live search-preview list, the footer nav-promo
    // card, and the hero catalogue-stats row are all gone.
    await expect(page.locator('.home-search-preview')).toHaveCount(0);
    await expect(page.locator('[data-home-search-preview]')).toHaveCount(0);
    await expect(page.locator('.home-explore-card')).toHaveCount(0);
    await expect(page.locator('.home-hero-metrics')).toHaveCount(0);

    // Search-on-Home is preserved (it's a real search, not a promo): the
    // compact form + its input + quick-search chips stay.
    await expect(page.locator('.home-search-launcher.is-compact')).toHaveCount(1);
    await expect(page.locator('#home-search-launcher')).toBeVisible();
    await expect(page.locator('.home-search-chip').first()).toBeVisible();

    // Topbar kicker is blanked (B): the decorative "Твой эфирный атлас" line is
    // empty while the "Главная" title and topbar height stay put.
    const kickerText = await page.locator('.shell-kicker').first().textContent();
    expect((kickerText || '').trim()).toBe('');
  });

  // PR-5: the mobile Home was rebuilt mobile-first — a large "Моя волна" hero, a
  // 2-column "Для тебя" grid of large cards, and discovery PEEK rails (~2.3 big
  // covers in view). That deliberately trades the old packed density (≥6 above
  // fold) for a calmer rhythm with bigger, finger-friendly cards, so a handful of
  // large tiles sit above the fold rather than a dozen small ones.
  test('mobile: a few large station tiles sit above the fold (calm rhythm)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHome(page);

    expect(await aboveFoldTileCount(page)).toBeGreaterThanOrEqual(3);
  });
});
