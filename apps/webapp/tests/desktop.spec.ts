import { expect, test } from '@playwright/test';
import { installMediaMocks, mockStations, mockStreamAudio, playHomeStation } from './helpers';

test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
});

test('desktop shell keeps navigation, queue, and expanded winamp flow intact', async ({ page }) => {
  await page.goto('/?api=http://127.0.0.1:4311');

  await expect(page.locator('.app-navigation-desktop')).toBeVisible();
  await expect(page.locator('.app-topbar-title')).toHaveText('Главная');
  await expect(page.locator('.home-search-card .section-title')).toHaveText('Найти станцию');
  await expect(page.locator('.account-card > .library-section-head .section-title')).toHaveText('Аккаунт и синхронизация');

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
  await page.getByRole('button', { name: 'Очередь', exact: true }).click();
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

test('metadata state recovers from unavailable to live track without losing playback UI', async ({ page }) => {
  const stationBody = JSON.stringify([
    {
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
    }
  ]);
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
  await page.route('**/catalog-fast.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: stationBody })
  );
  await page.route('**/catalog-full.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: stationBody })
  );
  await page.route('**/json/stations/search**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: stationBody })
  );
  await page.route('https://nightride.fm/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'audio/wav',
      body: mockStreamAudio
    })
  );

  await page.goto('/');
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

  const modules = await page.evaluate(() => {
    const collect = (key: string) =>
      Array.from(
        document.querySelectorAll(
          `[data-home-module="${key}"] .station-row .station-title .marquee-text`
        )
      )
        .map((node) => node.textContent?.trim() || '')
        .filter(Boolean);

    return {
      fresh: collect('fresh-signals'),
      country: collect('country-spotlight'),
      resume: collect('resume'),
      genre: collect('genre-spotlight')
    };
  });

  const seen = new Set<string>();
  for (const list of [modules.fresh, modules.country, modules.resume, modules.genre]) {
    for (const name of list) {
      expect(seen.has(name)).toBeFalsy();
      seen.add(name);
    }
  }
});
