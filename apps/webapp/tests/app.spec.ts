import { fileURLToPath } from 'url';
import { expect, test, type Page } from '@playwright/test';

const stations = [
  {
    stationuuid: 'uuid-tokyo',
    name: 'Tokyo FM',
    url: 'https://stream.example.com/tokyo',
    url_resolved: 'https://stream.example.com/tokyo',
    homepage: 'https://tokyofm.example.com',
    favicon: '',
    tags: 'pop,jpop',
    country: 'Japan',
    countrycode: 'JP',
    state: 'Tokyo',
    language: 'Japanese',
    codec: 'MP3',
    bitrate: 128,
    geo_lat: 35.6895,
    geo_long: 139.6917
  },
  {
    stationuuid: 'uuid-berlin',
    name: 'Berlin Pulse',
    url: 'https://stream.example.com/berlin',
    url_resolved: 'https://stream.example.com/berlin',
    homepage: 'https://berlinpulse.example.com',
    favicon: '',
    tags: 'techno,house',
    country: 'Germany',
    countrycode: 'DE',
    state: 'Berlin',
    language: 'German',
    codec: 'AAC',
    bitrate: 96,
    geo_lat: 52.52,
    geo_long: 13.405
  },
  {
    stationuuid: 'uuid-rio',
    name: 'Rio Beats',
    url: 'https://stream.example.com/rio',
    url_resolved: 'https://stream.example.com/rio',
    homepage: 'https://riobeats.example.com',
    favicon: '',
    tags: 'samba,bossa',
    country: 'Brazil',
    countrycode: 'BR',
    state: 'Rio de Janeiro',
    language: 'Portuguese',
    codec: 'MP3',
    bitrate: 128,
    geo_lat: -22.9068,
    geo_long: -43.1729
  }
];

const mockStations = async (page: Page) => {
  await page.route('**/catalog-fast.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(stations)
    })
  );
  await page.route('**/catalog-full.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(stations)
    })
  );
  await page.route('**/json/stations/search**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(stations)
    })
  );
  await page.route('https://stream.example.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'audio/mpeg',
      body: ''
    })
  );
  await page.route('**/status-json.xsl', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        icestats: {
          source: {
            listenurl: 'https://stream.example.com/tokyo',
            title: 'Mock Song'
          }
        }
      })
    })
  );
  await page.route('**/extract?url=**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'stream',
        title: 'Extracted Demo',
        audioStreams: [
          {
            url: 'https://stream.example.com/extracted',
            bitrate: 128,
            averageBitrate: 128,
            format: 'MP3',
            mimeType: 'audio/mpeg',
            delivery: 'progressive'
          }
        ]
      })
    })
  );
  await page.route('**/metadata?url=**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        nowPlaying: 'Mock Song',
        source: 'test'
      })
    })
  );
  await page.route('**/fetch?url=**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: 'title=Mock Song'
    })
  );
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () {
      this.setAttribute('data-ra-state', 'playing');
      this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      this.setAttribute('data-ra-state', 'paused');
      this.dispatchEvent(new Event('pause'));
    };
    HTMLMediaElement.prototype.load = function () {};
    // @ts-expect-error test polyfill
    window.ResizeObserver =
      window.ResizeObserver ||
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {},
        readText: async () => ''
      }
    });
  });

  await mockStations(page);
});

test('explore loads and compact winamp shell is visible', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-title')).toHaveText('RadioAtlas');
  await expect(page.getByRole('heading', { name: 'Explore the airwaves' })).toBeVisible();
  await expect(page.getByText('Tokyo FM')).toBeVisible();
  await expect(page.locator('.winamp-compact')).toBeVisible();
  await expect(page.locator('.winamp-host.compact')).toBeVisible();
});

test('playback from table updates winamp shell and info panel', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play' }).first().click();
  await expect(page.locator('.audio-hidden')).toHaveCount(1);
  await expect(page.locator('.audio-hidden')).toHaveAttribute('data-ra-state', 'playing');
  await expect
    .poll(async () => {
      return page.evaluate(
        () => (document.querySelector('.audio-hidden') as HTMLAudioElement | null)?.src || ''
      );
    })
    .toContain('tokyo');
  await page.getByRole('button', { name: 'Expand' }).click();

  await expect(page.getByRole('button', { name: 'Info', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Info', exact: true }).click();
  await expect(page.locator('.details-card')).toBeVisible();
  await expect(page.locator('.details-title')).toHaveText('Tokyo FM');
});

test('clicking the active station pauses the real audio engine', async ({ page }) => {
  await page.goto('/');
  const row = page.locator('.station-row').filter({ hasText: 'Tokyo FM' }).first();
  await row.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('.audio-hidden')).toHaveAttribute('data-ra-state', 'playing');

  await row.getByRole('button', { name: 'Pause' }).click();
  await expect(row.getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(page.locator('.audio-hidden')).toHaveAttribute('data-ra-state', 'paused');
});

test('switching between stations keeps selected station as current', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play' }).first().click();
  const berlinRow = page.locator('.station-row').filter({ hasText: 'Berlin Pulse' }).first();
  await berlinRow.getByRole('button', { name: 'Play' }).click();
  await page.getByRole('button', { name: 'Expand' }).click();
  await page.getByRole('button', { name: 'Info', exact: true }).click();
  await expect(page.locator('.details-title')).toHaveText('Berlin Pulse');
});

test('station starts even when it was not in the saved winamp playlist', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'radio:winamp-playlist',
      JSON.stringify([
        {
          stationuuid: 'uuid-berlin',
          name: 'Berlin Pulse',
          url_resolved: 'https://stream.example.com/berlin',
          favicon: '',
          country: 'Germany',
          state: 'Berlin',
          tags: 'techno,house',
          geo_lat: 52.52,
          geo_long: 13.405
        }
      ])
    );
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByPlaceholder('Search by name, tag, country, language').fill('Tokyo');
  await page.getByRole('button', { name: 'Play' }).first().click();

  await expect(page.getByRole('button', { name: 'Expand' })).toBeVisible();
  await page.getByRole('button', { name: 'Expand' }).click();
  await expect(page.locator('#webamp')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Info', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Info', exact: true }).click();
  await expect(page.locator('.details-title')).toHaveText('Tokyo FM');
});

test('favorite station can start even when saved winamp playlist is stale', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'radio:favorites',
      JSON.stringify([
        {
          stationuuid: 'uuid-tokyo',
          name: 'Tokyo FM',
          url_resolved: 'https://stream.example.com/tokyo',
          favicon: '',
          country: 'Japan',
          state: 'Tokyo',
          tags: 'pop,jpop',
          geo_lat: 35.6895,
          geo_long: 139.6917
        }
      ])
    );
    localStorage.setItem(
      'radio:winamp-playlist',
      JSON.stringify([
        {
          stationuuid: 'uuid-berlin',
          name: 'Berlin Pulse',
          url_resolved: 'https://stream.example.com/berlin',
          favicon: '',
          country: 'Germany',
          state: 'Berlin',
          tags: 'techno,house',
          geo_lat: 52.52,
          geo_long: 13.405
        }
      ])
    );
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Favorites' }).click();
  await expect(page.getByText('My Stations')).toBeVisible();
  await page.getByRole('button', { name: 'Play' }).first().click();
  await page.getByRole('button', { name: 'Expand' }).click();
  await expect(page.locator('#webamp')).toHaveCount(1);
  await page.getByRole('button', { name: 'Info', exact: true }).click();
  await expect(page.locator('.details-title')).toHaveText('Tokyo FM');
});

test('browse flow and full navigation still work', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Browse' }).click();
  await expect(page.getByText('Choose a continent to explore local stations.')).toBeVisible();

  await page.getByRole('button', { name: /Asia/ }).click();
  await expect(page.getByPlaceholder('Search country')).toBeVisible();

  await page.getByPlaceholder('Search country').fill('jap');
  await page.getByRole('button', { name: /Japan/ }).click();

  await expect(page.getByText('Tokyo FM')).toBeVisible();
  await page.getByRole('button', { name: 'Play' }).first().click();
  await expect(page.getByRole('button', { name: 'Info', exact: true })).toBeEnabled();

  await page.getByRole('button', { name: 'Favorites' }).click();
  await expect(page.getByText('My Stations')).toBeVisible();

  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByPlaceholder('Search by name, tag, country, language')).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('Player Skin')).toBeVisible();
});

test('expand and collapse winamp overlay', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Expand' }).click();
  await expect(page.locator('.winamp-compact.expanded-host')).toBeVisible();
  await expect(page.locator('#webamp')).toHaveCount(1);
  await expect(page.locator('#webamp .window').first()).toBeVisible();

  await page.getByRole('button', { name: 'Collapse', exact: true }).click();
  await expect(page.locator('.winamp-compact.expanded-host')).toHaveCount(0);
  await expect(page.locator('.winamp-compact')).toBeVisible();
});

test('windowshade toggle expands compact strip to main window without full overlay', async ({ page }) => {
  await page.goto('/');
  const shadeToggle = page.locator('[title="Toggle Windowshade Mode"]').first();
  await expect(shadeToggle).toBeVisible();
  await shadeToggle.click();

  await expect(page.locator('.winamp-compact.expanded-host')).toHaveCount(0);
  await expect
    .poll(async () => {
      return page.evaluate(
        () =>
          document.querySelector('#main-window')?.closest('.window')?.getBoundingClientRect().height ?? 0
      );
    })
    .toBeGreaterThan(80);

  await shadeToggle.click();
  await expect
    .poll(async () => {
      return page.evaluate(
        () =>
          document.querySelector('#main-window')?.closest('.window')?.getBoundingClientRect().height ?? 0
      );
    })
    .toBeLessThan(70);
});

test('expanded mode keeps station list clickable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Expand' }).click();

  const targetRow = page.locator('.station-row').filter({ hasText: 'Berlin Pulse' }).first();
  await targetRow.getByRole('button', { name: 'Play' }).click();
  await expect(targetRow.getByRole('button', { name: 'Pause' })).toBeVisible();
});

test('mobile compact player stays usable above bottom nav', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'maxTouchPoints', {
      configurable: true,
      get: () => 5
    });
  });
  await page.goto('/');

  const compactMain = page.locator('.winamp-compact-main');
  const nav = page.locator('.bottom-nav');

  await expect(compactMain).toBeVisible();
  await expect(nav).toBeVisible();

  const compactBox = await compactMain.boundingBox();
  const navBox = await nav.boundingBox();

  expect(compactBox).not.toBeNull();
  expect(navBox).not.toBeNull();
  expect(compactBox!.height).toBeGreaterThanOrEqual(40);
  expect(compactBox!.height).toBeLessThanOrEqual(70);
  expect(compactBox!.y + compactBox!.height).toBeLessThanOrEqual(navBox!.y - 4);
});

test('skin preset change persists in localStorage', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();

  await page.locator('#skin-select').selectOption('eric-potter');

  const stored = await page.evaluate(() => localStorage.getItem('radio:winamp-skin'));
  expect(stored).toContain('eric-potter');
});

test('skin upload applies uploaded mode', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();

  const skinFile = fileURLToPath(
    new URL('../public/winamp-skins/base-2.91.wsz', import.meta.url)
  );
  await page.locator('input[type="file"]').first().setInputFiles(skinFile);
  await page.waitForFunction(() =>
    (localStorage.getItem('radio:winamp-skin') || '').includes('uploaded')
  );

  const stored = await page.evaluate(() => localStorage.getItem('radio:winamp-skin'));
  expect(stored).toContain('uploaded');
});

test('share action always displays toast', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play' }).first().click();
  await page.getByRole('button', { name: 'Expand' }).click();
  await page.getByRole('button', { name: 'Share' }).click();
  await expect(page.locator('.toast')).toBeVisible();
  await expect(page.locator('.toast')).toContainText(/Share|Link/);
});

test('track line shows track title only and supports copy click', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play' }).first().click();

  const trackLine = page.locator('.winamp-trackline.compact');
  await expect(trackLine).toBeVisible();
  await expect(trackLine).toContainText('Mock Song');
  await expect(trackLine).not.toContainText('Tokyo FM');

  await trackLine.click();
  await expect(page.locator('.toast')).toContainText('Track copied');
});
