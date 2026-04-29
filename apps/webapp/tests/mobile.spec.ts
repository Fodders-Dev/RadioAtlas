import { expect, test, type Page } from '@playwright/test';
import {
  installMediaMocks,
  mockStations,
  playHomeStation,
  seedRadioState,
  stations
} from './helpers';
import {
  DENSE_SEARCH_PREVIEW_LIMIT,
  filterPreviewStations
} from '../src/screens/homePreview';
import { findNearestAreaToRotation } from '../src/components/globe/selection';

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

const expectNoHomeHorizontalOverflow = async (page: Page) => {
  const overflowing = await page.locator('.screen-home-next *').evaluateAll((nodes) =>
    nodes
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.left < -1 || rect.right > document.documentElement.clientWidth + 1;
      })
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          tag: node.tagName,
          className: String(node.getAttribute('class') || ''),
          left: rect.left,
          right: rect.right
        };
      })
  );
  expect(overflowing).toEqual([]);
};

const expectNoGlobeHorizontalOverflow = async (page: Page) => {
  const overflowing = await page.locator('.screen-globe-v2 *').evaluateAll((nodes) =>
    nodes
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.left < -1 || rect.right > document.documentElement.clientWidth + 1;
      })
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          tag: node.tagName,
          className: String(node.getAttribute('class') || ''),
          left: rect.left,
          right: rect.right
        };
      })
  );
  expect(overflowing).toEqual([]);
};

const summaryBody = (generatedAt = Date.UTC(2026, 3, 20, 9, 0, 0)) =>
  JSON.stringify({
    generatedAt,
    counts: {
      stations: stations.length,
      countries: 3,
      languages: 3,
      genres: 8
    },
    catalogPool: stations.slice(0, 8),
    freshSignals: stations.slice(0, 6),
    searchLaunch: stations.slice(0, 6),
    sponsored: stations.slice(0, 2),
    countrySpotlight: {
      label: 'Japan',
      stations: stations.slice(0, 4)
    },
    genreSpotlight: {
      label: 'jpop',
      stations: stations.slice(0, 4)
    }
  });

test('home local preview filter caps dense results', () => {
  const matches = filterPreviewStations(stations, 'jpop', DENSE_SEARCH_PREVIEW_LIMIT);

  expect(matches.length).toBeLessThanOrEqual(DENSE_SEARCH_PREVIEW_LIMIT);
  expect(matches.map((station) => station.name)).toEqual(['Tokyo FM', 'Osaka Nights']);
});

test('globe nearest helper selects the reticle area', () => {
  const nearest = findNearestAreaToRotation(
    [
      { id: 'asia-japan', lat: 35.68, lon: 139.69 },
      { id: 'europe-iceland', lat: 64.1466, lon: -21.9426 },
      { id: 'south-america-brazil', lat: -22.9068, lon: -43.1729 }
    ],
    [21.9426, -64.1466, 0]
  );

  expect(nearest?.id).toBe('europe-iceland');
});

for (const width of [360, 390]) {
  test(`mobile home dense keeps only hero resume and one rail at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 844 });
    await seedRadioState(page, {
      recent: [stations[0]],
      playbackHistory: [stations[1]],
      queue: [stations[2]]
    });

    await page.goto('/');
    await expect(page.locator('[data-home-hero]')).toBeVisible();

    await expect(page.locator('.screen-home-next')).toHaveAttribute('data-density', 'dense');
    await expect(page.locator('.home-search-launcher')).toHaveCount(0);
    await expect(page.locator('#home-search-launcher')).toHaveCount(0);
    await expect(page.locator('[data-home-search-preview]')).toHaveCount(0);
    await expect(page.locator('.home-explore-card')).toHaveCount(0);
    await expect(page.locator('.home-hero-companions')).toHaveCount(0);
    await expect(page.locator('[data-home-resume="true"]')).toBeVisible();
    await expect(page.locator('[data-home-rail]')).toHaveCount(1);
    await expectNoHomeHorizontalOverflow(page);

    await page.locator('[data-home-rail] [data-home-station] .home-action-btn-play').first().click();
    await expect(page.locator('.player-dock-bar')).toBeVisible();
  });
}

for (const width of [360, 390]) {
  test(`mobile globe uses reticle tuning and a visible focus sheet at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 844 });

    await page.goto('/');
    await page.locator('.app-navigation-mobile').getByRole('button', { name: /Глобус|Globe/ }).click();

    await expect(page.locator('.screen-globe-v2')).toHaveAttribute('data-density', 'dense');
    await expect(page.locator('.globe-reticle')).toBeVisible();
    await expect(page.locator('[data-globe-tune]')).toBeVisible();
    await expect(page.locator('.globe-hint')).not.toContainText(/scroll|колес/i);
    await expect(page.locator('.globe-focus-card .station-row').first()).toBeVisible();
    await expectNoGlobeHorizontalOverflow(page);

    const sheetRect = await page.locator('.globe-focus-card').evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        viewportHeight: window.innerHeight,
        scrollY: window.scrollY
      };
    });
    expect(sheetRect.top).toBeLessThan(sheetRect.viewportHeight - 80);
    expect(sheetRect.bottom).toBeGreaterThan(sheetRect.top + 80);
    expect(sheetRect.scrollY).toBe(0);

    await page.locator('[data-globe-clear]').click();
    await expect(page.locator('.screen-globe-v2')).toHaveAttribute('data-zoom-level', '1.00');
    await expect(page.locator('[data-globe-clear]')).toHaveCount(0);

    await page.locator('[data-globe-tune]').click();
    await expect(page.locator('[data-globe-clear]')).toBeVisible();
    await expect(page.locator('.globe-focus-card .station-row').first()).toBeVisible();

    await page.locator('.globe-focus-card .station-compact-toggle').first().click();
    await expect(page.locator('.player-dock-bar')).toBeVisible();
  });
}

test('home cold load shows hero skeleton while summary is pending', async ({ page }) => {
  await page.unroute('**/catalog/summary**');
  await page.route('**/catalog/summary**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: summaryBody()
    });
  });

  await page.goto('/');
  await expect(page.locator('.screen-skeleton-home-hero')).toBeVisible();
  await expect(page.locator('[data-home-hero]')).toBeVisible();
});

test('home typing uses local preview without catalog search requests', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 900 });
  const searchRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/catalog/search') || url.includes('/json/stations/search')) {
      searchRequests.push(url);
    }
  });

  await page.goto('/');
  await expect(page.locator('#home-search-launcher')).toBeVisible();
  await page.locator('#home-search-launcher').fill('Tokyo');
  await page.waitForTimeout(450);

  expect(searchRequests).toEqual([]);
  await expect(page.locator('[data-home-search-preview] [data-home-station]')).toHaveCount(1);
});

test('home summary error banner is one-shot and clears after summary succeeds', async ({ page }) => {
  let attempts = 0;
  await page.unroute('**/catalog/summary**');
  await page.route('**/catalog/summary**', async (route) => {
    attempts += 1;
    if (attempts <= 2) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'summary fixture failed' })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: summaryBody(Date.UTC(2026, 3, 20, 10, 0, 0))
    });
  });

  await page.goto('/');
  await expect(page.locator('.home-status-banner')).toBeVisible();
  await page.locator('.home-status-banner .home-inline-link').click();
  await expect(page.locator('.home-status-banner')).toHaveCount(0);
  const fallbackRefresh = page.locator('.home-hero-empty .home-secondary-btn');
  if (await fallbackRefresh.isVisible().catch(() => false)) {
    await fallbackRefresh.click();
  }
  await expect(page.locator('[data-home-hero]')).toBeVisible();
  await expect(page.locator('.home-status-banner')).toHaveCount(0);
});

test('player peek label clamps long station names', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await expect(page.locator('.player-peek-label')).toBeVisible();
  const styles = await page.locator('.player-peek-label').evaluate((node) => {
    node.textContent = 'Very long station name aaa aaa aaa aaa aaa aaa aaa aaa aaa';
    const computed = window.getComputedStyle(node);
    return {
      maxWidth: computed.maxWidth,
      overflow: computed.overflow,
      textOverflow: computed.textOverflow,
      whiteSpace: computed.whiteSpace,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    };
  });

  expect(styles.maxWidth).toBe('216px');
  expect(styles.overflow).toBe('hidden');
  expect(styles.textOverflow).toBe('ellipsis');
  expect(styles.whiteSpace).toBe('nowrap');
  expect(styles.scrollWidth).toBeLessThanOrEqual(styles.clientWidth);
});

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

test('mobile settings can open lite fullscreen shell without an active station', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-home-hero]')).toBeVisible();

  await page.getByRole('button', { name: 'Настройки' }).first().click();
  await expect(page.locator('.settings-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Открыть полноэкранный плеер' }).click();

  await expect(page.locator('.winamp-compact.fullscreen-ui')).toBeVisible();
  await expect(page.locator('.winamp-compact[data-winamp-mode="lite"]')).toBeVisible();
  await expect(page.locator('[data-winamp-lite-panel="true"]')).toBeVisible();
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
