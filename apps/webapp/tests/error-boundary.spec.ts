import { expect, test } from '@playwright/test';
import { installMediaMocks, mockStations } from './helpers';

// T1.7: a render crash in a screen is contained by the screen-level
// ErrorBoundary — the app shell stays alive and the user can recover.

test.describe('screen error boundary', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installMediaMocks(page);
    await mockStations(page);
  });

  test('contains a screen crash, keeps the shell alive, and recovers on retry', async ({
    page
  }) => {
    // Force the screen-level ErrorProbe to throw on first render.
    await page.addInitScript(() => {
      (window as unknown as { __radioatlasForceScreenError__?: boolean }).__radioatlasForceScreenError__ =
        true;
    });
    await page.goto('/');

    // Fallback is shown...
    const fallback = page.locator('.error-boundary-fallback[role="alert"]');
    await expect(fallback).toBeVisible();
    await expect(fallback).toContainText(/Не удалось загрузить раздел|Couldn't load this section/);

    // ...but the app shell survives (bottom nav still renders + is usable).
    await expect(page.locator('.app-navigation-mobile')).toBeVisible();
    await expect(
      page.locator('.app-navigation-mobile').getByRole('button', { name: /Поиск|Search/ })
    ).toBeEnabled();

    // Clear the forced error, then retry -> the screen remounts cleanly.
    await page.evaluate(() => {
      delete (window as unknown as { __radioatlasForceScreenError__?: boolean })
        .__radioatlasForceScreenError__;
    });
    await page.getByRole('button', { name: /Повторить|Retry/ }).click();

    await expect(page.locator('.error-boundary-fallback')).toHaveCount(0);
    // Home content renders after recovery.
    await expect(page.locator('[data-home-rail], #home-search-launcher').first()).toBeVisible();
  });
});
