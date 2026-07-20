import { expect, test } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

// «Что слушают сейчас» — the rail is driven by REAL presence counts, so the
// contract that matters is: nothing to show → nothing rendered. No placeholder
// row, no "пока тихо" filler, no padding with popularity data.

test('no live listeners anywhere → the block does not exist at all', async ({ page }) => {
  await installMediaMocks(page); // pins /listening/live to an empty list
  await mockStations(page);
  await seedRadioState(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible({ timeout: 15_000 });

  await expect(page.locator('[data-home-rail="home-live-now"]')).toHaveCount(0);
  await expect(page.getByText('Слушают сейчас')).toHaveCount(0);
});

test('stations with real listeners are shown, in the order the server ranked them', async ({
  page
}) => {
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page);
  // Override the pinned empty response with a populated one.
  await page.route('**/listening/live**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        minListeners: 3,
        stations: [
          { stationId: stations[1].stationuuid, listeners: 7 },
          { stationId: stations[0].stationuuid, listeners: 4 },
          { stationId: 'not-in-our-catalog', listeners: 99 }
        ]
      })
    })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible({ timeout: 15_000 });

  const rail = page.locator('[data-home-rail="home-live-now"]');
  await expect(rail).toBeVisible();

  // Exactly the two stations we could resolve — the unknown id is dropped
  // rather than rendered as a nameless row.
  const tiles = rail.locator('[data-home-station]');
  await expect(tiles).toHaveCount(2);
  await expect(tiles.nth(0)).toContainText(stations[1].name);
  await expect(tiles.nth(1)).toContainText(stations[0].name);
});

test('a failing endpoint degrades to silence, never to a broken-looking block', async ({
  page
}) => {
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page);
  await page.route('**/listening/live**', (route) => route.fulfill({ status: 500, body: '' }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible({ timeout: 15_000 });

  await expect(page.locator('[data-home-rail="home-live-now"]')).toHaveCount(0);
});
