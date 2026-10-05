import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, openLibraryCategory, seedRadioState, stations } from './helpers';

const saved = Array.from({ length: 200 }, (_, index) => ({
  ...stations[0], stationuuid: `favorite-${index}`, name: `Saved station ${String(index + 1).padStart(3, '0')}`,
  url: `https://stream.example.com/saved-${index}`, url_resolved: `https://stream.example.com/saved-${index}`
}));
const readQueue = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue as {
  items: { stationuuid: string }[]; currentIndex: number; sourceId: string;
});

for (const shuffled of [false, true]) {
  test(`all 200 favorites survive ${shuffled ? 'shuffle' : 'ordered'} listening, last-item Play and reload`, async ({ page }) => {
    await installMediaMocks(page);
    await mockStations(page);
    await seedRadioState(page, { activeSection: 'library', favorites: saved, stationCache: saved, seedOnlyIfAbsent: true });
    await page.goto('/?calm=1');
    await page.locator('[data-library-destination="favorites"]').getByRole('button', {
      name: shuffled ? 'Вперемешку' : 'Слушать', exact: true
    }).click();
    await expect.poll(async () => (await readQueue(page))?.items.length).toBe(200);
    const original = await readQueue(page);
    expect(original.sourceId).toBe(shuffled ? 'favorites-shuffle' : 'favorites');
    expect(original.items.map(item => item.stationuuid).sort()).toEqual(saved.map(item => item.stationuuid).sort());
    if (!shuffled) expect(original.items.map(item => item.stationuuid)).toEqual(saved.map(item => item.stationuuid));
    await openLibraryCategory(page, 'queue');
    const last = original.items[199];
    const lastStation = saved.find(station => station.stationuuid === last.stationuuid)!;
    await page.locator('.calm-queue-list [data-queue-row]').filter({ hasText: lastStation.name }).getByRole('button', { name: /Слушать|Play/ }).click();
    await expect.poll(async () => (await readQueue(page)).currentIndex).toBe(199);
    await expect(page.locator('[data-queue-current]')).toHaveAttribute('data-queue-current', last.stationuuid);
    const started = await readQueue(page);
    expect(started.items).toEqual(original.items);
    await page.reload();
    await expect(page.locator('[data-library-home]')).toBeVisible();
    expect(await readQueue(page)).toEqual(started);
    await openLibraryCategory(page, 'queue');
    await expect(page.locator('[data-queue-current]')).toHaveAttribute('data-queue-current', last.stationuuid);
    await page.locator('[data-queue-current]').getByRole('button', { name: 'В Ленту', exact: true }).click();
    await expect(page.locator('.station-feed-card-content[data-focus="true"]')).toContainText(lastStation.name);
    expect(await readQueue(page)).toEqual(started);
  });
}
