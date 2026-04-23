import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

const waitForStableMetrics = async (
  page: Page,
  selector?: string,
  timeoutMs = 6000
) => {
  let previous = '';
  let stableTicks = 0;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = JSON.stringify(
      await page.evaluate((targetSelector) => {
        const target = targetSelector
          ? document.querySelector(targetSelector)
          : document.documentElement;
        const rect = target?.getBoundingClientRect();
        return {
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
          targetWidth: rect ? Math.round(rect.width) : 0,
          targetHeight: rect ? Math.round(rect.height) : 0
        };
      }, selector)
    );

    if (snapshot === previous) {
      stableTicks += 1;
      if (stableTicks >= 2) {
        break;
      }
    } else {
      previous = snapshot;
      stableTicks = 0;
    }

    await page.waitForTimeout(180);
  }

  await page.evaluate(() => window.scrollTo(0, 0));
};

const openWinampShell = async (page: Page) => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      await page.goto('/?api=/api');
    }
    await page.locator('.nav-rail-item').filter({ hasText: 'Поиск' }).first().click();
    await page.locator('.station-row .play-btn').first().click();
    const winampTrigger = page.locator('.player-dock-artwork-trigger');
    await expect(winampTrigger).toBeVisible();
    await winampTrigger.hover();
    await page.waitForTimeout(250);
    await winampTrigger.click({ force: true });
    try {
      await expect(page.locator('.app-shell-v2')).toHaveAttribute('data-winamp-expanded', 'true', {
        timeout: 5000
      });
      await expect
        .poll(
          async () =>
            page.evaluate(
              () => Boolean(document.querySelector('.winamp-overlay-footer') || document.querySelector('#webamp'))
            ),
          { timeout: 25000 }
        )
        .toBe(true);
      return;
    } catch (error) {
      if (attempt === 1) {
        throw error;
      }
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);
    }
  }
};

const openHome = async (
  page: Page,
  options?: Parameters<typeof seedRadioState>[1]
) => {
  await seedRadioState(page, options);
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-hero]')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(180);
  await waitForStableMetrics(page);
};

const readHomeSurfaceSignature = async (page: Page) =>
  page.evaluate(() => ({
    hero: document.querySelector('[data-home-hero]')?.getAttribute('data-home-hero') || null,
    rails: Array.from(document.querySelectorAll('[data-home-rail]')).map((node) => ({
      id: node.getAttribute('data-home-rail'),
      stations: Array.from(node.querySelectorAll('[data-home-station]')).map((item) =>
        item.getAttribute('data-home-station')
      )
    }))
  }));

test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await page.setViewportSize({ width: 1440, height: 960 });
});

test('home shell visual baseline', async ({ page }) => {
  await openHome(page);
  const screenshot = await page.screenshot({
    animations: 'disabled'
  });
  expect(screenshot).toMatchSnapshot('home-shell.png', {
    maxDiffPixels: 10_000
  });
});

test('home shell mobile visual baseline', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page);
  await expect(page).toHaveScreenshot('home-shell-mobile.png', {
    animations: 'disabled',
    fullPage: true
  });
});

test('home shell populated visual baseline', async ({ page }) => {
  await openHome(page, {
    favorites: [stations[4], stations[8]],
    recent: [stations[1], stations[6], stations[9]],
    playbackHistory: [stations[0], stations[4], stations[8]],
    queue: [stations[1], stations[6], stations[9]]
  });
  await expect(page).toHaveScreenshot('home-shell-populated.png', {
    animations: 'disabled',
    fullPage: true
  });
});

test('home surface stays stable during like and play actions', async ({ page }) => {
  await openHome(page);
  const before = await readHomeSurfaceSignature(page);

  await page.locator('[data-home-rail] .home-action-btn-like').first().click();
  await page.locator('[data-home-hero] .home-primary-btn').click();
  await expect(page.locator('[data-home-resume]')).toBeVisible();

  const after = await readHomeSurfaceSignature(page);
  expect(after).toEqual(before);
});

test('home refresh rebuilds the discovery surface', async ({ page }) => {
  await openHome(page);
  const before = JSON.stringify(await readHomeSurfaceSignature(page));
  await page.locator('.home-refresh-chip').click();
  await expect
    .poll(async () => JSON.stringify(await readHomeSurfaceSignature(page)))
    .not.toBe(before);
});

test('search screen visual baseline', async ({ page }) => {
  await openHome(page);
  await page.locator('.nav-rail-item').filter({ hasText: 'Поиск' }).first().click();
  await expect(page.locator('.station-row:not(.header)')).toHaveCount(stations.length);
  await waitForStableMetrics(page, '.screen-search-v2');
  const screenshot = await page.screenshot({
    animations: 'disabled',
    fullPage: true
  });
  expect(screenshot).toMatchSnapshot('search-screen.png');
});

test('library screen visual baseline', async ({ page }) => {
  await openHome(page);
  await page.locator('.nav-rail-item').filter({ hasText: 'Медиатека' }).first().click();
  await expect(page).toHaveScreenshot('library-screen.png', {
    animations: 'disabled',
    fullPage: true
  });
});

test('winamp overlay visual baseline', async ({ page }) => {
  await seedRadioState(page);
  await page.goto('/?api=/api');
  await openWinampShell(page);
  await page.evaluate(() => {
    (
      window as Window & {
        __radioAtlasWinamp?: {
          resetExpandedLayout?: () => void;
        };
      }
    ).__radioAtlasWinamp?.resetExpandedLayout?.();
  });
  await page.waitForTimeout(900);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    active?.blur?.();
  });
  await page.addStyleTag({
    content: `
      .winamp-loading {
        opacity: 0 !important;
      }
      .winamp-overlay-visualizer-card {
        visibility: hidden !important;
      }
      .winamp-overlay-visualizer > * {
        opacity: 0 !important;
      }
    `
  });
  await expect(page.locator('.winamp-overlay-label').first()).not.toContainText('winamp.');
  await waitForStableMetrics(page, '.winamp-overlay-footer');
  await expect(page.locator('.winamp-overlay-footer .winamp-trackline-label')).toContainText('Mock Song');
  await expect(
    page.locator('.winamp-overlay-footer .winamp-actions.overlay').getByRole('button', { name: 'Пауза' })
  ).toBeVisible();
  const footerShot = await page.locator('.winamp-overlay-footer').screenshot({
    animations: 'disabled'
  });
  expect(footerShot).toMatchSnapshot('winamp-overlay.png');
});

test('winamp runtime shell visual baseline', async ({ page }) => {
  await seedRadioState(page);
  await page.goto('/?api=/api');
  await openWinampShell(page);
  await page.evaluate(() => {
    (
      window as Window & {
        __radioAtlasWinamp?: {
          resetExpandedLayout?: () => void;
        };
      }
    ).__radioAtlasWinamp?.resetExpandedLayout?.();
  });
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.addStyleTag({
    content: `
      .winamp-loading {
        opacity: 0 !important;
      }
      .winamp-overlay-visualizer > * {
        opacity: 0 !important;
      }
      .ra-visualizer-overlay {
        opacity: 0 !important;
      }
    `
  });
  const runtimeShot = await page.screenshot({
    animations: 'disabled'
  });
  expect(runtimeShot).toMatchSnapshot('winamp-runtime-shell.png', {
    maxDiffPixels: 400
  });
});
