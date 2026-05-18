import { expect, test, type Page } from '@playwright/test';
import {
  installMediaMocks,
  installTelegramShim,
  mockStations,
  playHomeStation,
  readTelegramSpyState,
  seedRadioState,
  stations
} from './helpers';

// `vite dev` (which Playwright spawns) leaves React.StrictMode active,
// which intentionally double-invokes mount effects. Calls like
// disableVerticalSwipes / disableClosingConfirmation are idempotent in
// the SDK and persist for the WebApp lifetime, so we assert ">=1"
// rather than "exactly 1" for any effect-driven call. Click-driven
// calls (HapticFeedback) still assert "exactly 1" because onClick
// handlers are not double-invoked by StrictMode.

const openHomeWithShim = async (page: Page) => {
  await installTelegramShim(page);
  await installMediaMocks(page);
  await mockStations(page);
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible({
    timeout: 15_000
  });
};

const openHomeWithoutShim = async (page: Page) => {
  await installMediaMocks(page);
  await mockStations(page);
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible({
    timeout: 15_000
  });
};

test('inside-telegram fixture: disableVerticalSwipes fires on mount', async ({ page }) => {
  await openHomeWithShim(page);
  const state = await readTelegramSpyState(page);
  // StrictMode double-invokes the mount effect in dev; both calls are
  // idempotent on the SDK side.
  expect(state.disableVerticalSwipes).toBeGreaterThanOrEqual(1);
});

test('standalone-web fixture: disableVerticalSwipes does NOT fire (window.Telegram undefined)', async ({
  page
}) => {
  await openHomeWithoutShim(page);
  const telegramShape = await page.evaluate(() => typeof window.Telegram);
  expect(telegramShape).toBe('undefined');
  const state = await readTelegramSpyState(page);
  expect(state.disableVerticalSwipes).toBe(0);
});

test('inside-telegram: play toggles enableClosingConfirmation; pause toggles disableClosingConfirmation', async ({
  page
}) => {
  await installTelegramShim(page);
  await installMediaMocks(page);
  await mockStations(page);
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible({
    timeout: 15_000
  });

  // Snapshot AFTER mount so we don't double-count StrictMode's initial
  // disableClosingConfirmation (player starts paused).
  const before = await readTelegramSpyState(page);

  await playHomeStation(page, 'Tokyo FM');
  // The audio mock's play() dispatches `playing`, which flips
  // player.isPlaying true, which fires enableClosingConfirmation.
  await expect.poll(
    async () => (await readTelegramSpyState(page)).enableClosingConfirmation
  ).toBeGreaterThan(before.enableClosingConfirmation);

  const afterEnable = await readTelegramSpyState(page);
  // Toggle to pause: audio mock dispatches `pause` → isPlaying false →
  // disableClosingConfirmation fires.
  await page.locator('.dock-play-btn').click();
  await expect.poll(
    async () => (await readTelegramSpyState(page)).disableClosingConfirmation
  ).toBeGreaterThan(afterEnable.disableClosingConfirmation);
});

test('standalone-web: playing does NOT toggle closing confirmation (no SDK)', async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible({
    timeout: 15_000
  });

  await playHomeStation(page, 'Tokyo FM');
  await page.waitForTimeout(200);
  const state = await readTelegramSpyState(page);
  expect(state.enableClosingConfirmation).toBe(0);
  expect(state.disableClosingConfirmation).toBe(0);
});

test('inside-telegram: dock play button fires exactly one HapticFeedback.impactOccurred("light")', async ({
  page
}) => {
  await installTelegramShim(page);
  await installMediaMocks(page);
  await mockStations(page);
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible({
    timeout: 15_000
  });

  // Actually play a station so the dock-play-btn has a current station
  // to toggle against; without player.current the button is disabled.
  await playHomeStation(page, 'Tokyo FM');
  await expect(page.locator('.dock-play-btn:not([disabled])')).toBeVisible({
    timeout: 15_000
  });
  const before = await readTelegramSpyState(page);
  await page.locator('.dock-play-btn').click();
  await expect
    .poll(async () => (await readTelegramSpyState(page)).impactOccurred.length)
    .toBeGreaterThan(before.impactOccurred.length);
  const after = await readTelegramSpyState(page);
  const newHaptics = after.impactOccurred.slice(before.impactOccurred.length);
  expect(newHaptics).toEqual(['light']);
});

test('standalone-web: dock play button does NOT fire HapticFeedback (no SDK)', async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible({
    timeout: 15_000
  });

  await playHomeStation(page, 'Tokyo FM');
  await expect(page.locator('.dock-play-btn:not([disabled])')).toBeVisible({
    timeout: 15_000
  });
  await page.locator('.dock-play-btn').click();
  await page.waitForTimeout(200);
  const state = await readTelegramSpyState(page);
  expect(state.impactOccurred).toEqual([]);
});

test('inside-telegram: queue row move/remove buttons do NOT fire HapticFeedback (C2 lock-in)', async ({
  page
}) => {
  // C2 lock-in: queue row actions (move up / move down / remove) are
  // edit operations on a list that users batch-click. If a future
  // refactor "adds for consistency" haptics on those buttons, this
  // test fails and forces an explicit decision via a new task rather
  // than a quiet UX regression on every reorder.
  await installTelegramShim(page);
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page, {
    queue: [stations[0]!, stations[1]!, stations[2]!]
  });
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible({
    timeout: 15_000
  });

  // Play to get the dock + full-player overlay reachable.
  await playHomeStation(page, 'Tokyo FM');
  const trigger = page.locator('.player-dock-artwork-trigger');
  await trigger.waitFor({ state: 'visible', timeout: 15_000 });
  await trigger.click({ force: true });
  await expect(page.locator('[data-full-player-overlay]')).toBeVisible({
    timeout: 10_000
  });

  // Drain whatever haptics the dock/full-player mount may have fired
  // so the assertion is strictly about the queue rows.
  const before = await readTelegramSpyState(page);
  const baselineHaptics = before.impactOccurred.length;

  const moveDown = page
    .locator('[data-queue-action="move-down"]:not([disabled])')
    .first();
  const moveUp = page
    .locator('[data-queue-action="move-up"]:not([disabled])')
    .first();
  const remove = page.locator('[data-queue-action="remove"]').first();
  if (await moveDown.isVisible().catch(() => false)) {
    await moveDown.click();
  }
  if (await moveUp.isVisible().catch(() => false)) {
    await moveUp.click();
  }
  if (await remove.isVisible().catch(() => false)) {
    await remove.click();
  }

  await page.waitForTimeout(150);
  const after = await readTelegramSpyState(page);
  expect(after.impactOccurred.length).toBe(baselineHaptics);
});
