import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations } from './helpers';

// T1.4: keyboard users can open an overlay, Tab stays trapped inside,
// Escape closes it, and focus returns to the element that opened it.

const focusIsInside = (page: Page, selector: string) =>
  page.evaluate((sel) => Boolean(document.activeElement?.closest(sel)), selector);

const activeMatches = (page: Page, selector: string) =>
  page.evaluate((sel) => document.activeElement === document.querySelector(sel), selector);

test.describe('dialog keyboard a11y', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installMediaMocks(page);
    await mockStations(page);
  });

  test('SettingsSheet: focus trap, Escape, and focus restoration', async ({ page }) => {
    await page.goto('/');
    const trigger = page.locator('.mobile-settings-trigger');
    await trigger.click();

    const sheet = page.locator('.settings-sheet');
    await expect(sheet).toBeVisible();
    // Focus landed inside the sheet.
    expect(await focusIsInside(page, '.settings-sheet')).toBe(true);

    // Tab stays trapped inside.
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Tab');
      expect(await focusIsInside(page, '.settings-sheet')).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    // Focus returned to the trigger that opened the sheet.
    expect(await activeMatches(page, '.mobile-settings-trigger')).toBe(true);
  });

  // Search mobile rebuild: the filter selects live in a portaled bottom sheet.
  test('Search filters sheet: focus trap, Escape, and focus restoration', async ({ page }) => {
    await page.goto('/');
    await page.locator('.app-navigation-mobile').getByRole('button', { name: /Поиск|Search/ }).click();
    await page.locator('#search-hero-input').first().fill('jpop');
    await expect(page.locator('[data-search-station-card]').first()).toBeVisible();

    const trigger = page.locator('.search-hero-filters-pill');
    await trigger.click();

    const sheet = page.locator('[data-search-filters-sheet]');
    await expect(sheet).toBeVisible();
    expect(await focusIsInside(page, '[data-search-filters-sheet]')).toBe(true);

    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      expect(await focusIsInside(page, '[data-search-filters-sheet]')).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    // Focus returned to the «Фильтры» pill that opened the sheet.
    expect(await activeMatches(page, '.search-hero-filters-pill')).toBe(true);
  });

  test('FullPlayerOverlay: focus trap, Escape, and focus restoration', async ({ page }) => {
    await page.goto('/');
    // Play a station so the dock (and its artwork trigger that opens the
    // full player) is present.
    await page.locator('.app-navigation-mobile').getByRole('button', { name: /Поиск|Search/ }).click();
    await page.locator('#search-hero-input').first().fill('o');
    await page.getByRole('button', { name: /Играть выдачу|Play results/ }).click();
    await expect(page.locator('.player-dock-bar')).toBeVisible();

    const artwork = page.locator('.player-dock-artwork-trigger');
    await artwork.click();

    const overlay = page.locator('[data-full-player-overlay]');
    await expect(overlay).toBeVisible();
    expect(await focusIsInside(page, '[data-full-player-overlay]')).toBe(true);

    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Tab');
      expect(await focusIsInside(page, '[data-full-player-overlay]')).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0);
    // The dock (and its artwork trigger) re-mounts on close; focus lands
    // there via the dialog's restoreFocusTo override.
    await expect.poll(() => activeMatches(page, '.player-dock-artwork-trigger')).toBe(true);
  });

  test('T1.8: visible focus indicator + <html lang> reflects locale', async ({ page }) => {
    await page.goto('/');
    // LocaleProvider syncs <html lang> to the default locale on boot.
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('ru');

    await page.locator('.app-navigation-mobile').getByRole('button', { name: /Поиск|Search/ }).click();
    const input = page.locator('#search-hero-input');
    await input.focus();
    // The search input previously had outline:0; :focus-visible now restores
    // a real indicator (text inputs match :focus-visible on focus).
    const outline = await input.evaluate((el) => {
      const style = getComputedStyle(el);
      return { width: style.outlineWidth, lineStyle: style.outlineStyle };
    });
    expect(outline.lineStyle).not.toBe('none');
    expect(parseFloat(outline.width)).toBeGreaterThan(0);
  });
});
