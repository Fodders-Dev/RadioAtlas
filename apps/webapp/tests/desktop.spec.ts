import { expect, test } from '@playwright/test';
import { installMediaMocks, mockStations, mockStreamAudio, playHomeStation, seedRadioState } from './helpers';

test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page);
});

// The desktop suite uses the Feed hero (always-present top of Home) as the
// "home is hydrated" sentinel.
test('desktop shell keeps navigation, queue, and expanded player flow intact', async ({ page }) => {
  await page.goto('/?api=http://127.0.0.1:4311');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

  await expect(page.locator('.app-navigation-desktop')).toBeVisible();
  await expect(page.locator('.app-topbar-title')).toHaveText('Главная');
  // T2.20 density pass: the search launcher is now a compact form (no section
  // head), the topbar kicker is blanked, and the footer nav-promo card is gone.
  await expect(page.locator('.home-search-launcher.is-compact #home-search-launcher')).toBeVisible();
  await expect(page.locator('.home-explore-card')).toHaveCount(0);
  await expect(page.locator('.home-hero-metrics')).toHaveCount(0);
  expect(((await page.locator('.shell-kicker').first().textContent()) || '').trim()).toBe('');

  await playHomeStation(page, 'Tokyo FM');

  await expect(page.locator('.player-dock-bar')).toBeVisible();
  await expect(page.locator('.player-dock-title')).toContainText('Tokyo FM');

  await page.getByRole('button', { name: 'Плеер' }).click();
  await expect(page.locator('[data-full-player-overlay]')).toBeVisible();
  await expect(page.locator('#webamp')).toHaveCount(0);

  await page.evaluate(() => {
    (document.querySelector('[data-full-player-overlay] button[aria-label="Закрыть"]') as HTMLButtonElement | null)?.click();
  });
  await expect(page.locator('.player-dock-bar')).toBeVisible();

  await page.getByRole('button', { name: 'Медиатека' }).first().click();
  await expect(page.locator('.app-topbar-title')).toHaveText('Медиатека');
  await page.locator('.library-tab-chip').filter({ hasText: 'Очередь' }).first().click();
  await expect(page.locator('.playlist-row.active')).toContainText('Tokyo FM');
});

test('desktop home rails expose mouse controls and wheel scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto('/');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

  const firstRail = page.locator('[data-home-rail]').first();
  const railScroll = firstRail.locator('.home-horizontal-scroll');
  await expect(firstRail.locator('.home-rail-scroll-controls')).toBeVisible();

  const canScrollRail = await railScroll.evaluate((node) => node.scrollWidth > node.clientWidth);
  expect(canScrollRail).toBe(true);

  const beforeScrollLeft = await railScroll.evaluate((node) => node.scrollLeft);
  const afterWheelScrollLeft = await railScroll.evaluate((node) => {
    node.dispatchEvent(new WheelEvent('wheel', { deltaY: 420, bubbles: true, cancelable: true }));
    return node.scrollLeft;
  });
  expect(afterWheelScrollLeft).toBeGreaterThan(beforeScrollLeft);

  await firstRail.locator('.home-rail-scroll-btn').last().click();
  const afterButtonScrollLeft = await railScroll.evaluate((node) => node.scrollLeft);
  expect(afterButtonScrollLeft).toBeGreaterThanOrEqual(afterWheelScrollLeft);
});

test('search shell exposes filter drawer and station results on desktop', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

  await page.getByRole('button', { name: 'Поиск' }).first().click();
  // v3 hero card replaces the legacy search-command-card.
  await expect(page.locator('.search-hero-card')).toBeVisible();

  // Filter drawer is gated on having a query in the v3 design — type
  // first, then expand. Keeps the idle screen calm.
  await page.locator('#search-hero-input').fill('Berlin');
  await page.getByRole('button', { name: /Показать фильтры/ }).click();
  await expect(page.locator('.search-hero-drawer')).toBeVisible();

  await expect(page.locator('.station-row').filter({ hasText: 'Berlin Pulse' }).first()).toBeVisible({
    timeout: 10000
  });
});

test('metadata state recovers from unavailable to live track without losing playback UI', async ({ page }) => {
  const tokyoStation = {
    stationuuid: 'uuid-tokyo',
    name: 'Tokyo FM',
    url: 'https://nightride.fm/tokyo.mp3',
    url_resolved: 'https://nightride.fm/tokyo.mp3',
    homepage: 'https://tokyofm.example.com',
    favicon: '',
    tags: 'jpop,night',
    country: 'Japan',
    countrycode: 'JP',
    state: 'Tokyo',
    language: 'Japanese',
    codec: 'MP3',
    bitrate: 128,
    geo_lat: 35.6895,
    geo_long: 139.6917
  };
  const stationBody = JSON.stringify([tokyoStation]);
  await page.addInitScript(() => {
    const sources: Array<{
      onmessage: ((event: MessageEvent<string>) => void) | null;
    }> = [];
    // @ts-expect-error test shim
    window.__RA_TEST_EVENT_SOURCES__ = sources;
    class MockEventSource {
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_url: string) {
        sources.push(this);
      }
      close() {}
      addEventListener() {}
      removeEventListener() {}
    }
    // @ts-expect-error test shim
    window.EventSource = MockEventSource;
  });
  await page.route('**/catalog/summary**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        generatedAt: Date.UTC(2026, 3, 20, 9, 0, 0),
        counts: {
          stations: 1,
          countries: 1,
          languages: 1,
          genres: 2
        },
        catalogPool: [tokyoStation],
        freshSignals: [tokyoStation],
        searchLaunch: [tokyoStation],
        sponsored: [],
        countrySpotlight: {
          label: 'Japan',
          stations: [tokyoStation]
        },
        genreSpotlight: {
          label: 'jpop',
          stations: [tokyoStation]
        }
      })
    })
  );
  await page.route('**/catalog/search**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [tokyoStation],
        total: 1,
        nextCursor: null,
        facets: {
          countries: ['Japan'],
          tags: ['jpop'],
          languages: ['Japanese'],
          continentCounts: [{ id: 'Asia', count: 1 }],
          featuredCountries: [{ key: 'jp', country: 'Japan', continent: 'Asia', count: 1 }]
        }
      })
    })
  );
  await page.route('**/catalog/stations/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ item: tokyoStation })
    })
  );
  await page.route('https://nightride.fm/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'audio/wav',
      body: mockStreamAudio
    })
  );

  await page.goto('/');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();
  await playHomeStation(page, 'Tokyo FM');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const sources = (
          window as typeof window & {
            __RA_TEST_EVENT_SOURCES__?: Array<unknown>;
          }
        ).__RA_TEST_EVENT_SOURCES__;
        return sources?.length || 0;
      })
    )
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    const sources = (
      window as typeof window & {
        __RA_TEST_EVENT_SOURCES__?: Array<{
          onmessage: ((event: MessageEvent<string>) => void) | null;
        }>;
      }
    ).__RA_TEST_EVENT_SOURCES__;
    sources?.[0]?.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify([
          {
            station: 'tokyo',
            artist: 'Recovered',
            title: 'Song'
          }
        ])
      })
    );
  });

  await expect(page.locator('.player-dock-title')).toContainText('Tokyo FM');
  await expect(page.locator('.player-dock-track-button-text')).toContainText('Recovered - Song', {
    timeout: 5000
  });
  // Declutter #146 removed auto-track-history logging — «Треки» is now a curated,
  // copy-only list — so a recovered track is no longer auto-added to trackHistory.
  // (The metadata-recovery UI asserted above is what this test guards.)
});

test('home discovery modules stay non-duplicative across main station shelves', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();
  await expect(page.locator('[data-home-genres]')).toBeVisible();

  const modules = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-home-rail]')).map((module) =>
      Array.from(module.querySelectorAll('.home-station-title'))
        .map((node) => node.textContent?.trim() || '')
        .filter(Boolean)
    );
  });

  // The test summary intentionally has no server-signal rails. Desktop must
  // still add a useful fresh fallback shelf instead of stopping after one row.
  expect(modules.length).toBeGreaterThanOrEqual(2);

  const seen = new Set<string>();
  for (const list of modules) {
    for (const name of list) {
      expect(seen.has(name)).toBeFalsy();
      seen.add(name);
    }
  }
});
