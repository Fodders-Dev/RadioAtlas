import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

/**
 * The compact station row's width budget, held as two contracts at once
 * because they are the same defect seen from two sides.
 *
 * Measured on production at 360px — the canonical Telegram width — before this
 * was fixed: five action buttons took 192px of a 288px shell, the station's
 * name, country and genre shared the remaining **38px**, and «Baden-Württemberg,
 * Germany» rendered at 29% of its length. The buttons were not fine either:
 * 32-36px against this project's 44px touch-target floor.
 *
 * The arithmetic is what makes both non-negotiable: 288 - 42 (artwork) - 8
 * (gap) - 140 (a name worth reading) leaves 98px, which is exactly two 44px
 * targets. So the row carries play and like; «В плейлист», «Поделиться» and
 * «Скрыть» live in the sheet the row body opens. Anything that puts a fourth
 * control back on the row has to take the space from the name again, and that
 * is what these assertions refuse.
 */

const openLibrary = async (page: Page) => {
  await seedRadioState(page, {
    activeSection: 'library',
    libraryTab: 'favorites',
    favorites: stations.slice(0, 3),
    stationCache: stations.slice(0, 3)
  });
  await page.goto('/?api=/api&glass=full');
  await expect(page.locator('[data-station-row]').first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
};

const rowBudget = (page: Page) =>
  // ONE evaluate: separate boundingBox() calls are separate moments (#242).
  page.evaluate(() => {
    const shell = document.querySelector('.station-compact-shell');
    const copy = document.querySelector('.station-compact-copy');
    const actions = document.querySelector('.station-compact-actions');
    if (!shell || !copy || !actions) return null;
    return {
      shell: Math.round(shell.getBoundingClientRect().width),
      copy: Math.round(copy.getBoundingClientRect().width),
      buttons: Array.from(actions.children).map((node) => {
        const rect = node.getBoundingClientRect();
        return { w: Math.round(rect.width), h: Math.round(rect.height) };
      }),
      // Anything whose rendered text is an ellipsis of something much longer.
      // NOTE: an earlier sweep excluded `text-overflow: ellipsis` as "handled"
      // and therefore found nothing — an ellipsis after eight characters IS
      // the bug, so it is counted here.
      truncated: Array.from(document.querySelectorAll('.station-compact-copy *'))
        .filter((node) => node.scrollWidth > node.clientWidth + 1)
        .map((node) => ({
          text: (node.textContent || '').trim().slice(0, 30),
          shown: node.clientWidth,
          needed: node.scrollWidth
        }))
    };
  });

test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await page.setViewportSize({ width: 360, height: 800 });
});

test('every control on the row meets the 44px touch floor', async ({ page }) => {
  await openLibrary(page);
  const budget = await rowBudget(page);
  expect(budget).not.toBeNull();
  expect(budget!.buttons.length).toBeGreaterThan(0);
  for (const button of budget!.buttons) {
    expect(button.w).toBeGreaterThanOrEqual(44);
    expect(button.h).toBeGreaterThanOrEqual(44);
  }
});

test('the row carries two controls, so the name keeps the rest of the width', async ({ page }) => {
  await openLibrary(page);
  const budget = await rowBudget(page);
  expect(budget!.buttons.length).toBeLessThanOrEqual(2);
  // 38px was the defect. 120 is the floor a name, a country and a genre need
  // before an ellipsis stops being information and starts being decoration.
  expect(
    budget!.copy,
    `text column is ${budget!.copy}px of a ${budget!.shell}px row`
  ).toBeGreaterThanOrEqual(120);
});

test('tapping the row opens the actions that left it', async ({ page }) => {
  await openLibrary(page);
  await page.locator('.station-compact-toggle').first().click();
  const sheet = page.locator('.station-row-actions-sheet-list');
  await expect(sheet).toBeVisible({ timeout: 5000 });

  // The three that moved must be reachable, or this was not a declutter but a
  // deletion: nothing else in the app offers them for a row's station.
  const labels = (await sheet.locator('.station-row-actions-sheet-item').allInnerTexts())
    .map((text) => text.trim().toLowerCase());
  expect(labels.some((label) => label.includes('плейлист'))).toBe(true);
  expect(labels.some((label) => label.includes('подел'))).toBe(true);
  expect(labels.some((label) => label.includes('скрыт') || label.includes('вернут'))).toBe(true);
});
