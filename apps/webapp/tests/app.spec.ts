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
  });

  await mockStations(page);
});

test('explore loads globe and stations', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-title')).toHaveText('RadioAtlas');
  await expect(page.getByRole('heading', { name: 'Explore the airwaves' })).toBeVisible();
  await expect(page.getByText('Tokyo FM')).toBeVisible();
  await expect(page.locator('.globe-count')).toContainText('Showing');
});

test('playback opens details panel', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Tokyo FM')).toBeVisible();

  await page.getByRole('button', { name: 'Play' }).first().click();
  await expect(page.locator('.player-title')).toHaveText('Tokyo FM');

  await page.getByRole('button', { name: 'Info', exact: true }).click();
  await expect(page.locator('.details-card')).toBeVisible();
  await expect(page.locator('.details-title')).toHaveText('Tokyo FM');
  await expect(page.locator('.details-link').first()).toContainText(
    'https://stream.example.com/tokyo'
  );
});

test('favorites and search behave correctly', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Tokyo FM')).toBeVisible();

  await page.getByRole('button', { name: 'Play' }).first().click();
  await page.getByRole('button', { name: 'Favorite' }).first().click();

  await page.getByRole('button', { name: 'Favorites' }).click();
  await expect(page.getByText('My Stations')).toBeVisible();
  const favoritesSection = page.locator('.section', { hasText: 'My Stations' });
  await expect(favoritesSection.getByText('Tokyo FM')).toBeVisible();
  await expect(page.getByText('Recently played')).toBeVisible();

  await page.getByRole('button', { name: 'Search' }).click();
  const input = page.getByPlaceholder(
    'Search by name, tag, country, language'
  );
  await input.fill('berlin');
  await expect(page.getByText('Berlin Pulse')).toBeVisible();
});
