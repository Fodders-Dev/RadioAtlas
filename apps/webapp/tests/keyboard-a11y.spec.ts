import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

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
    // Focus lands on the visible close control, never the full-screen backdrop.
    expect(await focusIsInside(page, '.settings-sheet')).toBe(true);
    expect(await activeMatches(page, '[data-dialog-initial-focus]')).toBe(true);
    expect(await activeMatches(page, '[data-dialog-backdrop]')).toBe(false);

    // Tab stays trapped inside.
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Tab');
      expect(await focusIsInside(page, '.settings-sheet')).toBe(true);
    }

    const clearCache = sheet.getByRole('button', { name: /Очистить кэш|Clear cache/ });
    await clearCache.click();
    const confirmation = sheet.getByRole('group', {
      name: /Очистить кэш каталога и глобуса|Clear the catalog and globe cache/
    });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: /Отмена|Cancel/ }).click();
    await expect(clearCache).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    // Focus returned to the trigger that opened the sheet.
    expect(await activeMatches(page, '.mobile-settings-trigger')).toBe(true);
  });

  test('Lira stays in local navigation and opens its chat sheet', async ({ page }) => {
    await page.goto('/');
    const trigger = page.locator('.mobile-nav-chat');
    await expect(trigger).toBeVisible();
    await trigger.click();

    const sheet = page.locator('[data-chat-sheet]');
    await expect(sheet).toBeVisible();
    expect(await focusIsInside(page, '[data-chat-sheet]')).toBe(true);

    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    expect(await activeMatches(page, '.mobile-nav-chat')).toBe(true);
  });

  // PR-4b: the theme builder's mobile sub-sheets portal to <body> with their
  // own useDialog — trap, Escape, and focus restoration must hold even with
  // the SettingsSheet dialog still open underneath.
  test('Theme builder sub-sheet: focus trap, Escape, and focus restoration', async ({ page }) => {
    await page.goto('/');
    await page.locator('.mobile-settings-trigger').click();
    await page.getByRole('button', { name: /Open Theme Studio|Открыть Theme Studio/ }).click();
    await page.locator('[data-theme-builder-background-source]').selectOption('__custom__');

    const trigger = page.locator('.theme-builder-gradient-trigger');
    await trigger.click();

    const sheet = page.locator('[data-theme-builder-subsheet="gradient"]');
    await expect(sheet).toBeVisible();
    expect(await focusIsInside(page, '[data-theme-builder-subsheet="gradient"]')).toBe(true);

    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      expect(await focusIsInside(page, '[data-theme-builder-subsheet="gradient"]')).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    // Focus returned to the gradient trigger inside the still-open studio.
    expect(await activeMatches(page, '.theme-builder-gradient-trigger')).toBe(true);
  });

  // Search mobile rebuild: the filter selects live in a portaled bottom sheet.
  test('Search filters sheet: focus trap, Escape, and focus restoration', async ({ page }) => {
    await page.goto('/');
    await page.locator('.app-navigation-mobile').getByRole('button', { name: /Поиск|Search/ }).click();
    await page.locator('#search-hero-input').first().fill('jpop');
    await expect(page.locator('[data-search-station-card]').first()).toBeVisible({ timeout: 15_000 });

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

  test('Search topbar title focuses the search input', async ({ page }) => {
    await page.goto('/');
    await page.locator('.app-navigation-mobile').getByRole('button', { name: /Поиск|Search/ }).click();

    await page.locator('.app-topbar-title-action').click();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id || ''))
      .toBe('search-hero-input');

    await page.locator('#search-hero-input').fill('jazz');
    await expect(page.locator('#search-hero-input')).toHaveAccessibleName(
      /Название, жанр, страна, язык|Name, genre, country, language/
    );
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

  // Phase 2 Discovery Feed: a fullscreen portal dialog — it must honour the same
  // contract (focus lands inside, Tab stays trapped, Escape closes, focus
  // returns to the «Лента» Home entry that opened it).
  test('Discovery feed: focus trap, Escape, and focus restoration', async ({ page }) => {
    await page.goto('/');
    const trigger = page.locator('.home-feed-entry');
    await trigger.click();

    const overlay = page.locator('.station-feed-overlay');
    await expect(overlay).toBeVisible();
    expect(await focusIsInside(page, '.station-feed-overlay')).toBe(true);

    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('Tab');
      expect(await focusIsInside(page, '.station-feed-overlay')).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0);
    // The original trigger unmounts while Feed is open; the dialog now resolves
    // the newly-mounted Home entry (or the Home nav fallback) before restoring.
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.activeElement?.matches(
            '.home-feed-entry, .app-navigation-mobile .mobile-nav-item:first-child'
          )
        )
      )
      .toBe(true);
  });

  // Removed: 'Home like is a standalone keyboard action…' — station cards no
  // longer render a like button (only the play target), so there is no card-level
  // like control on Home to keyboard-activate. The hero favorite stays but is a
  // separate sibling button, not the nested-in-play-target case this guarded.

  test('Library tabs support arrow keys and keep the selected tab after navigation', async ({ page }) => {
    await seedRadioState(page, {
      activeSection: 'library',
      libraryTab: 'queue',
      queue: stations.slice(0, 3)
    });
    await page.goto('/');

    const queueTab = page.getByRole('tab', { name: /Очередь|Queue/ });
    await expect(queueTab).toHaveAttribute('aria-selected', 'true');
    await queueTab.focus();
    await page.keyboard.press('ArrowRight');

    const recentTab = page.getByRole('tab', { name: /Недавнее|Recent/ });
    await expect(recentTab).toHaveAttribute('aria-selected', 'true');

    await page.locator('.app-navigation-mobile').getByRole('button', { name: /Главная|Home/ }).click();
    await page.locator('.app-navigation-mobile').getByRole('button', { name: /Моё|Library|Mine/ }).click();
    await expect(page.getByRole('tab', { name: /Недавнее|Recent/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );
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
