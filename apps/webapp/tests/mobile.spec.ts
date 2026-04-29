import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
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

const UPLOAD_SKIN_PATH = fileURLToPath(new URL('../public/winamp-skins/base-2.91.wsz', import.meta.url));

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

const expectNoDocumentHorizontalOverflow = async (page: Page) => {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
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

const mockSkinMuseumSearch = async (page: Page) => {
  const purpleSkin = {
    md5: 'purple-dream-md5',
    filename: 'Purple_Dream.wsz',
    download_url: 'http://127.0.0.1:5173/winamp-skins/base-2.91.wsz',
    screenshot_url: null,
    museum_url: 'https://skins.webamp.org/skin/purple-dream-md5/Purple_Dream.wsz',
    nsfw: false
  };

  await page.route('https://skins.webamp.org/graphql', async (route) => {
    const body = route.request().postDataJSON() as { query?: string } | null;
    const responseBody = body?.query?.includes('fetch_skin_by_md5')
      ? { data: { fetch_skin_by_md5: purpleSkin } }
      : { data: { search_classic_skins: [purpleSkin] } };

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(responseBody)
    });
  });
};

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

test('mobile cold load mounts the peek dock immediately', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.app-navigation-mobile')).toBeVisible();
  await expect(page.locator('.player-dock-peek')).toBeVisible({ timeout: 1000 });
});

test('dock separates empty explore from queue controls', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');

  await page.locator('.player-peek-handle').click();
  await expect(page.locator('.player-dock-bar')).toBeVisible();
  await expect(page.locator('.dock-queue-btn')).toHaveCount(0);
  await expect(page.locator('.dock-explore-btn')).toBeVisible();

  await page.locator('.dock-explore-btn').click();
  await expect(page.locator('.screen-search-v2')).toBeVisible();
});

test('dock shows queue control only when queue has items', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page, {
    queue: stations.slice(0, 3)
  });

  await page.goto('/');
  await page.locator('.player-peek-handle').click();
  await expect(page.locator('.player-dock-bar')).toBeVisible();
  await expect(page.locator('.dock-queue-btn')).toBeVisible();
  await expect(page.locator('.dock-explore-btn')).toHaveCount(0);

  await page.locator('.dock-queue-btn').click();
  await expect(page.locator('.player-dock-tray[data-mode="queue"]')).toBeVisible();
  await expect(page.locator('.screen-search-v2')).toHaveCount(0);
});

test('dock long station and track text stay readable without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await playHomeStation(page, 'Tokyo FM');

  const textStyles = await page.locator('.player-dock-title').evaluate((node) => {
    node.textContent = 'Very long station name aaa aaa aaa aaa aaa aaa aaa aaa aaa';
    const track = document.querySelector('.player-dock-track-button-text');
    if (track) {
      track.textContent = 'Very long track title bbb bbb bbb bbb bbb bbb bbb bbb';
    }
    const stationStyle = window.getComputedStyle(node);
    const trackStyle = track ? window.getComputedStyle(track) : null;
    return {
      stationFontSize: stationStyle.fontSize,
      stationFontWeight: stationStyle.fontWeight,
      stationWhiteSpace: stationStyle.whiteSpace,
      trackFontSize: trackStyle?.fontSize,
      trackFontWeight: trackStyle?.fontWeight,
      trackWhiteSpace: trackStyle?.whiteSpace,
      titleClient: node.clientWidth,
      titleScroll: node.scrollWidth,
      trackClient: track?.clientWidth || 0,
      trackScroll: track?.scrollWidth || 0
    };
  });

  expect(textStyles.stationFontSize).toBe('14px');
  expect(Number(textStyles.stationFontWeight)).toBeGreaterThanOrEqual(700);
  expect(textStyles.stationWhiteSpace).toBe('nowrap');
  expect(textStyles.trackFontSize).toBe('12px');
  expect(Number(textStyles.trackFontWeight)).toBeGreaterThanOrEqual(500);
  expect(textStyles.trackWhiteSpace).toBe('nowrap');
  await expectNoDocumentHorizontalOverflow(page);
});

test('dock volume tap toggles mute and long press opens tray', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await playHomeStation(page, 'Tokyo FM');

  const volumeButton = page.locator('.dock-volume-btn');
  await expect(volumeButton).toBeVisible();
  await expect(page.locator('.player-dock-tray[data-mode="volume"]')).toHaveCount(0);

  await volumeButton.click();
  await expect(volumeButton).toHaveAttribute('data-muted', 'true');
  await expect(page.locator('.player-dock-tray[data-mode="volume"]')).toHaveCount(0);
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const audio = document.querySelector('audio');
        return audio instanceof HTMLAudioElement ? audio.volume : null;
      })
    )
    .toBe(0);

  await volumeButton.click();
  await expect(volumeButton).toHaveAttribute('data-muted', 'false');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const audio = document.querySelector('audio');
        return audio instanceof HTMLAudioElement ? audio.volume : null;
      })
    )
    .toBeGreaterThan(0.5);

  const box = await volumeButton.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(520);
  await page.mouse.up();
  await expect(page.locator('.player-dock-tray[data-mode="volume"]')).toBeVisible();
  const trayMetrics = await page.locator('.player-dock-tray-panel').evaluate((node) => {
    const computed = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      maxHeight: computed.maxHeight,
      overflowY: computed.overflowY,
      overscrollBehavior: computed.overscrollBehavior,
      height: rect.height,
      viewportHeight: window.innerHeight
    };
  });
  expect(trayMetrics.overflowY).toBe('auto');
  expect(trayMetrics.height).toBeLessThanOrEqual(Math.min(trayMetrics.viewportHeight * 0.4, 360) + 1);
});

test('mobile library keeps four non-wrapping tabs and opens collection detail', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page, {
    activeSection: 'library',
    libraryTab: 'collections',
    stationCache: stations,
    collections: [
      {
        id: 'collection-japan',
        name: 'Japan set',
        stationIds: stations.slice(0, 5).map((station) => station.stationuuid)
      }
    ]
  });

  await page.goto('/');
  const tabs = page.locator('.library-tab-chip');
  await expect(tabs).toHaveCount(4);
  await expect(tabs.filter({ hasText: /Tracks|Треки|History|История/ })).toHaveCount(0);
  const tabStrip = await page.locator('.library-tab-strip').evaluate((node) => {
    const computed = window.getComputedStyle(node);
    const tops = Array.from(node.children).map((child) => child.getBoundingClientRect().top);
    return {
      flexWrap: computed.flexWrap,
      overflowX: computed.overflowX,
      rows: new Set(tops.map((top) => Math.round(top))).size
    };
  });
  expect(tabStrip.flexWrap).toBe('nowrap');
  expect(tabStrip.overflowX).toBe('auto');
  expect(tabStrip.rows).toBe(1);
  await expectNoDocumentHorizontalOverflow(page);

  await expect(page.locator('.library-collection-card')).toHaveCount(1);
  await expect(page.locator('.library-collection-card').getByRole('button', { name: /^Убрать$|^Remove$/ })).toHaveCount(0);
  await page.locator('.library-collection-card').getByRole('button', { name: /Открыть|Open/ }).first().click();
  await expect(page.locator('[data-library-collection-detail]')).toBeVisible();
  await expect(page.locator('[data-library-collection-row]')).toHaveCount(5);

  const tokyoRow = page.locator('[data-library-collection-row][data-station-id="uuid-tokyo"]');
  await tokyoRow.getByRole('button', { name: /Tokyo FM/ }).click();
  await expect(tokyoRow).toHaveCount(0);
});

test('mobile library creates collections inline without native prompt', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page, {
    activeSection: 'library',
    libraryTab: 'collections',
    stationCache: stations
  });
  let promptCalled = false;
  page.on('dialog', async (dialog) => {
    promptCalled = true;
    await dialog.dismiss();
  });

  await page.goto('/');
  await page.getByRole('button', { name: /Новая коллекция|New collection/ }).first().click();
  await page.getByLabel(/Название коллекции|Collection name/).fill('Night drives');
  await page.getByRole('button', { name: /Сохранить|Save/ }).click();

  expect(promptCalled).toBe(false);
  await expect(page.locator('.library-collection-card').filter({ hasText: 'Night drives' })).toBeVisible();
});

test('mobile library followed stations can play and unfollow in place', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page, {
    activeSection: 'library',
    libraryTab: 'collections',
    stationCache: stations,
    followedStations: [
      {
        stationId: 'uuid-tokyo',
        stationName: 'Tokyo FM',
        country: 'Japan'
      }
    ]
  });

  await page.goto('/');
  const followRow = page.locator('.library-follow-row').filter({ hasText: 'Tokyo FM' });
  await followRow.getByRole('button', { name: /Слушать|Play/ }).click();
  await expect(page.locator('.player-dock-title')).toHaveText(/Tokyo FM/);

  await followRow.getByRole('button', { name: /Отписаться|Unfollow/ }).click();
  await expect(page.locator('.library-follow-row').filter({ hasText: 'Tokyo FM' })).toHaveCount(0);
});

test('mobile library followed regions route to focused globe area', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page, {
    activeSection: 'library',
    libraryTab: 'collections',
    stationCache: stations,
    followedRegions: [
      {
        id: 'asia-japan',
        label: 'Japan',
        scope: 'country'
      }
    ]
  });

  await page.goto('/');
  const regionRow = page.locator('.library-follow-row').filter({ hasText: 'Japan' });
  await regionRow.getByRole('button', { name: /Открыть глобус|Open in Globe/ }).click();
  await expect(page.locator('.screen-globe-v2')).toBeVisible();
  await expect(page.locator('.globe-focus-card .section-title')).toHaveText(/Japan/);
  await expectNoGlobeHorizontalOverflow(page);
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

test('mobile settings opens skin lab and applies a previewed museum skin', async ({ page }) => {
  await mockSkinMuseumSearch(page);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await expect(page.locator('[data-home-hero]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-skin-source', 'preset');

  await page.locator('.mobile-settings-trigger').click();
  await expect(page.locator('.settings-panel')).toBeVisible();
  await page.getByRole('button', { name: /Открыть Skin Lab|Open Skin Lab/ }).click();

  await expect(page.locator('[data-skin-lab]')).toBeVisible();
  await page.locator('#skin-lab-search').fill('purple');
  const purpleCard = page.locator('.skin-lab-card').filter({ hasText: 'Purple_Dream.wsz' }).first();
  await expect(purpleCard).toBeVisible();

  await purpleCard.locator('.skin-lab-card-main').click();
  await expect(page.locator('.skin-lab-preview-shell')).toHaveAttribute('data-preview-skin-source', 'museum');
  await expect(page.locator('.skin-lab-preview-shell')).toHaveAttribute('data-preview-skin-name', 'Purple_Dream.wsz');
  await expect(page.locator('html')).toHaveAttribute('data-skin-source', 'preset');

  await page.locator('.skin-lab-preview-panel').getByRole('button', { name: /Применить|Apply/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-skin-source', 'museum');
  await expect(page.locator('html')).toHaveAttribute('data-skin-name', 'Purple_Dream.wsz');
});

test('mobile skin lab previews uploaded skins for the current session only', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await expect(page.locator('[data-home-hero]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-skin-source', 'preset');

  await page.locator('.mobile-settings-trigger').click();
  await page.getByRole('button', { name: /Открыть Skin Lab|Open Skin Lab/ }).click();
  await expect(page.locator('[data-skin-lab]')).toBeVisible();

  await page.locator('.skin-lab-upload input').setInputFiles(UPLOAD_SKIN_PATH);
  await expect(page.locator('.skin-lab-preview-shell')).toHaveAttribute('data-preview-skin-source', 'uploaded');
  await expect(page.locator('.skin-lab-preview-shell')).toHaveAttribute('data-preview-skin-name', 'base-2.91.wsz');
  await expect(page.locator('html')).toHaveAttribute('data-skin-source', 'preset');

  await page.locator('.skin-lab-preview-panel').getByRole('button', { name: /Применить|Apply/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-skin-source', 'uploaded');

  const storedSkinSource = await page.evaluate(() => {
    const raw = window.localStorage.getItem('radio:player:v2');
    if (!raw) return null;
    return (JSON.parse(raw) as { skin?: { source?: string } }).skin?.source || null;
  });
  expect(storedSkinSource).toBe('preset');

  await page.reload();
  await expect(page.locator('[data-home-hero]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-skin-source', 'preset');
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
