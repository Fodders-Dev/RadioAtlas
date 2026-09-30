import { expect, test } from '@playwright/test';
import { installMediaMocks, mockStations, openLibraryCategory, seedRadioState } from './helpers';

for (const width of [320, 390]) {
  test(`calm surfaces keep the station card readable in the selected theme at ${width}px`, async ({ page }) => {
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
        if (section === 'Главная') {
          const card = page.locator('[data-calm-discovery-stage]');
          await expect(card.locator('[data-stage-cover-stack]')).toBeVisible();
          await expect(card.locator('[data-stage-play]')).toBeVisible();
          await expect(card.locator('[data-calm-entry]')).toHaveCount(0);
          const colors = await card.evaluate(el => ({
            ink: getComputedStyle(el).color,
            title: getComputedStyle(el.querySelector('.calm-stage-station')!).color,
            description: getComputedStyle(el.querySelector('.calm-stage-description')!).color,
            info: getComputedStyle(el.querySelector('.calm-stage-info')!).color,
            next: getComputedStyle(el.querySelector('.calm-stage-next')!).color,
            nextIcon: getComputedStyle(el.querySelector('.calm-stage-next svg')!).stroke,
            play: getComputedStyle(el.querySelector('[data-stage-play]')!).color,
            playBackground: getComputedStyle(el.querySelector('[data-stage-play]')!).backgroundColor,
          }));
          expect(colors).toEqual({ ink: 'rgb(48, 47, 40)', title: 'rgb(48, 47, 40)', description: 'rgb(81, 79, 68)', info: 'rgb(48, 70, 57)', next: 'rgb(48, 70, 57)', nextIcon: 'rgb(48, 70, 57)', play: 'rgb(255, 248, 233)', playBackground: 'rgb(169, 71, 48)' });
          if (theme === 'classic') {
            const darkColors = await card.evaluate(el => {
              const root = document.documentElement;
              const prior = root.getAttribute('data-theme-mode');
              root.setAttribute('data-theme-mode', 'dark');
              const result = [
                getComputedStyle(el.querySelector('.calm-stage-station')!).color,
                getComputedStyle(el.querySelector('.calm-stage-description')!).color,
              ];
              if (prior) root.setAttribute('data-theme-mode', prior); else root.removeAttribute('data-theme-mode');
              return result;
            });
            expect(darkColors).toEqual(['rgb(48, 47, 40)', 'rgb(81, 79, 68)']);
          }
        }
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
          await openLibraryCategory(page, 'favorites');
          const ink = await page.locator('html').evaluate(el => (el as HTMLElement).style.getPropertyValue('--accent-ink'));
          // Empty-state links also carry .active, but deliberately use a pale
          // outlined material. Check the actual accent-filled controls.
          await expect(page.locator('.library-tab-chip.active')).toHaveCSS('color', ink);
        }
      }
    }
    await nav.getByRole('button', { name: 'Главная', exact: true }).click();
    await expect(page.locator('.calm-stage-art-mark .station-artwork')).toBeVisible();
    await page.locator('[data-stage-play]').click();
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
