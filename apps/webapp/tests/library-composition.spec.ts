import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, openLibraryCategory, seedRadioState, stations } from './helpers';

const savedStations = stations.slice(0, 5);
const initialQueue = stations.slice(5, 7);
const collection = {
  id: 'library-composition-set',
  name: 'Night set',
  stationIds: savedStations.map((station) => station.stationuuid)
};

const readPlayerQueue = (page: Page) => page.evaluate(() => {
  const player = JSON.parse(localStorage.getItem('radio:player:v2') || '{}');
  return {
    ids: player.queue?.items?.map((station: { stationuuid: string }) => station.stationuuid) ?? [],
    sourceId: player.queue?.sourceId ?? null
  };
});

const seed = async (page: Page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockStations(page);
  await installMediaMocks(page);
  await seedRadioState(page, {
    activeSection: 'library',
    libraryTab: 'collections',
    favorites: savedStations.slice(0, 2),
    queue: initialQueue,
    queueCurrentIndex: 0,
    queueSourceId: 'saved-queue',
    queueSourceLabel: 'Saved queue',
    stationCache: [...savedStations, ...initialQueue],
    collections: [collection],
    trackHistory: [{ id: 'find-1', stationId: stations[2].stationuuid, stationName: stations[2].name, track: 'Found at night', timestamp: 1780000000000 }]
  });
};

test.describe('personal Library home', () => {
  test('categories return to the home; ordinary navigation clears a detail or creation draft', async ({ page }) => {
    await seed(page);
    await page.goto('/?calm=1');
    const home = page.locator('[data-library-home]');
    await expect(home).toBeVisible();
    const before = await readPlayerQueue(page);
    for (const tab of ['favorites', 'tracks', 'queue', 'recent', 'collections'] as const) {
      await openLibraryCategory(page, tab);
      await expect(home).toHaveCount(0);
      await expect(page.locator('.library-tab-chip.active')).toHaveAttribute('aria-controls', new RegExp(`panel-${tab}$`));
      await page.locator('.calm-library-category-head').getByRole('button', { name: 'Назад' }).click();
      await expect(home).toBeVisible();
    }
    await page.getByRole('button', { name: 'Открыть: Night set' }).click();
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Моё', exact: true }).click();
    await expect(home).toBeVisible();
    await page.getByRole('button', { name: 'Новый плейлист' }).click();
    await page.getByRole('textbox', { name: 'Название плейлиста' }).fill('Unsaved draft');
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Моё', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Название плейлиста' })).toHaveCount(0);
    expect(await readPlayerQueue(page)).toEqual(before);
  });

  test('Feed entries open queue and finds directly, including a repeated queue entry', async ({ page }) => {
    await seed(page);
    await page.goto('/?calm=1');
    const nav = page.getByRole('navigation', { name: 'Primary navigation' });
    for (const tab of ['queue', 'tracks', 'queue'] as const) {
      await nav.getByRole('button', { name: 'Лента', exact: true }).click();
      const focused = page.locator('.station-feed-card-content[data-focus="true"]');
      await expect(focused).toBeVisible();
      await focused.locator('[data-feed-action="expand"]').click();
      await page.locator('.feed-player-tools').getByRole('button', { name: tab === 'queue' ? /^Очередь/ : /находки/i }).click();
      await expect(page.locator('[data-library-home]')).toHaveCount(0);
      await expect(page.locator('.library-tab-chip.active')).toHaveAttribute('aria-controls', new RegExp(`panel-${tab}$`));
      await nav.getByRole('button', { name: 'Моё', exact: true }).click();
      await expect(page.locator('[data-library-home]')).toBeVisible();
    }
  });

  test('classic retains the saved category without the calm home', async ({ page }) => {
    await seed(page);
    await page.goto('/?calm=0');
    await expect(page.getByRole('tab', { name: 'Плейлисты' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-library-home]')).toHaveCount(0);
  });

  test('default home, collection detail back, persistent search focus and viewport widths', async ({ page }) => {
    await seed(page);
    await page.goto('/?calm=1');
    const preview = page.locator('.library-preview');
    await expect(preview).toBeVisible();
    await expect(page.locator('.library-preview-switch')).toHaveCount(0);
    const beforeBrowse = await readPlayerQueue(page);
    const audioBeforeBrowse = await page.locator('audio').first().getAttribute('src');

    await page.getByRole('button', { name: 'Открыть: Night set' }).click();
    const detail = page.locator('.library-collection-detail');
    await expect(detail).toBeVisible();
    await expect(page.locator('.calm-library-category-head button')).toBeFocused();
    await expect(detail.locator('.library-detail-sleeve')).toContainText('Night set');
    expect(await readPlayerQueue(page)).toEqual(beforeBrowse);
    await page.locator('.calm-library-category-head').getByRole('button', { name: 'Назад' }).click();
    await expect(preview).toBeVisible();

      for (const width of [390, 834, 1440]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : width === 834 ? 1112 : 900 });
        await expect(page.locator('.library-preview')).toBeVisible();
        const geometry = await page.evaluate(() => ({
          viewport: document.documentElement.clientWidth,
          document: document.documentElement.scrollWidth,
          preview: document.querySelector('.library-preview')!.getBoundingClientRect().right,
          controls: Array.from(document.querySelectorAll('.library-preview button')).map((button) => {
            const rect = button.getBoundingClientRect();
            return { width: rect.width, height: rect.height };
          })
        }));
        expect(geometry.document, `document overflow at ${width}`).toBeLessThanOrEqual(geometry.viewport);
        expect(geometry.preview, `home overflow at ${width}`).toBeLessThanOrEqual(geometry.viewport + 1);
        expect(geometry.controls.every(({ width: controlWidth, height }) => controlWidth >= 44 && height >= 44), `control target below 44px at ${width}`).toBe(true);
      }

    await page.locator('.library-preview-search input').fill('Tokyo');
    await expect(page.locator('.library-preview-search input')).toBeFocused();
    await expect(page.locator('.library-preview-search-results')).toContainText('Tokyo FM');
    expect(await readPlayerQueue(page)).toEqual(beforeBrowse);
    expect(await page.locator('audio').first().getAttribute('src')).toBe(audioBeforeBrowse);
  });

  test('create stays in the home, cancel is inert, save opens the new collection', async ({ page }) => {
    await seed(page);
    await page.goto('/?calm=1');
    await expect(page.locator('[data-library-home]')).toBeVisible();
    const initialCount = await page.evaluate(() => JSON.parse(localStorage.getItem('radio:library:v2') || '{}').collections.length);
    await page.getByRole('button', { name: 'Новый плейлист' }).click();
    const nameField = page.getByRole('textbox', { name: 'Название плейлиста' });
    await expect(nameField).toBeVisible();
    await nameField.fill('A quiet route');
    await page.getByRole('button', { name: 'Отмена' }).click();
    await expect(page.locator('[data-library-home]')).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('radio:library:v2') || '{}').collections.length)).toBe(initialCount);

    await page.getByRole('button', { name: 'Новый плейлист' }).click();
    await page.getByRole('textbox', { name: 'Название плейлиста' }).fill('A quiet route');
    await page.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByRole('region', { name: 'A quiet route' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('radio:library:v2') || '{}').collections.map((item: { name: string }) => item.name))).toContain('A quiet route');
  });

  test('empty collections stay honest and creation can be canceled', async ({ page }) => {
    await mockStations(page);
    await installMediaMocks(page);
    await seedRadioState(page, {
      activeSection: 'library',
      libraryTab: 'collections',
      favorites: [],
      queue: [],
      queueCurrentIndex: -1,
      queueSourceId: null,
      queueSourceLabel: null,
      stationCache: [],
      collections: [],
      trackHistory: []
    });

      await page.goto('/?calm=1');
      await expect(page.locator('[data-library-home]')).toBeVisible();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: 'output/library-empty-phone.png', fullPage: true });
      await expect(page.locator('.library-preview')).toContainText('Здесь пока пусто');
      await expect(page.locator('.library-preview')).not.toContainText('Night set');
      await page.getByRole('button', { name: 'Новый плейлист' }).first().click();
      await expect(page.getByRole('textbox', { name: 'Название плейлиста' })).toBeVisible();
      await page.getByRole('button', { name: 'Отмена' }).click();
      await expect(page.locator('[data-library-home]')).toBeVisible();
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('radio:library:v2') || '{}').collections)).toEqual([]);
  });

  test('collection Play preserves order and Shuffle queues the same saved stations', async ({ page }) => {
    await seed(page);
    await page.addInitScript(() => { Date.now = () => 1780000000000; });
    await page.goto('/?calm=1');
    await page.locator('.library-preview-feature-copy').getByRole('button', { name: 'Слушать' }).click();
    await expect.poll(() => readPlayerQueue(page)).toEqual({ ids: collection.stationIds, sourceId: `collection-${collection.id}` });

    await page.locator('.library-preview-feature-copy').getByRole('button', { name: 'Вперемешку' }).click();
    await expect.poll(async () => {
      return (await readPlayerQueue(page)).ids;
    }).not.toEqual(collection.stationIds);
    const shuffled = await readPlayerQueue(page);
    expect(shuffled.sourceId).toBe(`collection-${collection.id}`);
    expect([...shuffled.ids].sort()).toEqual([...collection.stationIds].sort());
    expect(shuffled.ids).not.toEqual(collection.stationIds);
  });
});
