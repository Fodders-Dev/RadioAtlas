import { expect, test } from '@playwright/test';
import { installMediaMocks, mockStations, playHomeStation } from './helpers';

test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await page.setViewportSize({ width: 390, height: 844 });
});

test('mobile shell keeps dock and bottom nav separately tappable', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.app-navigation-mobile')).toBeVisible();
  await expect(page.locator('.player-dock-peek')).toBeVisible();

  await playHomeStation(page, 'Tokyo FM');

  await expect(page.locator('.player-dock-bar')).toBeVisible();
  await expect(page.locator('.app-navigation-mobile')).toBeVisible();
  await expect(page.locator('.player-dock-title')).toContainText('Tokyo FM');

  await page.getByRole('button', { name: 'Winamp' }).click();
  await expect(page.locator('.winamp-compact.fullscreen-ui')).toBeVisible();
  await expect(page.locator('#webamp')).toHaveCount(1, { timeout: 15_000 });

  await page.locator('.winamp-overlay-header .winamp-close-btn').click();
  await expect(page.locator('.player-dock-bar')).toBeVisible();
});

test('mobile library queue survives navigation after playback starts', async ({ page }) => {
  await page.goto('/');

  await playHomeStation(page, 'Tokyo FM');
  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Медиатека' }).click();
  await page.getByRole('button', { name: 'Очередь' }).click();

  await expect(page.locator('.playlist-row.active')).toContainText('Tokyo FM');
  await expect(page.locator('.app-navigation-mobile')).toBeVisible();
});
