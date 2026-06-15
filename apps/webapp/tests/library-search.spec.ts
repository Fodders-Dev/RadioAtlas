import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

// PR-2 (library batch): an inline filter over the user's OWN library
// (favorites + recent + collections + follows) — NOT the 57k catalog. Empty
// query leaves the tabs untouched; a non-empty query replaces the tab strip +
// content with a single result list, each row tagged with its origin.

const [tokyo, osaka, kyoto, sapporo] = stations;

const searchInput = (page: Page) => page.locator('.library-search-input');

const seedLibrary = (page: Page) =>
  seedRadioState(page, {
    activeSection: 'library',
    libraryTab: 'favorites',
    favorites: [tokyo, osaka],
    recent: [kyoto],
    collections: [{ id: 'col-jazz', name: 'Jazz Den', stationIds: [sapporo.stationuuid] }],
    stationCache: [sapporo]
  });

test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await page.setViewportSize({ width: 390, height: 844 });
});

test('empty query keeps the tabs; a query filters the library and tags origins', async ({
  page
}) => {
  await seedLibrary(page);
  await page.goto('/?api=/api');
  await expect(searchInput(page)).toBeVisible();

  // Empty query → the normal tab strip is present.
  await expect(page.locator('.library-tab-strip')).toBeVisible();

  // Filter to a single favorite.
  await searchInput(page).fill('tokyo');
  // The tab strip is replaced by the result list.
  await expect(page.locator('.library-tab-strip')).toHaveCount(0);
  await expect(page.locator('.library-search-results')).toBeVisible();
  await expect(page.locator('.station-title')).toHaveCount(1);
  await expect(page.locator('.station-title')).toContainText('Tokyo FM');
  // Count announcer + origin badge (favorite).
  await expect(page.locator('.library-search-result-bar')).toContainText(/1/);
  await expect(page.locator('.station-source-badge')).toContainText(/Избранное|Favorite/);

  // A collection-only station is tagged with the collection name.
  await searchInput(page).fill('sapporo');
  await expect(page.locator('.station-title')).toContainText('Sapporo City Pop');
  await expect(page.locator('.station-source-badge')).toContainText(/Jazz Den/);

  // Clearing returns the tabs.
  await page.locator('.library-search-clear').click();
  await expect(page.locator('.library-tab-strip')).toBeVisible();
  await expect(searchInput(page)).toBeFocused();
});

test('no match offers "search the catalog" and hands the query to the Search screen', async ({
  page
}) => {
  await seedLibrary(page);
  await page.goto('/?api=/api');
  await expect(searchInput(page)).toBeVisible();

  await searchInput(page).fill('zzznotinlibrary');
  await expect(page.locator('.library-empty-state')).toBeVisible();
  await expect(page.locator('.library-empty-title')).toContainText(/zzznotinlibrary/);

  await page.getByRole('button', { name: /Искать в каталоге|Search the catalog/ }).click();
  // Lands on the Search screen with the query carried over as the draft.
  await expect(page.locator('#search-hero-input')).toBeVisible();
  await expect(page.locator('#search-hero-input')).toHaveValue('zzznotinlibrary');
});

test('an empty library shows the empty-library notice, not a no-match notice', async ({ page }) => {
  await seedRadioState(page, { activeSection: 'library', libraryTab: 'favorites' });
  await page.goto('/?api=/api');
  await expect(searchInput(page)).toBeVisible();

  await searchInput(page).fill('anything');
  await expect(page.locator('.library-empty-title')).toContainText(
    /пуста|library is empty/i
  );
});
