import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, playHomeStation, seedRadioState } from './helpers';

test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page);
  await page.setViewportSize({ width: 390, height: 844 });
});

const enableTelegramMobileSafeMode = async (page: Page) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      configurable: true,
      value: 2
    });
    Object.defineProperty(navigator, 'deviceMemory', {
      configurable: true,
      value: 2
    });
    Object.defineProperty(navigator, 'maxTouchPoints', {
      configurable: true,
      value: 5
    });
    Object.defineProperty(window, 'Telegram', {
      configurable: true,
      value: {
        WebApp: {
          platform: 'ios',
          version: '8.0',
          initData: 'test-init-data',
          initDataUnsafe: {
            user: {
              id: 1
            }
          },
          ready() {},
          expand() {}
        }
      }
    });
  });
};

test('mobile startup stays free of playback runtime render loops', async ({ page }) => {
  const runtimeWarnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.includes('Maximum update depth exceeded')) {
      runtimeWarnings.push(text);
    }
  });

  await page.goto('/');
  await expect(page.locator('[data-home-hero]')).toBeVisible();
  await page.waitForTimeout(600);

  expect(runtimeWarnings).toEqual([]);
});

test('mobile shell keeps dock and bottom nav separately tappable', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-home-hero]')).toBeVisible();

  await expect(page.locator('.app-navigation-mobile')).toBeVisible();
  await expect(page.locator('.player-dock-peek')).toBeVisible();

  await playHomeStation(page, 'Tokyo FM');

  await expect(page.locator('.player-dock-bar')).toBeVisible();
  await expect(page.locator('.app-navigation-mobile')).toBeVisible();
  await expect(page.locator('.player-dock-title')).toContainText('Tokyo FM');

  await page.locator('.player-dock-artwork-trigger').evaluate((node) => {
    (node as HTMLButtonElement).click();
  });
  await expect(page.locator('.winamp-compact.fullscreen-ui')).toBeVisible();
  await expect(page.locator('.winamp-compact[data-winamp-mode="lite"]')).toBeVisible();
  await expect(page.locator('[data-winamp-lite-panel="true"]')).toBeVisible();

  await page.locator('.winamp-overlay-header .winamp-close-btn').click();
  await expect(page.locator('.player-dock-bar')).toBeVisible();
});

test('mobile library queue survives navigation after playback starts', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-home-hero]')).toBeVisible();

  await playHomeStation(page, 'Tokyo FM');
  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Медиатека' }).evaluate((node) => {
    (node as HTMLButtonElement).click();
  });
  await page
    .locator('.library-tab-chip')
    .filter({ hasText: 'Очередь' })
    .first()
    .evaluate((node) => {
      (node as HTMLButtonElement).click();
    });

  await expect(page.locator('.playlist-row.active')).toContainText('Tokyo FM');
  await expect(page.locator('.app-navigation-mobile')).toBeVisible();
});

test('telegram mobile playback sticks to proxy transport candidates', async ({ page }) => {
  await enableTelegramMobileSafeMode(page);
  await page.goto('/?tgWebAppPlatform=ios');
  await expect(page.locator('[data-home-hero]')).toBeVisible();

  await playHomeStation(page, 'Tokyo FM');

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const audio = document.querySelector('audio');
        return audio instanceof HTMLAudioElement ? audio.dataset.raTransportMode || null : null;
      })
    )
    .toBe('proxy');
});

test('telegram mobile fullscreen falls back to lite winamp mode', async ({ page }) => {
  await enableTelegramMobileSafeMode(page);
  await page.goto('/?tgWebAppPlatform=ios');
  await expect(page.locator('[data-home-hero]')).toBeVisible();

  await playHomeStation(page, 'Tokyo FM');
  await page.locator('.player-dock-artwork-trigger').evaluate((node) => {
    (node as HTMLButtonElement).click();
  });

  await expect(page.locator('.winamp-compact.fullscreen-ui')).toBeVisible();
  await expect(page.locator('.winamp-compact[data-winamp-mode="lite"]')).toBeVisible();
  await expect(page.locator('[data-winamp-lite-panel="true"]')).toBeVisible();
  await expect(page.locator('.winamp-overlay-visualizer-card')).toHaveCount(0);
});
