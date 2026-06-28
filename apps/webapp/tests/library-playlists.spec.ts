import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

// PR-3 (library batch): playlist overhaul. Relabel + completed CRUD
// (deleteCollection with a two-tap inline confirm) + dangling-state cleanup +
// the never-auto-switch invariant when the live queue's source is deleted.

const [tokyo, osaka, kyoto, sapporo] = stations;

// Records the src of every element that reaches 'playing' so we can count how
// many DISTINCT fixture stations were actually started (a delete must start 0).
const installPlayProbe = async (page: Page) => {
  await page.addInitScript(() => {
    (window as unknown as { __playSrcs: string[] }).__playSrcs = [];
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      (window as unknown as { __playSrcs: string[] }).__playSrcs.push(
        this.src || this.currentSrc || ''
      );
      this.setAttribute('data-ra-state', 'playing');
      this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    };
  });
};

const STATION_SLUGS = stations.map((s) => s.url_resolved.split('/').pop() as string);
const distinctPlayedStations = (page: Page) =>
  page.evaluate((slugs) => {
    const srcs = (window as unknown as { __playSrcs: string[] }).__playSrcs;
    return slugs.filter((slug) => srcs.some((src) => src.includes(slug))).length;
  }, STATION_SLUGS);

const queueState = (page: Page) =>
  page.evaluate(() => {
    try {
      const raw = window.localStorage.getItem('radio:player:v2');
      const queue = raw ? JSON.parse(raw)?.queue : null;
      return queue
        ? { length: queue.items?.length ?? 0, sourceId: queue.sourceId ?? null }
        : { length: 0, sourceId: null };
    } catch {
      return { length: 0, sourceId: null };
    }
  });

const seedOnePlaylist = (page: Page, stationIds: string[]) =>
  seedRadioState(page, {
    activeSection: 'library',
    libraryTab: 'collections',
    collections: [{ id: 'pl-mix', name: 'My Mix', stationIds }],
    stationCache: [tokyo, osaka, kyoto, sapporo]
  });

test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await page.setViewportSize({ width: 390, height: 844 });
});

test('the tab and section now read «Плейлисты»', async ({ page }) => {
  await seedOnePlaylist(page, [sapporo.stationuuid]);
  await page.goto('/?api=/api');
  await expect(page.locator('.library-tab-strip')).toContainText(/Плейлисты|Playlists/);
});

test('two-tap delete from detail removes the playlist and closes the detail cleanly', async ({
  page
}) => {
  await seedOnePlaylist(page, [sapporo.stationuuid]);
  await page.goto('/?api=/api');
  // Open the detail via the title button.
  await page.locator('.library-collection-title-button').first().click();
  await expect(page.locator('.library-collection-detail')).toBeVisible();

  // Declutter: Delete moved off the hero row into the «Ещё» overflow sheet
  // (keeps the two-tap inline confirm).
  await page
    .locator('.library-collection-detail')
    .getByRole('button', { name: /^Ещё$|^More$/ })
    .click();
  const sheet = page.locator('[data-library-sheet="collection-detail-actions"]');
  await expect(sheet).toBeVisible();
  const del = sheet.locator('.library-sheet-action-danger');
  await expect(del).toContainText(/Удалить|Delete/);
  // First tap arms the confirm; the playlist still exists, the sheet stays open.
  await del.click();
  await expect(del).toContainText(/Точно|sure/i);
  await expect(sheet).toBeVisible();
  await expect(page.locator('.library-collection-detail')).toBeVisible();
  // Second tap commits: sheet + detail close, the grid is back, playlist gone.
  await del.click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('.library-collection-detail')).toHaveCount(0);
  await expect(page.locator('.library-collection-card')).toHaveCount(0);
  await expect(page.locator('.library-inline-toast')).toContainText(/удал|deleted/i);
});

test('deleting the LIVE queue source keeps playback going (never-auto-switch)', async ({
  page
}) => {
  await installPlayProbe(page);
  await seedOnePlaylist(page, [tokyo.stationuuid, osaka.stationuuid]);
  await page.goto('/?api=/api');

  // Play the playlist → the queue source is this collection.
  await page
    .locator('.library-collection-card-actions')
    .getByRole('button', { name: /Слушать|Play/ })
    .first()
    .click();
  await expect(page.locator('.player-dock-bar')).toBeVisible();
  await expect.poll(() => queueState(page).then((q) => q.sourceId)).toBe('collection-pl-mix');
  const before = await queueState(page);
  expect(before.length).toBeGreaterThan(0);
  expect(await distinctPlayedStations(page)).toBe(1);

  // Delete that very playlist (two-tap via the detail «Ещё» sheet).
  await page.locator('.library-collection-title-button').first().click();
  await page
    .locator('.library-collection-detail')
    .getByRole('button', { name: /^Ещё$|^More$/ })
    .click();
  const del = page.locator('[data-library-sheet="collection-detail-actions"] .library-sheet-action-danger');
  await del.click();
  await del.click();
  await page.waitForTimeout(300);

  // The live queue keeps playing: no extra station started, items intact.
  expect(await distinctPlayedStations(page)).toBe(1);
  const after = await queueState(page);
  expect(after.length).toBe(before.length);
});

test('an empty playlist offers «Добавить станции» that jumps to Search', async ({ page }) => {
  await seedOnePlaylist(page, []);
  await page.goto('/?api=/api');
  const addChip = page.getByRole('button', { name: /Добавить станции|Add stations/ }).first();
  await expect(addChip).toBeVisible();
  await addChip.click();
  await expect(page.locator('#search-hero-input')).toBeVisible();
});

test('mobile «···» opens the actions sheet with a two-tap delete', async ({ page }) => {
  await seedOnePlaylist(page, [sapporo.stationuuid]);
  await page.goto('/?api=/api');
  await page.locator('.library-collection-more').first().click();
  // S3 sheet (portaled) with the full action set.
  const sheetDelete = page.locator('.library-sheet-action-danger');
  await expect(sheetDelete).toBeVisible();
  await sheetDelete.click();
  await expect(sheetDelete).toContainText(/Точно|sure/i);
  await sheetDelete.click();
  await expect(page.locator('.library-collection-card')).toHaveCount(0);
});
