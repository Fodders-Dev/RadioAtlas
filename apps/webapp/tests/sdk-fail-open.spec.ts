import { expect, test } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState } from './helpers';

test('a hanging Telegram SDK request cannot hold the app on a blank screen', async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page);

  let releaseSdkRoute = () => {};
  const stalledSdkRequest = new Promise<void>((resolve) => {
    releaseSdkRoute = resolve;
  });

  // Playwright routes are LIFO, so this deliberately overrides the inert SDK
  // response installed by installMediaMocks. Resolve it in finally so teardown
  // never inherits a permanently pending route handler.
  await page.route('**/vendor/telegram-web-app.js', async (route) => {
    await stalledSdkRequest;
    await route.abort().catch(() => {});
  });

  try {
    await page.goto('/?api=/api', { waitUntil: 'commit' });
    await expect(page.locator('.app-shell-v2')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-home-feed-entry]')).toBeVisible();
  } finally {
    releaseSdkRoute();
  }
});

test('Telegram integrations initialise when the async SDK arrives after React', async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page);

  let releaseSdkRoute = () => {};
  const delayedSdkResponse = new Promise<void>((resolve) => {
    releaseSdkRoute = resolve;
  });

  await page.route('**/vendor/telegram-web-app.js', async (route) => {
    await delayedSdkResponse;
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        window.__lateTelegramCalls = { ready: 0, expand: 0, disableVerticalSwipes: 0 };
        window.Telegram = { WebApp: {
          initData: 'late-init-data',
          initDataUnsafe: { user: { id: 12345 } },
          platform: 'android',
          version: '8.0',
          themeParams: {},
          ready: () => { window.__lateTelegramCalls.ready += 1; },
          expand: () => { window.__lateTelegramCalls.expand += 1; },
          disableVerticalSwipes: () => { window.__lateTelegramCalls.disableVerticalSwipes += 1; },
          onEvent: () => {},
          offEvent: () => {}
        } };
      `
    });
  });

  await page.goto('/?api=/api', { waitUntil: 'commit' });
  await expect(page.locator('.app-shell-v2')).toBeVisible({ timeout: 15_000 });

  releaseSdkRoute();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const calls = Reflect.get(window, '__lateTelegramCalls') as
          | {
          ready: number;
          expand: number;
          disableVerticalSwipes: number;
            }
          | undefined;
        return Boolean(
          calls && calls.ready > 0 && calls.expand > 0 && calls.disableVerticalSwipes > 0
        );
      })
    )
    .toBe(true);

  const calls = await page.evaluate(
    () =>
      Reflect.get(window, '__lateTelegramCalls') as {
        ready: number;
        expand: number;
        disableVerticalSwipes: number;
      }
  );
  expect(calls.ready).toBeGreaterThan(0);
  expect(calls.expand).toBeGreaterThan(0);
  expect(calls.disableVerticalSwipes).toBeGreaterThan(0);
});
