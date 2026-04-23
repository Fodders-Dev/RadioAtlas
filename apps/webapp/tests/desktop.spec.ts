import { expect, test } from '@playwright/test';
import { installMediaMocks, mockStations, mockStreamAudio, playHomeStation, seedRadioState } from './helpers';

test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page);
});

test('desktop shell keeps navigation, queue, and expanded winamp flow intact', async ({ page }) => {
  await page.goto('/?api=http://127.0.0.1:4311');
  await expect(page.locator('[data-home-hero]')).toBeVisible();

  await expect(page.locator('.app-navigation-desktop')).toBeVisible();
  await expect(page.locator('.app-topbar-title')).toHaveText('Главная');
  await expect(page.locator('.home-search-launcher .home-section-title')).toHaveText('Найти станцию');
  await expect(page.locator('.home-explore-card .home-section-title')).toHaveText('Что открыть дальше');

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
  await page.locator('.library-tab-chip').filter({ hasText: 'Очередь' }).first().click();
  await expect(page.locator('.playlist-row.active')).toContainText('Tokyo FM');
});

test('search shell exposes filter drawer and station results on desktop', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-home-hero]')).toBeVisible();

  await page.getByRole('button', { name: 'Поиск' }).first().click();
  await expect(page.locator('.search-command-card')).toBeVisible();

  await page.getByRole('button', { name: 'Показать фильтры' }).click();
  await expect(page.locator('.search-filters-drawer')).toBeVisible();

  await page.locator('.search-bar input').first().fill('Berlin');
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
  await expect(page.locator('[data-home-hero]')).toBeVisible();
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
});

test('home discovery modules stay non-duplicative across main station shelves', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-home-hero]')).toBeVisible();

  const modules = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-home-rail]')).map((module) =>
      Array.from(module.querySelectorAll('.home-station-title'))
        .map((node) => node.textContent?.trim() || '')
        .filter(Boolean)
    );
  });

  const seen = new Set<string>();
  for (const list of modules) {
    for (const name of list) {
      expect(seen.has(name)).toBeFalsy();
      seen.add(name);
    }
  }
});
