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
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () {
      this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
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
  await page.getByRole('button', { name: 'Expand' }).click();

  await expect(page.getByRole('button', { name: 'Info', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Info', exact: true }).click();
  await expect(page.locator('.details-card')).toBeVisible();
  await expect(page.locator('.details-title')).toHaveText('Tokyo FM');
});

test('browse flow and full navigation still work', async ({ page }) => {
  await page.goto('/');

  await page.evaluate(() => {
    const navItems = Array.from(document.querySelectorAll<HTMLButtonElement>('.nav-item'));
    const browse = navItems.find((item) => item.textContent?.includes('Browse'));
    browse?.click();
  });
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
  await expect(page.locator('.winamp-overlay')).toBeVisible();
  await expect(page.locator('.winamp-host.overlay')).toBeVisible();

  await page.getByRole('button', { name: 'Collapse', exact: true }).click();
  await expect(page.locator('.winamp-overlay')).toHaveCount(0);
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
    new URL('../../../winamp skins/base-2.91.wsz', import.meta.url)
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
