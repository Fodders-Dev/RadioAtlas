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
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible({
    timeout: 15_000
  });
};

const openHomeWithoutShim = async (page: Page) => {
  await installMediaMocks(page);
  await mockStations(page);
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible({
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
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible({
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
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible({
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
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible({
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
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible({
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

// T1.3: Telegram themeParams as a render-time theme layer. The
// strict gate is `isInsideTelegramClient()` (non-empty initData);
// the synthesis floor is "at least one of bg_color / accent_text_color
// / link_color / button_color is present". Tests verify both edges
// plus the themeChanged re-apply flow.

const readThemeTokens = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    const style = root.style;
    return {
      datasetTheme: root.dataset.theme ?? '',
      accent: style.getPropertyValue('--theme-accent').trim(),
      accent2: style.getPropertyValue('--theme-accent-2').trim(),
      background: style.getPropertyValue('--theme-bg-image').trim()
    };
  });

test('T1.3 (a) inside-telegram with themeParams applies Telegram colours to render tokens', async ({
  page
}) => {
  await installTelegramShim(page, {
    themeParams: {
      bg_color: '#123456',
      accent_text_color: '#abcdef',
      button_color: '#fedcba'
    }
  });
  await installMediaMocks(page);
  await mockStations(page);
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible({
    timeout: 15_000
  });

  const tokens = await readThemeTokens(page);
  // dataset.theme = 'telegram-auto' when synthesis activates. This
  // is the strongest single-line signal that the override path ran.
  expect(tokens.datasetTheme).toBe('telegram-auto');
  // Direct hex pass-through — buildTelegramThemeVars wraps bg_color
  // as a flat linear-gradient so the --theme-bg-image var contract
  // ("gradient or url()") stays valid.
  expect(tokens.background).toContain('#123456');
  expect(tokens.accent).toBe('#abcdef');
  expect(tokens.accent2).toBe('#fedcba');
});

test('T1.3 (b) explicit Theme Studio pick wins over Telegram themeParams', async ({
  page
}) => {
  // Pre-seed the user's pick BEFORE the page boots — `useLocalStorage`
  // reads at mount and the predicate `currentThemeId !== DEFAULT_THEME_ID`
  // gates the synthesis. Choosing 'neon' (another built-in) is enough
  // to take the user out of the default-pick lane.
  await page.addInitScript(() => {
    window.localStorage.setItem('radio:theme-current:v1', JSON.stringify('neon'));
  });
  await installTelegramShim(page, {
    themeParams: {
      bg_color: '#123456',
      accent_text_color: '#abcdef'
    }
  });
  await installMediaMocks(page);
  await mockStations(page);
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible({
    timeout: 15_000
  });

  const tokens = await readThemeTokens(page);
  // User picked Neon — telegram-auto MUST NOT override.
  expect(tokens.datasetTheme).toBe('neon');
  // And the Telegram hex values MUST NOT leak into the render tokens.
  expect(tokens.background).not.toContain('#123456');
  expect(tokens.accent).not.toBe('#abcdef');
});

test('T1.3 (c) standalone-web (no SDK) never picks up Telegram colours', async ({
  page
}) => {
  // No installTelegramShim — window.Telegram is undefined; the strict
  // gate in getTelegramThemeParams returns null, synthesis stays off.
  await installMediaMocks(page);
  await mockStations(page);
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible({
    timeout: 15_000
  });

  const tokens = await readThemeTokens(page);
  expect(tokens.datasetTheme).toBe('classic');
  // Defensive — even if a hex slipped through, the test fixture
  // colours aren't anywhere in the bundled Classic theme.
  expect(tokens.background).not.toContain('#123456');
});

test('T1.3 (d) themeChanged event re-applies tokens without remount', async ({
  page
}) => {
  await installTelegramShim(page, {
    themeParams: { bg_color: '#aaa111' }
  });
  await installMediaMocks(page);
  await mockStations(page);
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible({
    timeout: 15_000
  });

  const before = await readThemeTokens(page);
  expect(before.background).toContain('#aaa111');
  expect(before.datasetTheme).toBe('telegram-auto');

  // Mutate themeParams in place + dispatch listeners — mirrors the
  // SDK's real contract. The hook captures via getTelegramThemeParams
  // (which deep-clones on each call) so setState fires and the
  // useLayoutEffect re-runs without a Provider remount.
  await page.evaluate(() => {
    const trigger = (
      window as Window & {
        __radioatlasTriggerThemeChange__?: (next: Record<string, string>) => void;
      }
    ).__radioatlasTriggerThemeChange__;
    trigger?.({ bg_color: '#bbb222' });
  });

  // Poll because React batches the state update + layout effect.
  await expect
    .poll(async () => (await readThemeTokens(page)).background)
    .toContain('#bbb222');
  const after = await readThemeTokens(page);
  expect(after.background).not.toContain('#aaa111');
  expect(after.datasetTheme).toBe('telegram-auto');
});

test('T1.3 (e) inside-telegram with empty themeParams stays on Classic (floor)', async ({
  page
}) => {
  // PB-4 floor: 0 mapped keys → no synthesis. Without this guard,
  // an empty themeParams payload would still trigger telegram-auto
  // and add a stale dataset.theme attribute despite producing a
  // pixel-identical render to Classic.
  await installTelegramShim(page, {
    themeParams: {} // zero mapped keys
  });
  await installMediaMocks(page);
  await mockStations(page);
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible({
    timeout: 15_000
  });

  const tokens = await readThemeTokens(page);
  expect(tokens.datasetTheme).toBe('classic');
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
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible({
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
