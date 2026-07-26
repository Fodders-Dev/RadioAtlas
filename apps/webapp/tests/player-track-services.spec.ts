import { expect, test } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState } from './helpers';

/**
 * "I like this track — open it in my music service" is a thought you have WHILE
 * it plays. The links existed, but only inside Lira's chat, so reaching them
 * meant leaving the player and asking. They are pure search urls, so the player
 * builds them itself — no network, no assistant.
 *
 * The track row also used to copy the title on tap with nothing on screen saying
 * so. Copying is now a visible row in the same sheet.
 */
const openFullPlayer = async (page: import('@playwright/test').Page) => {
  await page.locator('#search-hero-input').first().fill('Tokyo');
  await expect(page.locator('[data-search-station-card]').first()).toBeVisible();
  await page.getByRole('button', { name: /Играть выдачу|Play results/ }).click();
  await expect(page.locator('.player-dock-bar')).toBeVisible();
  await page
    .locator('.player-dock-artwork-trigger')
    .evaluate((node) => (node as HTMLButtonElement).click());
  await expect(page.locator('[data-full-player-overlay]')).toBeVisible();
  await page.waitForTimeout(400);
};

test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page, { activeSection: 'search' });
  await page.goto('/?api=/api');
});

test('the track row opens every music service plus copy', async ({ page }) => {
  await openFullPlayer(page);
  await page.locator('[data-full-player-track]').click();

  const sheet = page.locator('.full-player-sheet');
  await expect(sheet).toBeVisible();

  const rows = await sheet.locator('.full-player-action-row span').allInnerTexts();
  expect(rows).toEqual([
    'Яндекс Музыка',
    'Звук',
    'VK Музыка',
    'Spotify',
    'SoundCloud',
    'YouTube',
    'Копировать трек'
  ]);
});

test('a service row carries a real search url for the track on air', async ({ page }) => {
  await openFullPlayer(page);
  const track = (await page.locator('[data-full-player-track] span').first().innerText()).trim();
  expect(track.length).toBeGreaterThan(0);

  // The sheet opens links through Telegram's openLink when present, so assert on
  // what the app would hand over rather than on a navigation.
  await page.evaluate(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    (window as unknown as { Telegram?: unknown }).Telegram = {
      WebApp: { openLink: (url: string) => (window as unknown as { __opened: string[] }).__opened.push(url) }
    };
  });

  await page.locator('[data-full-player-track]').click();
  await page.locator('.full-player-action-row', { hasText: 'Яндекс Музыка' }).click();

  const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
  expect(opened).toHaveLength(1);
  expect(opened[0]).toContain('music.yandex.ru/search?text=');
  // A SEARCH page for the actual title — never a guessed track id.
  expect(decodeURIComponent(opened[0]!)).toContain(track.split(' - ')[0]!.slice(0, 12));
});
