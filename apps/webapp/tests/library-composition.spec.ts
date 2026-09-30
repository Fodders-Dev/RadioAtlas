import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

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

test.describe('query-gated Library compositions', () => {
  test('A/B switch, collection detail back, persistent search focus and viewport widths', async ({ page }) => {
    await seed(page);
    await page.goto('/?calm=1&libraryDesign=a');
    const preview = page.locator('.library-preview');
    await expect(preview).toHaveAttribute('data-library-design', 'a');
    const beforeBrowse = await readPlayerQueue(page);
    const audioBeforeBrowse = await page.locator('audio').first().getAttribute('src');

    await page.getByRole('button', { name: 'Открыть: Night set' }).click();
    const detail = page.locator('.library-collection-detail');
    await expect(detail).toBeVisible();
    await expect(detail.locator('.library-detail-sleeve')).toContainText('Night set');
    expect(await readPlayerQueue(page)).toEqual(beforeBrowse);
    await page.locator('.library-preview-modebar').getByRole('button', { name: 'Назад' }).click();
    await expect(page.locator('.library-preview')).toHaveAttribute('data-library-design', 'a');

    for (const design of ['a', 'b'] as const) {
      if (await page.locator('.library-preview').getAttribute('data-library-design') !== design) {
        await page.locator('.library-preview-switch').getByRole('button', { name: design.toUpperCase() }).click();
      }
      for (const width of [390, 834, 1440]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : width === 834 ? 1112 : 900 });
        await expect(page.locator('.library-preview')).toBeVisible();
        const geometry = await page.evaluate(() => ({
          viewport: document.documentElement.clientWidth,
          document: document.documentElement.scrollWidth,
          preview: document.querySelector('.library-preview')!.getBoundingClientRect().right,
          controls: Array.from(document.querySelectorAll('.library-preview-switch button, .library-preview-section-head button')).map((button) => {
            const rect = button.getBoundingClientRect();
            return { width: rect.width, height: rect.height };
          })
        }));
        expect(geometry.document, `${design.toUpperCase()} document overflow at ${width}`).toBeLessThanOrEqual(geometry.viewport);
        expect(geometry.preview, `${design.toUpperCase()} preview overflow at ${width}`).toBeLessThanOrEqual(geometry.viewport + 1);
        expect(geometry.controls.every(({ width: controlWidth, height }) => controlWidth >= 44 && height >= 44), `${design.toUpperCase()} control target below 44px at ${width}`).toBe(true);
      }
    }

    await page.locator('.library-preview-search input').fill('Tokyo');
    await expect(page.locator('.library-preview-search input')).toBeFocused();
    await expect(page.locator('.library-preview-search-results')).toContainText('Tokyo FM');
    expect(await readPlayerQueue(page)).toEqual(beforeBrowse);
    expect(await page.locator('audio').first().getAttribute('src')).toBe(audioBeforeBrowse);
  });

  test('create stays in the preview, cancel is inert, save opens the new collection', async ({ page }) => {
    await seed(page);
    await page.goto('/?calm=1&libraryDesign=b');
    const initialCount = await page.evaluate(() => JSON.parse(localStorage.getItem('radio:library:v2') || '{}').collections.length);
    await page.locator('.library-preview-b-list').getByRole('button', { name: 'Новый плейлист' }).click();
    const nameField = page.getByRole('textbox', { name: 'Название плейлиста' });
    await expect(nameField).toBeVisible();
    await nameField.fill('A quiet route');
    await page.getByRole('button', { name: 'Отмена' }).click();
    await expect(page.locator('.library-preview')).toHaveAttribute('data-library-design', 'b');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('radio:library:v2') || '{}').collections.length)).toBe(initialCount);

    await page.locator('.library-preview-b-list').getByRole('button', { name: 'Новый плейлист' }).click();
    await page.getByRole('textbox', { name: 'Название плейлиста' }).fill('A quiet route');
    await page.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByRole('region', { name: 'A quiet route' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('radio:library:v2') || '{}').collections.map((item: { name: string }) => item.name))).toContain('A quiet route');
  });

  test('empty collections stay honest and creation can be canceled in either composition', async ({ page }) => {
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

    for (const design of ['a', 'b'] as const) {
      await page.goto(`/?calm=1&libraryDesign=${design}`);
      await expect(page.locator('.library-preview')).toHaveAttribute('data-library-design', design);
      if (design === 'a') {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: 'output/library-empty-phone.png', fullPage: true });
      }
      await expect(page.locator('.library-preview')).toContainText('Здесь пока пусто');
      await expect(page.locator('.library-preview')).not.toContainText('Night set');
      await page.getByRole('button', { name: 'Новый плейлист' }).first().click();
      await expect(page.getByRole('textbox', { name: 'Название плейлиста' })).toBeVisible();
      await page.getByRole('button', { name: 'Отмена' }).click();
      await expect(page.locator('.library-preview')).toHaveAttribute('data-library-design', design);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('radio:library:v2') || '{}').collections)).toEqual([]);
    }
  });

  test('collection Play preserves order and Shuffle queues the same saved stations', async ({ page }) => {
    await seed(page);
    await page.addInitScript(() => { Date.now = () => 1780000000000; });
    await page.goto('/?calm=1&libraryDesign=a');
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
