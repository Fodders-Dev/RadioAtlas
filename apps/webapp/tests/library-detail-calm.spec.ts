import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

const saved = stations.slice(0, 5);
const originalIds = saved.map(station => station.stationuuid);
const collection = { id: 'detail-review', name: 'Ночной город', stationIds: originalIds };
const transport = (page: Page) => page.evaluate(() => ({
  queue: JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue,
  audio: Array.from(document.querySelectorAll('audio')).map(el => ({ src: el.getAttribute('src'), state: el.getAttribute('data-ra-state') }))
}));
const collectionIds = (page: Page) => page.evaluate(() =>
  JSON.parse(localStorage.getItem('radio:library:v2') || '{}').collections.find((item: { id: string }) => item.id === 'detail-review')?.stationIds
);
const prepare = async (page: Page, width = 390, name = collection.name) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : width === 834 ? 1112 : 900 });
  await mockStations(page);
  await installMediaMocks(page);
  await seedRadioState(page, { activeSection: 'library', libraryTab: 'collections',
    collections: [{ ...collection, name }], stationCache: stations,
    queue: stations.slice(5, 7), queueSourceId: 'keep-current', queueSourceLabel: 'Keep current'
  });
  await page.goto('/?calm=1');
  await page.getByRole('region', { name: 'Плеер' }).getByRole('button', { name: 'Слушать', exact: true }).click();
  // The shared media mock reports transport through this attribute; native
  // `paused` stays true because no network audio is decoded in functional CI.
  await expect(page.locator('audio').first()).toHaveAttribute('data-ra-state', 'playing');
  await page.getByRole('button', { name: `Открыть: ${name}`, exact: true }).click();
  await expect(page.locator('[data-library-collection-detail]')).toBeVisible();
};

for (const width of [390, 834, 1440]) {
  test(`playlist actions overlay preserves the list and audio at ${width}px`, async ({ page }) => {
    await prepare(page, width);
    const detail = page.locator('[data-library-collection-detail]');
    const trigger = detail.locator('[data-collection-actions-trigger]');
    const first = detail.locator('.station-row').first();
    const before = await transport(page);
    const beforeY = (await first.boundingBox())!.y;
    await trigger.click();
    const panel = detail.locator('[data-collection-actions]');
    await expect(panel).toBeVisible();
    expect(Math.abs((await first.boundingBox())!.y - beforeY)).toBeLessThan(1);
    const geometry = await panel.evaluate(el => ({
      left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right,
      viewport: document.documentElement.clientWidth,
      targets: Array.from(el.querySelectorAll('button')).map(button => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height }))
    }));
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.targets.every(target => target.width >= 44 && target.height >= 44)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(panel).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await detail.getByRole('heading', { name: collection.name, exact: true }).click();
    await expect(panel).not.toBeVisible();
    await trigger.click();
    await panel.getByRole('button', { name: 'Переименовать', exact: true }).click();
    const rename = detail.getByRole('textbox', { name: 'Новое название' });
    await expect(rename).toBeFocused();
    await rename.fill('Ночной город · новая обложка');
    await detail.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(detail.getByRole('heading', { name: 'Ночной город · новая обложка', exact: true })).toBeVisible();
    expect(await transport(page)).toEqual(before);
    expect(await collectionIds(page)).toEqual(originalIds);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test('arranging the saved playlist leaves live queue intact; Listen and Feed use its new order', async ({ page }) => {
  await prepare(page);
  const detail = page.locator('[data-library-collection-detail]');
  const before = await transport(page);
  await detail.locator('[data-collection-actions-trigger]').click();
  await detail.locator('[data-collection-actions]').getByRole('button', { name: 'Порядок', exact: true }).click();
  const tokyo = detail.locator('[data-library-collection-row][data-station-id="uuid-tokyo"]');
  await expect(tokyo.locator('.station-artwork')).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  const editGeometry = await tokyo.evaluate(row => ({
    copyWidth: row.querySelector('.playlist-body')!.getBoundingClientRect().width,
    controls: Array.from(row.querySelectorAll('.playlist-actions button')).map(button => button.getBoundingClientRect().toJSON())
  }));
  expect(editGeometry.copyWidth).toBeGreaterThanOrEqual(160);
  expect(Math.max(...editGeometry.controls.map(rect => rect.y)) - Math.min(...editGeometry.controls.map(rect => rect.y))).toBeLessThan(1);
  expect(editGeometry.controls.every(rect => rect.width >= 44 && rect.height >= 44)).toBe(true);
  await tokyo.getByRole('button', { name: 'Опустить Tokyo FM', exact: true }).click();
  const arranged = [originalIds[1], originalIds[0], ...originalIds.slice(2)];
  await expect.poll(() => collectionIds(page)).toEqual(arranged);
  expect(await transport(page)).toEqual(before);
  await detail.locator('[data-library-collection-row][data-station-id="uuid-kyoto"]').getByRole('button', { name: 'Убрать Kyoto Groove из плейлиста', exact: true }).click();
  const remaining = arranged.filter(id => id !== 'uuid-kyoto');
  await expect.poll(() => collectionIds(page)).toEqual(remaining);
  expect(await transport(page)).toEqual(before);
  await detail.getByRole('button', { name: 'Готово', exact: true }).click();
  await detail.locator('.library-collection-detail-actions').getByRole('button', { name: 'Слушать', exact: true }).click();
  await expect.poll(async () => (await transport(page)).queue.items.map((station: { stationuuid: string }) => station.stationuuid)).toEqual(remaining);
  expect((await transport(page)).queue.sourceId).toBe('collection-detail-review');
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Лента', exact: true }).click();
  await expect(page.locator('.station-feed-card-content[data-focus="true"]')).toContainText('Osaka Nights');
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Моё', exact: true }).click();
  await expect(page.locator('[data-library-home]')).toBeVisible();
  await page.getByRole('button', { name: `Открыть: ${collection.name}`, exact: true }).click();
  await detail.getByRole('button', { name: 'Вперемешку', exact: true }).click();
  await expect.poll(async () => (await transport(page)).queue.items.map((station: { stationuuid: string }) => station.stationuuid).sort()).toEqual([...remaining].sort());
  expect(await collectionIds(page)).toEqual(remaining);
});

test('delete still needs confirmation and long playlist names fit a narrow phone', async ({ page }) => {
  const longName = 'Музыка для длинного вечера: любимые станции и неожиданные открытия';
  await prepare(page, 390, longName);
  await page.setViewportSize({ width: 320, height: 740 });
  const detail = page.locator('[data-library-collection-detail]');
  await expect(detail.getByRole('heading', { name: longName, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const before = await transport(page);
  await detail.locator('[data-collection-actions-trigger]').click();
  const panel = detail.locator('[data-collection-actions]');
  await panel.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Точно удалить?', exact: true })).toBeVisible();
  expect(await collectionIds(page)).toEqual(originalIds);
  expect(await transport(page)).toEqual(before);
  await panel.getByRole('button', { name: 'Точно удалить?', exact: true }).click();
  await expect(page.locator('[data-library-home]')).toBeVisible();
  await expect.poll(() => collectionIds(page)).toBeUndefined();
  expect(await transport(page)).toEqual(before);
});

test('playlist actions remain reachable in a short viewport above the player', async ({ page }) => {
  await prepare(page);
  await page.setViewportSize({ width: 390, height: 450 });
  const detail = page.locator('[data-library-collection-detail]');
  const before = await transport(page);
  await detail.locator('[data-collection-actions-trigger]').click();
  const panel = detail.locator('[data-collection-actions]');
  await expect(panel).toBeVisible();
  // A short window may scroll the group; every action must be reachable,
  // including the last one, rather than extending underneath the fixed dock.
  for (const button of await panel.locator('button').all()) {
    await button.scrollIntoViewIfNeeded();
    expect(await button.evaluate(button => {
      const rect = button.getBoundingClientRect();
      const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return button.contains(target) && rect.top >= 0 && rect.bottom <= innerHeight;
    })).toBe(true);
  }
  await panel.getByRole('button', { name: 'Закрепить', exact: true }).click();
  await expect(panel).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('radio:library:v2') || '{}').collections[0].pinned)).toBe(true);
  expect(await transport(page)).toEqual(before);
});
