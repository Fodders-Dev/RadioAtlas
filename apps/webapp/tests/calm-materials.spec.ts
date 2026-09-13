import { expect, test } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState } from './helpers';

for (const width of [320, 390]) {
  test(`calm surfaces use the selected theme and the spectrum stays inside Play at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockStations(page);
    await installMediaMocks(page);
    await seedRadioState(page);
    await page.goto('/?calm=1');
    const nav = page.locator('.app-navigation-mobile');
    const shell = page.locator('.app-shell-v2');
    for (const theme of ['classic', 'neon', 'journal']) {
      await nav.getByRole('button', { name: 'Главная', exact: true }).click();
      await page.getByRole('button', { name: 'Оформление', exact: true }).click();
      await page.locator(`[data-theme-card="${theme}"]`).click();
      await page.keyboard.press('Escape');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      let homeNavigation: unknown;
      for (const section of ['Главная', 'Моё']) {
        await nav.getByRole('button', { name: section, exact: true }).click();
        await expect.poll(() => nav.evaluate(el =>
          el.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length
        )).toBe(0);
        // Legacy Home selectors used to replace the calm panel and fill its
        // active icon. Destinations must share one palette and outline set.
        const navigationStyle = () => nav.evaluate(el => {
          const active = el.querySelector('.mobile-nav-item.active')!;
          const inactive = el.querySelector('.mobile-nav-item:not(.active)')!;
          return {
            panel: getComputedStyle(el).backgroundImage,
            active: getComputedStyle(active).color,
            inactive: getComputedStyle(inactive).color,
          };
        });
        await expect.poll(() => nav.evaluate(el =>
          [...el.querySelectorAll('svg')].every(icon =>
            getComputedStyle(icon).fill === 'none' && getComputedStyle(icon).filter === 'none') &&
          [...el.querySelectorAll('span')].every(label => getComputedStyle(label).textShadow === 'none')
        )).toBe(true);
        if (section === 'Главная') homeNavigation = await navigationStyle();
        else await expect.poll(navigationStyle).toEqual(homeNavigation);
        // The shell is the actual painted backdrop. Checking only root tokens
        // missed light ink over the hardcoded blue legacy shell in production.
        await expect.poll(() => shell.evaluate(el => {
          const painted = getComputedStyle(el).backgroundImage;
          return painted !== 'none' && painted === getComputedStyle(document.body).backgroundImage;
        })).toBe(true);
        if (section === 'Моё') {
          const ink = await page.locator('html').evaluate(el => (el as HTMLElement).style.getPropertyValue('--accent-ink'));
          // Empty-state links also carry .active, but deliberately use a pale
          // outlined material. Check the actual accent-filled controls.
          await expect(page.locator('.library-tab-chip.active')).toHaveCSS('color', ink);
        }
      }
    }
    await nav.getByRole('button', { name: 'Главная', exact: true }).click();
    await expect.poll(() => page.locator('.calm-lira-face img').evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    await page.getByRole('button', { name: /^Включай:/ }).click();
    await nav.getByRole('button', { name: 'Лента', exact: true }).click();
    const play = page.locator('.calm-slide[data-focus="true"] .calm-listen');
    await expect(play).toBeVisible();
    await expect.poll(() => play.evaluate(el => {
      const box = el.getBoundingClientRect();
      const wave = el.querySelector('.station-feed-wave')!.getBoundingClientRect();
      return [...el.querySelectorAll('.station-feed-wave-bar')].every(bar => {
        const b = bar.getBoundingClientRect();
        return b.left >= wave.left - .5 && b.right <= wave.right + .5 &&
          b.top >= box.top && b.bottom <= box.bottom && b.right <= box.right - 8;
      });
    })).toBe(true);
  });
}
