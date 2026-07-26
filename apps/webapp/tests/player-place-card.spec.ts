import { expect, test } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState } from './helpers';

/**
 * The player's middle band used to be dead space above the transport. It now
 * carries the one thing only a radio atlas can answer — where this signal comes
 * from — drawn from the real countries-110m geometry the globe already ships.
 *
 * The rule under test is the HONESTY one. Only 21% of the catalogue carries
 * geo_lat/geo_long; everyone else resolves to a country centroid, which is not
 * where the station is. Those must get the country lit and NO pin and NO
 * coordinates.
 */
const openStage = async (page: import('@playwright/test').Page, query: string) => {
  await page.locator('#search-hero-input').first().fill(query);
  await expect(page.locator('[data-search-station-card]').first()).toBeVisible();
  await page.getByRole('button', { name: /Играть выдачу|Play results/ }).click();
  await expect(page.locator('.player-dock-bar')).toBeVisible();
  await page
    .locator('.player-dock-artwork-trigger')
    .evaluate((node) => (node as HTMLButtonElement).click());
  await expect(page.locator('[data-full-player-overlay]')).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page, { activeSection: 'search' });
});

test('a station with real coordinates gets a pin and a readout', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/?api=/api');
  await openStage(page, 'Tokyo');

  const card = page.locator('[data-station-place]');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-precise', 'true');

  // Real geometry, not a placeholder box.
  const pathLength = await card.locator('.station-place-country').evaluate(
    (node) => (node as SVGPathElement).getAttribute('d')?.length ?? 0
  );
  expect(pathLength).toBeGreaterThan(200);

  await expect(card.locator('.station-place-beacon')).toHaveCount(1);
  // Tokyo FM's fixture carries geo_lat 35.6895 / geo_long 139.6917.
  await expect(card.locator('.station-place-coords')).toContainText('35.6895° N');
  await expect(card.locator('.station-place-coords')).toContainText('139.6917° E');
});

test('the map is dropped, not squashed, when the stage cannot afford it', async ({ page }) => {
  // The stage is a fixed-height flex column with overflow:hidden. At 360x640
  // the card collapsed to 68px and the readout sat on top of the country — a
  // box that clips its own contents must never be shrinkable.
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/?api=/api');
  await openStage(page, 'Tokyo');

  await expect(page.locator('[data-station-place]')).toBeHidden();
  await expect(page.locator('.full-player-controls')).toBeVisible();
});
