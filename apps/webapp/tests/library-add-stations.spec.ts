import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, openLibraryCategory, seedRadioState, stations } from './helpers';

const name = 'Evening shelf';
const readIds = (page: Page) => page.evaluate(() =>
  JSON.parse(localStorage.getItem('radio:library:v2') || '{}').collections[0].stationIds as string[]
);
const readTransport = (page: Page) => page.evaluate(() => ({
  queue: JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue,
  sources: Array.from(document.querySelectorAll('audio')).map((audio) => audio.getAttribute('src')),
  calls: (window as unknown as { __pickerPlayCalls: number }).__pickerPlayCalls
}));
const seed = async (page: Page, ids: string[] = [], favorites = stations.slice(0, 2)) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMediaMocks(page);
  await mockStations(page);
  await page.addInitScript(() => {
    (window as unknown as { __pickerPlayCalls: number }).__pickerPlayCalls = 0;
    HTMLMediaElement.prototype.play = function () {
      (window as unknown as { __pickerPlayCalls: number }).__pickerPlayCalls += 1;
      this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    };
  });
  await seedRadioState(page, {
    activeSection: 'library', favorites, queue: stations.slice(5, 8), queueCurrentIndex: 0,
    collections: [{ id: 'picker-set', name, stationIds: ids }], stationCache: stations
  });
  await page.goto('/?calm=1');
  await page.locator('audio').first().waitFor({ state: 'attached' });
};
const open = async (page: Page) => {
  await page.getByRole('button', { name: `Открыть: ${name}` }).click();
  await page.locator('.library-detail-add-stations').click();
  return page.getByRole('dialog', { name });
};
const reply = (items: typeof stations, nextCursor: string | null = null) => ({
  items, nextCursor, total: items.length, facets: { countries: [], tags: [], languages: [] }
});

test('several additions stay in the playlist, preserve live playback, and return focus after its first station', async ({ page }) => {
  await seed(page);
  await openLibraryCategory(page, 'queue');
  await page.locator('.calm-queue-play-icon').first().click();
  await expect.poll(async () => (await readTransport(page)).calls).toBeGreaterThan(0);
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Моё', exact: true }).click();
  const before = await readTransport(page);
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Добавить «Tokyo FM» в плейлист' }).click();
  const alreadyAdded = dialog.getByRole('button', { name: '«Tokyo FM» уже в плейлисте' });
  await expect(alreadyAdded).toHaveAttribute('aria-disabled', 'true');
  // ARIA keeps this row in the keyboard cycle. Force only the deliberate
  // negative click to check that its handler also rejects a duplicate.
  await alreadyAdded.click({ force: true });
  await dialog.getByRole('button', { name: 'Добавить «Osaka Nights» в плейлист' }).click();
  await expect.poll(() => readIds(page)).toEqual([stations[1].stationuuid, stations[0].stationuuid]);
  await dialog.getByRole('button', { name: 'Каталог', exact: true }).click();
  await dialog.getByRole('button', { name: 'Добавить «Kyoto Groove» в плейлист' }).click();
  await expect(dialog).toBeVisible();
  await expect.poll(() => readIds(page)).toEqual(stations.slice(0, 3).map((station) => station.stationuuid).reverse());
  expect(await readTransport(page)).toEqual(before);
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(page.locator('.library-detail-add-stations')).toBeFocused();
  await expect(page.locator('.library-detail-station-list')).toContainText('Kyoto Groove');
  await page.locator('.library-detail-add-stations').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.library-detail-add-stations')).toBeFocused();
});

test('catalog query races, pagination retry and session seed do not lose stations', async ({ page }) => {
  await seed(page, [], []);
  let releaseOld: (() => void) | undefined;
  let oldRequested = false;
  let failMore = true;
  const seeds: string[] = [];
  await page.route('**/catalog/search**', async (route) => {
    const url = new URL(route.request().url());
    seeds.push(url.searchParams.get('seed') || '');
    if (url.searchParams.get('q') === 'old') {
      oldRequested = true;
      await new Promise<void>((resolve) => { releaseOld = resolve; });
      await route.fulfill({ json: reply([stations[0]]) });
      return;
    }
    if (url.searchParams.get('cursor') && failMore) {
      failMore = false;
      await route.fulfill({ status: 503, json: { error: 'offline' } });
      return;
    }
    await route.fulfill({ json: url.searchParams.get('cursor') ? reply([stations[4], stations[5]]) : reply([stations[4]], 'page-2') });
  });
  const dialog = await open(page);
  const input = dialog.getByRole('searchbox');
  await expect(dialog).toContainText('Berlin Pulse');
  const settledSearchBox = await input.boundingBox();
  await input.fill('old');
  await expect.poll(() => oldRequested).toBe(true);
  expect((await input.boundingBox())?.y).toBe(settledSearchBox?.y);
  await input.fill('new');
  // Clicking the already selected mode must not strand this request in loading.
  await dialog.getByRole('button', { name: 'Каталог', exact: true }).click();
  await expect(dialog).toContainText('Berlin Pulse');
  expect((await input.boundingBox())?.y).toBe(settledSearchBox?.y);
  releaseOld?.();
  await expect(dialog.getByText('Tokyo FM', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Ещё станции' }).click();
  await expect(dialog).toContainText('Не удалось загрузить станции');
  await expect(dialog).toContainText('Berlin Pulse');
  await dialog.getByRole('button', { name: 'Повторить' }).click();
  await expect(dialog).toContainText('Hamburg Transit');
  await expect(dialog.locator('li')).toHaveCount(2);
  expect(seeds.length).toBeGreaterThanOrEqual(5);
  expect(seeds[0]).not.toBe('');
  expect(new Set(seeds).size).toBe(1);
});

test('the 128 station limit preserves the last station instead of replacing it', async ({ page }) => {
  const fullIds = Array.from({ length: 128 }, (_, index) => index === 0 ? stations[0].stationuuid : `saved-${index}`);
  await seed(page, fullIds);
  const before = await readTransport(page);
  const dialog = await open(page);
  await expect(dialog).toContainText('128 / 128');
  const add = dialog.getByRole('button', { name: 'Добавить «Osaka Nights» в плейлист' });
  await expect(add).toHaveAttribute('aria-disabled', 'true');
  await add.click({ force: true });
  expect(await readIds(page)).toEqual(fullIds);
  expect(await readTransport(page)).toEqual(before);
});

test('picker targets and dialog bounds fit phone, tablet, desktop and a shortened Telegram viewport', async ({ page }) => {
  await seed(page);
  const dialog = await open(page);
  for (const width of [320, 390, 834, 1440]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    const layout = await dialog.evaluate((root) => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      card: root.querySelector('.collection-station-picker-card')!.getBoundingClientRect().toJSON(),
      targets: Array.from(root.querySelectorAll('button:not([data-dialog-backdrop])')).map((button) => button.getBoundingClientRect().toJSON())
    }));
    expect(layout.overflow).toBeLessThanOrEqual(0);
    expect(layout.card.x).toBeGreaterThanOrEqual(0);
    expect(layout.card.right).toBeLessThanOrEqual(width);
    expect(layout.targets.every(({ width: w, height }) => w >= 44 && height >= 44)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  // Exercise the real SDK event bridge rather than directly forcing CSS vars.
  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Object.defineProperty(viewport, 'height', { configurable: true, value: 440 });
    viewport.dispatchEvent(new Event('resize'));
  });
  await expect.poll(() => dialog.getByRole('button', { name: 'Готово' }).evaluate((button) => button.getBoundingClientRect().bottom)).toBeLessThanOrEqual(440);
  await expect(dialog.getByRole('searchbox')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
});
