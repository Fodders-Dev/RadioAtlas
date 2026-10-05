import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, openLibraryCategory, seedRadioState, stations } from './helpers';

const favorites = stations.slice(0, 4);
const playerState = (page: Page) => page.evaluate(() => ({
  queue: JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue,
  src: document.querySelector('audio')?.getAttribute('src') ?? null,
  state: document.querySelector('audio')?.getAttribute('data-ra-state') ?? null
}));
const seed = async (page: Page, empty = false) => {
  await mockStations(page);
  await installMediaMocks(page);
  await seedRadioState(page, {
    activeSection: 'library', libraryTab: 'collections',
    favorites: empty ? [] : favorites,
    recent: empty ? [] : stations.slice(4, 7),
    queue: empty ? [] : stations.slice(3, 8), queueCurrentIndex: empty ? -1 : 2,
    stationCache: stations,
    trackHistory: empty ? [] : [{ id: 'find', stationId: stations[0].stationuuid, stationName: stations[0].name, track: 'Massive Attack — Teardrop', timestamp: 1780000000000 }],
    collections: empty ? [] : Array.from({ length: 12 }, (_, index) => ({ id: `set-${index}`, name: `Saved set ${index}`, stationIds: favorites.map(station => station.stationuuid) }))
  });
};

for (const width of [320, 390, 834, 1440]) {
  test(`daily destinations remain above playlists and reachable without scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 740 : width === 834 ? 1112 : width === 1440 ? 900 : 844 });
    await seed(page);
    await page.goto('/?calm=1');
    const home = page.locator('[data-library-home]');
    await expect(home).toBeVisible();
    const before = await playerState(page);
    const geometry = await home.evaluate(element => {
      const destinations = Array.from(element.querySelectorAll('[data-library-destination]')).map(node => {
        const bounds = node.getBoundingClientRect();
        return { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right };
      });
      const dock = document.querySelector('[data-calm-player]')?.getBoundingClientRect();
      const nav = document.querySelector('.app-navigation-mobile')?.getBoundingClientRect();
      const bottoms = [dock?.top, nav?.height ? nav.top : undefined, window.innerHeight].filter((value): value is number => value !== undefined && value > 0);
      return { destinations, safeBottom: Math.min(...bottoms), playlistsTop: element.querySelector('.library-preview-a-layout')!.getBoundingClientRect().top, overflow: document.documentElement.scrollWidth > window.innerWidth };
    });
    expect(geometry.destinations).toHaveLength(4);
    expect(geometry.overflow).toBe(false);
    for (const bounds of geometry.destinations) {
      expect(bounds.top).toBeGreaterThanOrEqual(0);
      expect(bounds.bottom).toBeLessThan(geometry.safeBottom);
      expect(bounds.bottom).toBeLessThan(geometry.playlistsTop);
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(width);
    }
    await expect(home.locator('.library-preview-find')).toContainText('Massive Attack — Teardrop');
    await expect(home.locator('.library-preview-queue')).toContainText(stations[5].name);
    await expect(home.locator('.library-preview-recent')).toContainText(stations[4].name);
    for (const category of ['favorites', 'tracks', 'queue', 'recent'] as const) {
      await openLibraryCategory(page, category);
      await expect(home).toHaveCount(0);
      await expect(page.locator('.calm-library-category-head h1')).toBeVisible();
      expect(await playerState(page)).toEqual(before);
      await page.locator('.calm-library-category-head').getByRole('button', { name: 'Назад', exact: true }).click();
      await expect(home).toBeVisible();
      if (category === 'queue') await expect(home.locator('.library-preview-queue')).toBeFocused();
      expect(await playerState(page)).toEqual(before);
    }
  });
}

test('favorite listening and shuffle hand the saved set to Feed explicitly', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await page.goto('/?calm=1');
  const favoriteCard = page.locator('[data-library-destination="favorites"]');
  await favoriteCard.getByRole('button', { name: 'Слушать', exact: true }).click();
  await expect.poll(async () => (await playerState(page)).queue?.items.map((station: { stationuuid: string }) => station.stationuuid)).toEqual(favorites.map(station => station.stationuuid));
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Лента', exact: true }).click();
  await expect(page.locator('.station-feed-card-content[data-focus="true"]')).toContainText(favorites[0].name);
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Моё', exact: true }).click();
  await favoriteCard.getByRole('button', { name: 'Вперемешку', exact: true }).click();
  await expect.poll(async () => (await playerState(page)).queue?.items.map((station: { stationuuid: string }) => station.stationuuid).sort()).toEqual(favorites.map(station => station.stationuuid).sort());
});

test('empty personal sections still have visible entry points and a working creation action', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await seed(page, true);
  await page.goto('/?calm=1');
  await expect(page.locator('[data-library-destination]')).toHaveCount(4);
  await expect(page.locator('[data-library-home]')).not.toContainText('Saved set');
  await page.locator('.library-preview-empty-collections').getByRole('button', { name: /Новый плейлист/ }).click();
  await expect(page.getByRole('textbox', { name: 'Название плейлиста' })).toBeFocused();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.locator('[data-library-home]')).toBeVisible();
  expect((await playerState(page)).queue.items).toEqual([]);
});
