import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

// DATA HONESTY on the «Лента» card.
//
// Every line under the station name is INDEPENDENTLY optional and gated on real
// data, and the sparse case is the common one in production, not the exception.
// These tests pin both halves of that: the line appears when the datum is real,
// and it is ABSENT — not zeroed, not placeholdered, not estimated — when it is
// not. The geo gate is the strictest of them: geoResolver SYNTHESIZES plausible
// coordinates for the ~80% of the catalog that ships none, and printing those
// digits as "the station's coordinates" would be fabricated data.

const withPool = async (page: Page, pool: unknown[]) => {
  await mockStations(page, {
    summaryHandler: async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          generatedAt: Date.UTC(2026, 3, 20, 9, 0, 0),
          counts: { stations: pool.length, countries: 3, languages: 3, genres: 8 },
          catalogPool: pool,
          freshSignals: [],
          searchLaunch: [],
          sponsored: [],
          countrySpotlight: { label: 'Japan', stations: [] },
          genreSpotlight: { label: 'jpop', stations: [] }
        })
      });
    }
  });
};

const openFeed = async (page: Page) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page, { activeSection: 'feed' });
  await page.goto('/?api=/api');
  await expect(page.locator('.station-feed-card-name').first()).toBeVisible();
  // The geo line waits on the lazily-imported geoResolver chunk.
  await page.waitForTimeout(1200);
};

const focusedCard = (page: Page) =>
  page.locator('.station-feed-card-content[data-focus="true"]');

test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
});

test('renders the geo line for a station whose own coordinates are real', async ({ page }) => {
  await withPool(page, stations.slice(0, 8));
  await openFeed(page);

  const geo = focusedCard(page).locator('.station-feed-card-geo');
  await expect(geo).toBeVisible();
  // The datum verbatim at 4 decimals with a hemisphere letter.
  await expect(geo).toContainText(/\d+\.\d{4}° [NS], \d+\.\d{4}° [EW]/);
});

test('the geo line carries NO local time — there is no timezone behind one', async ({ page }) => {
  // The card used to print «≈ 07:53 · 34.6937° N, 135.5023° E». The clock half
  // was lib/localTime's solar time (longitude / 15°), which knows nothing about
  // political timezones or DST: Madrid rendered 2h15m out AND on the wrong
  // calendar day, Kashgar ~3h out. Sitting behind a single «·» next to a
  // coordinate quoted verbatim to its stored precision, the exact datum lent the
  // estimate an authority it had not earned, and «≈» does not communicate ±3
  // hours. Same rule as the absent listener count: omit rather than estimate.
  // A clock may come back only with a real IANA zone behind it.
  await withPool(page, stations.slice(0, 8));
  await openFeed(page);

  const geo = focusedCard(page).locator('.station-feed-card-geo');
  await expect(geo).toBeVisible();
  await expect(geo).not.toContainText(/\d{1,2}:\d{2}/);
  await expect(geo).not.toContainText('≈');
  await expect(focusedCard(page).locator('.station-feed-card-clock')).toHaveCount(0);
});

test('OMITS the geo line when the station carries no coordinates at all', async ({ page }) => {
  await withPool(
    page,
    stations.slice(0, 8).map((s) => ({ ...s, geo_lat: null, geo_long: null }))
  );
  await openFeed(page);

  await expect(focusedCard(page).locator('.station-feed-card-geo')).toHaveCount(0);
  // The rest of the stack is unaffected — each line is independent.
  await expect(focusedCard(page).locator('.station-feed-card-name')).toBeVisible();
  await expect(focusedCard(page).locator('.station-feed-card-place')).toBeVisible();
});

test('OMITS the geo line when the coordinates would be SYNTHESIZED, not the station\'s', async ({
  page
}) => {
  // Coordinates far outside the country the station claims. geoResolver's
  // country-bbox sanity check rejects them and falls back to a country-pool /
  // country-centroid position — a point WE invent so the Globe has a dot to
  // draw. Good enough to place a dot, never good enough to print as fact.
  await withPool(
    page,
    stations.slice(0, 8).map((s) => ({ ...s, country: 'Japan', geo_lat: -33.87, geo_long: -70.66 }))
  );
  await openFeed(page);

  await expect(focusedCard(page).locator('.station-feed-card-geo')).toHaveCount(0);
});

test('OMITS the place and genre lines when those fields are empty (no fallback literals)', async ({
  page
}) => {
  await withPool(
    page,
    stations.slice(0, 8).map((s) => ({
      ...s,
      tags: '',
      country: '',
      state: '',
      geo_lat: null,
      geo_long: null
    }))
  );
  await openFeed(page);

  const card = focusedCard(page);
  await expect(card.locator('.station-feed-card-place')).toHaveCount(0);
  await expect(card.locator('.station-feed-card-genres')).toHaveCount(0);
  // stationTags / stationLocation default to the untranslated literals
  // 'No tags' / 'Unknown location' — they must never leak (that bug already
  // ships on the Home hero). We call them with '' and branch on empty.
  await expect(card).not.toContainText(/No tags|Unknown location/i);

  // The name takes the space back so a sparse card reads as intentional rather
  // than as a layout with holes in it.
  const lines = await card.locator('.station-feed-card-info').getAttribute('data-lines');
  expect(Number(lines)).toBeLessThanOrEqual(1);
  const nameSize = await card
    .locator('.station-feed-card-name')
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(nameSize).toBeGreaterThan(30);
});

test('NEVER renders a listener count — no such datum reaches the client', async ({ page }) => {
  // votes / clicktrend / clickcount exist only on the API's CatalogStation and
  // are dropped by toStationLite's whitelist projection, so the reference's
  // «12K слушают» line has no data behind it for ANY station. It is omitted
  // entirely rather than zeroed or estimated. Even when the wire carries the
  // counts, nothing may surface them.
  await withPool(
    page,
    stations.slice(0, 8).map((s) => ({ ...s, votes: 12345, clickcount: 12345, clicktrend: 99 }))
  );
  await openFeed(page);

  // Deliberately NOT a bare /слуша/ — that would match the «Свайпай и слушай»
  // tagline. These are the shapes a listener COUNT would actually take.
  const overlay = page.locator('.station-feed-overlay');
  await expect(overlay).not.toContainText(/слушают|слушателей|listeners?\b/i);
  await expect(overlay).not.toContainText(/12345/);
  await expect(overlay).not.toContainText(/\b12\s?[KКkк]\b/);
});
