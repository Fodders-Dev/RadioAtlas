import { expect, test } from '@playwright/test';
import { mockStations, seedRadioState } from './helpers';

test('Lira keeps a growing draft and real media-error toast above a shrinking visual viewport', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mockStations(page);
  await seedRadioState(page);
  // This is a keyboard geometry simulation, not a claim of physical iOS testing.
  // Keep the 844px layout viewport while the bridge sees 500px of usable height.
  await page.route('**/vendor/telegram-web-app.js', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: Object.assign(new EventTarget(), {
      height: 844, width: 390, offsetTop: 0, offsetLeft: 0, scale: 1
    }) });
  });
  let streamAttempts = 0;
  // Leave HTMLMediaElement real: upstream failure must reach the player and
  // create its own toast. Never insert a toast or dispatch a fake media event.
  for (const pattern of ['https://stream.example.com/**', '**/stream?url=**']) {
    await page.route(pattern, route => {
      streamAttempts++;
      return route.fulfill({ status: 502, body: 'stream unavailable' });
    });
  }
  await page.goto('/?calm=1');
  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Лира', exact: true }).click();
  const chat = page.locator('[data-chat-sheet]');
  await expect(chat.locator('[data-chat-opening-card]').first()).toBeVisible();
  const field = chat.getByRole('textbox');
  await field.fill('Хочу музыку для прогулки.\nБез новостей.\nСпокойную электронику.\nИли немного джаза.');
  await expect(chat.locator('.chat-composer-glass .chat-send-btn')).toBeEnabled();
  await chat.locator('[data-chat-opening-card] .chat-station-card').first().click();
  const toast = page.locator('.app-shell-v2 > .toast');
  await expect(toast).toContainText('Поток сейчас недоступен', { timeout: 40_000 });
  expect(streamAttempts).toBeGreaterThan(0);
  await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'error');
  await expect(chat.locator('[data-chat-opening-card] .chat-station-note').first()).toHaveText('Выбранный источник');
  const chips = chat.locator('[data-chat-prompts]');
  await expect.poll(async () => {
    const notice = await toast.boundingBox(), prompts = await chips.boundingBox();
    expect(notice).not.toBeNull(); expect(prompts).not.toBeNull();
    return notice!.y + notice!.height <= prompts!.y - 4;
  }).toBe(true);

  await field.focus();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 500 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect.poll(() => chat.evaluate(el => Math.round(el.getBoundingClientRect().height))).toBe(500);
  const capsule = await chat.locator('.chat-composer-glass').boundingBox();
  const mini = await page.locator('[data-calm-player]').boundingBox();
  const nav = await page.locator('.app-navigation-mobile').boundingBox();
  expect(capsule).not.toBeNull(); expect(mini).not.toBeNull(); expect(nav).not.toBeNull();
  expect(capsule!.y).toBeGreaterThan(0);
  expect(capsule!.y + capsule!.height).toBeLessThanOrEqual(mini!.y);
  expect(mini!.y + mini!.height).toBeLessThanOrEqual(nav!.y);
  expect(nav!.y + nav!.height).toBeLessThanOrEqual(500);
  await expect(field).toHaveValue(/Спокойную электронику/);
  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Главная', exact: true }).click();
  await expect(chat).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-calm-chat');
});
