import { expect, test } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

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
    await seedRadioState(page, { stationCache: stations });
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
    await expect(page.locator('[data-home-feed-entry], [data-home-rail]').first()).toBeVisible({
      timeout: 15_000
    });
  });

  // T_audit_6: a stale-chunk error after a deploy reloads exactly once
  // (loop-safe). Trigger the chunk-shaped error AFTER pre-setting the
  // cooldown timestamp — the boundary must NOT reload again, must surface
  // the fallback, and leave the recorded timestamp untouched.
  test('T_audit_6: chunk-shaped error inside the cooldown shows the fallback without looping', async ({
    page
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as {
        __radioatlasForceScreenError__?: boolean;
        __radioatlasForceErrorMessage__?: string;
      };
      w.__radioatlasForceScreenError__ = true;
      w.__radioatlasForceErrorMessage__ =
        'Failed to fetch dynamically imported module: assets/Home-abc123.js';
      // Pretend a previous reload happened 2s ago — inside the 10s cooldown,
      // so this error must NOT trigger another reload.
      sessionStorage.setItem('radioatlas:chunkReloadAt', String(Date.now() - 2000));
    });

    await page.goto('/');

    // Fallback is shown (no infinite reload).
    await expect(page.locator('.error-boundary-fallback[role="alert"]')).toBeVisible();
    // Cooldown timestamp is preserved — boundary did not bump it again.
    const ts = await page.evaluate(() => sessionStorage.getItem('radioatlas:chunkReloadAt'));
    const age = Date.now() - Number(ts || '0');
    expect(age).toBeGreaterThan(500); // i.e. still the pre-set 2s-ago value, not "now"
    expect(age).toBeLessThan(20_000);
  });
});
