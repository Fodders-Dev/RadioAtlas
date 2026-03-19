import { expect, test } from '@playwright/test';
import { installMediaMocks, mockStations, playHomeStation } from './helpers';

test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
});

test('desktop shell keeps navigation, queue, and expanded winamp flow intact', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.app-navigation-desktop')).toBeVisible();
  await expect(page.locator('.app-topbar-title')).toHaveText('Главная');
  await expect(page.getByRole('heading', { name: /Радио мира/i })).toBeVisible();

  await playHomeStation(page, 'Tokyo FM');

  await expect(page.locator('.player-dock-bar')).toBeVisible();
  await expect(page.locator('.player-dock-title')).toContainText('Tokyo FM');

  await page.getByRole('button', { name: 'Winamp' }).click();
  await expect(page.locator('.winamp-compact.fullscreen-ui')).toBeVisible();
  await expect(page.locator('#webamp')).toHaveCount(1, { timeout: 15_000 });

  await page.evaluate(() => {
    (document.querySelector('.winamp-overlay-header .winamp-close-btn') as HTMLButtonElement | null)?.click();
  });
  await expect(page.locator('.player-dock-bar')).toBeVisible();

  await page.getByRole('button', { name: 'Медиатека' }).first().click();
  await expect(page.locator('.app-topbar-title')).toHaveText('Медиатека');
  await page.getByRole('button', { name: 'Очередь' }).click();
  await expect(page.locator('.playlist-row.active')).toContainText('Tokyo FM');
});

test('search shell exposes filter drawer and station results on desktop', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Поиск' }).first().click();
  await expect(page.locator('.search-shell-header')).toBeVisible();

  await page.getByRole('button', { name: 'Показать фильтры' }).click();
  await expect(page.locator('.search-filters-drawer')).toBeVisible();

  await page.locator('.search-primary-card input').first().fill('Berlin');
  await expect(page.locator('.search-results-shell .station-row').filter({ hasText: 'Berlin Pulse' }).first()).toBeVisible();
});
