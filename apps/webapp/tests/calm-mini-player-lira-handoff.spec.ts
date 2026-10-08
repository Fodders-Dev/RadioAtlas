import { expect, test } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

test('Lira can hand off to the current Feed player and the mini heart preserves listening state', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockStations(page);
  await installMediaMocks(page);
  await seedRadioState(page, {
    queue: stations.slice(0, 2),
    queueCurrentIndex: 0,
    queueSourceId: 'lira-mini-handoff',
    queueSourceLabel: 'Мини-плеер',
    stationCache: stations
  });
  await page.addInitScript(() => localStorage.setItem('radio:theme-current:v1', JSON.stringify('journal')));
  await page.route('**/ai/chat**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    reply: 'Плейлист остаётся с тобой', stations: [], actions: [{ kind: 'none' }]
  }) }));

  await page.goto('/?calm=1');
  const mini = page.locator('[data-calm-player]');
  await expect(mini).toBeVisible();
  await mini.locator('.calm-mini-play').click();
  await expect(mini).toHaveAttribute('data-status', 'playing');
  const bookmark = mini.locator('.calm-capture');
  await expect(bookmark).toBeVisible();
  await bookmark.click();
  await expect(bookmark).toHaveAttribute('aria-pressed', 'true');

  const queueBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue);
  const audioBefore = await page.locator('audio').getAttribute('src');
  expect(audioBefore).toBeTruthy();
  await page.getByRole('button', { name: 'Лира', exact: true }).click();
  let chat = page.locator('[data-chat-sheet]');
  await chat.getByRole('textbox').fill('Сохрани мой контекст.');
  await chat.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(chat.getByText('Плейлист остаётся с тобой', { exact: true })).toBeVisible();
  const liraHistoryBefore = await page.evaluate(() => localStorage.getItem('radio:lira-thread:v1'));

  await mini.locator('.calm-mini-info').click();
  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  await expect(page.locator('.app-shell-v2')).toHaveAttribute('data-active-section', 'feed');
  await expect(chat).toHaveCount(0);
  await expect(page.locator('.station-feed-card').first()).toHaveAttribute('data-feed-station', stations[0].stationuuid);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue)).toEqual(queueBefore);
  expect(await page.locator('audio').getAttribute('src')).toBe(audioBefore);
  expect(await page.evaluate(() => localStorage.getItem('radio:lira-thread:v1'))).toBe(liraHistoryBefore);

  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Главная', exact: true }).click();
  const favorite = page.locator('[data-calm-player] .calm-mini-favorite');
  await expect(favorite).toHaveAccessibleName('Любимая станция');
  await expect(favorite).toHaveAttribute('aria-pressed', 'false');
  await favorite.click();
  await expect(favorite).toHaveAccessibleName('Убрать из любимых');
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  await expect(bookmark).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.app-shell-v2')).toHaveAttribute('data-active-section', 'home');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue)).toEqual(queueBefore);
  expect(await page.locator('audio').getAttribute('src')).toBe(audioBefore);

  await page.getByRole('button', { name: 'Лира', exact: true }).click();
  chat = page.locator('[data-chat-sheet]');
  await expect(chat.getByText('Сохрани мой контекст.', { exact: true })).toBeVisible();
  await expect(chat.getByText('Плейлист остаётся с тобой', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('radio:lira-thread:v1'))).toBe(liraHistoryBefore);
});

for (const { width, height, theme } of [
  { width: 390, height: 844, theme: 'journal' },
  { width: 834, height: 1112, theme: 'journal' },
  { width: 1440, height: 900, theme: 'journal' },
  { width: 390, height: 844, theme: 'neon' },
  { width: 834, height: 1112, theme: 'neon' },
  { width: 1440, height: 900, theme: 'neon' }
]) {
  test(`calm mini favorite and track save fit at ${width}px in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockStations(page);
    await installMediaMocks(page);
    await seedRadioState(page, { queue: [stations[0]], queueCurrentIndex: 0, stationCache: [stations[0]] });
    await page.addInitScript(themeName => localStorage.setItem('radio:theme-current:v1', JSON.stringify(themeName)), theme);
    await page.goto('/?calm=1');
    const mini = page.locator('[data-calm-player]');
    await expect(mini).toBeVisible();
    await mini.locator('.calm-mini-play').click();
    await expect(mini.locator('.calm-capture')).toBeVisible();
    const geometry = await page.evaluate(() => {
      const mini = document.querySelector<HTMLElement>('[data-calm-player]')!;
      const info = mini.querySelector<HTMLElement>('.calm-mini-info')!.getBoundingClientRect();
      const buttons = [...mini.querySelectorAll<HTMLElement>('button:not(.calm-mini-info)')].map(button => {
        const box = button.getBoundingClientRect();
        return { left: box.left, right: box.right, width: box.width, height: box.height };
      });
      const box = mini.getBoundingClientRect();
      return { viewport: window.innerWidth, document: document.documentElement.scrollWidth, mini: { left: box.left, right: box.right }, infoRight: info.right, buttons };
    });
    expect(geometry.document).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.mini.left).toBeGreaterThanOrEqual(0);
    expect(geometry.mini.right).toBeLessThanOrEqual(geometry.viewport);
    for (let index = 0; index < geometry.buttons.length; index += 1) {
      const button = geometry.buttons[index]!;
      expect(button.width).toBeGreaterThanOrEqual(43.5);
      expect(button.height).toBeGreaterThanOrEqual(43.5);
      expect(button.left).toBeGreaterThanOrEqual(geometry.infoRight - 1);
      if (index > 0) expect(button.left).toBeGreaterThanOrEqual(geometry.buttons[index - 1]!.right - 1);
    }
  });
}
