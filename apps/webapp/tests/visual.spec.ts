import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

const waitForStableMetrics = async (
  page: Page,
  selector?: string,
  timeoutMs = 6000
) => {
  let previous = '';
  let stableTicks = 0;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = JSON.stringify(
      await page.evaluate((targetSelector) => {
        const target = targetSelector
          ? document.querySelector(targetSelector)
          : document.documentElement;
        const rect = target?.getBoundingClientRect();
        return {
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
          targetWidth: rect ? Math.round(rect.width) : 0,
          targetHeight: rect ? Math.round(rect.height) : 0
        };
      }, selector)
    );

    if (snapshot === previous) {
      stableTicks += 1;
      if (stableTicks >= 2) {
        break;
      }
    } else {
      previous = snapshot;
      stableTicks = 0;
    }

    await page.waitForTimeout(180);
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => window.scrollY === 0);
  await page.evaluate(() => document.fonts?.ready.then(() => undefined));
  await page.waitForTimeout(120);
};

const openFullPlayerOverlay = async (page: Page) => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      await page.goto('/?api=/api');
    }
    await page.locator('.nav-rail-item').filter({ hasText: 'Поиск' }).first().click();
    await page.locator('.station-row .play-btn').first().click();
    const winampTrigger = page.locator('.player-dock-artwork-trigger');
    await expect(winampTrigger).toBeVisible();
    await winampTrigger.hover();
    await page.waitForTimeout(250);
    await winampTrigger.click({ force: true });
    try {
      await expect(page.locator('.app-shell-v2')).toHaveAttribute('data-winamp-expanded', 'true', {
        timeout: 5000
      });
      await expect(page.locator('[data-full-player-overlay]')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('#webamp')).toHaveCount(0);
      return;
    } catch (error) {
      if (attempt === 1) {
        throw error;
      }
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);
    }
  }
};

const openHome = async (
  page: Page,
  options?: Parameters<typeof seedRadioState>[1]
) => {
  await seedRadioState(page, options);
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible({ timeout: 15_000 });
  await page.locator('.player-dock').first().waitFor({ state: 'visible', timeout: 5000 });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(180);
  await waitForStableMetrics(page);
};

const readHomeSurfaceSignature = async (page: Page) =>
  page.evaluate(() => ({
    personalRadio: Boolean(document.querySelector('[data-home-personal-radio]')),
    hero: document.querySelector('[data-home-hero]')?.getAttribute('data-home-hero') || null,
    rails: Array.from(document.querySelectorAll('[data-home-rail]')).map((node) => ({
      id: node.getAttribute('data-home-rail'),
      stations: Array.from(node.querySelectorAll('[data-home-station]')).map((item) =>
        item.getAttribute('data-home-station')
      )
    }))
  }));

test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await page.setViewportSize({ width: 1440, height: 960 });
});

test('home shell visual baseline', async ({ page }) => {
  await openHome(page);
  const screenshot = await page.screenshot({
    animations: 'disabled'
  });
  expect(screenshot).toMatchSnapshot('home-shell.png', {
    maxDiffPixels: 20_000
  });
});

test('home renders without window.Telegram (standalone web fallback)', async ({ page }) => {
  // T1.1 added a synchronous SDK script tag to index.html. installMediaMocks
  // returns an empty body for that URL, so window.Telegram stays undefined -
  // exactly the shape a browser hitting https://radioatlas.duckdns.org/
  // outside the Telegram client would see. Lock in that Home still renders
  // and that the SDK absence really did happen.
  await openHome(page);
  const tgPresence = await page.evaluate(() => ({
    telegram: typeof window.Telegram,
    webApp: typeof window.Telegram?.WebApp
  }));
  expect(tgPresence.telegram).toBe('undefined');
  expect(tgPresence.webApp).toBe('undefined');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible();
  await expect(page.locator('.player-dock').first()).toBeVisible();
});

test('home shell mobile visual baseline', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page);
  await expect(page).toHaveScreenshot('home-shell-mobile.png', {
    animations: 'disabled',
    fullPage: true
  });
});

test('home shell populated visual baseline', async ({ page }) => {
  await openHome(page, {
    favorites: [stations[4], stations[8]],
    recent: [stations[1], stations[6], stations[9]],
    playbackHistory: [stations[0], stations[4], stations[8]],
    queue: [stations[1], stations[6], stations[9]]
  });
  const screenshot = await page.screenshot({
    animations: 'disabled',
    clip: {
      x: 0,
      y: 0,
      width: 1440,
      height: 1688
    }
  });
  expect(screenshot).toMatchSnapshot('home-shell-populated.png', {
    maxDiffPixelRatio: 0.05
  });
});

test('home surface stays stable during like and play actions', async ({ page }) => {
  await openHome(page);
  const before = await readHomeSurfaceSignature(page);

  await page.locator('[data-home-rail] .home-action-btn-like').first().click();
  await page.locator('[data-home-personal-radio] .home-personal-play').click();
  await expect(page.locator('[data-home-resume]')).toBeVisible();

  const after = await readHomeSurfaceSignature(page);
  // Hero and rail composition stay the same; rail station lists may shrink
  // because Personal Radio now claims its first station (and hides it from
  // discovery rails) once playback starts. We just assert the discovery
  // surface keeps the same shape and never drops a rail or swaps the hero.
  expect(after.personalRadio).toBe(before.personalRadio);
  expect(after.hero).toBe(before.hero);
  expect(after.rails.map((rail) => rail.id)).toEqual(before.rails.map((rail) => rail.id));
});

test('home refresh rebuilds the discovery surface', async ({ page }) => {
  await openHome(page);
  const before = JSON.stringify(await readHomeSurfaceSignature(page));
  await page.locator('.home-personal-refresh').click();
  await expect
    .poll(async () => JSON.stringify(await readHomeSurfaceSignature(page)))
    .not.toBe(before);
});

test('search screen visual baseline', async ({ page }) => {
  await openHome(page);
  await page.locator('.nav-rail-item').filter({ hasText: 'Поиск' }).first().click();
  await expect(page.locator('.station-row:not(.header)')).toHaveCount(stations.length);
  await waitForStableMetrics(page, '.screen-search-v2');
  const screenshot = await page.screenshot({
    animations: 'disabled',
    fullPage: true
  });
  expect(screenshot).toMatchSnapshot('search-screen.png');
});

test('library screen visual baseline', async ({ page }) => {
  await openHome(page);
  await page.locator('.nav-rail-item').filter({ hasText: 'Медиатека' }).first().click();
  await expect(page).toHaveScreenshot('library-screen.png', {
    animations: 'disabled',
    fullPage: true
  });
});

test('full player overlay visual baseline', async ({ page }) => {
  await seedRadioState(page, {
    trackHistory: [
      {
        id: 'track-visual-tokyo',
        stationId: 'uuid-tokyo',
        stationName: 'Tokyo FM',
        track: 'Mock Song',
        timestamp: Date.UTC(2026, 3, 20, 10, 0, 0)
      }
    ]
  });
  await page.goto('/?api=/api');
  await openFullPlayerOverlay(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    active?.blur?.();
  });
  await expect(page.locator('[data-full-player-overlay]')).toContainText(/Tokyo FM|Mock Song/);
  await waitForStableMetrics(page, '[data-full-player-overlay]');
  const overlayShot = await page.locator('[data-full-player-overlay]').screenshot({
    animations: 'disabled'
  });
  expect(overlayShot).toMatchSnapshot('full-player-overlay.png');
});

// PR-6: the ≤720px player is a separate mobile-first stage (hero artwork,
// identity block, fixed transport, 4 labelled chips) — pin it at the canonical
// 360x780 Telegram-webview size so player regressions can't slip past unseen.
test('full player overlay mobile visual baseline', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page, {
    activeSection: 'search',
    trackHistory: [
      {
        id: 'track-visual-tokyo',
        stationId: 'uuid-tokyo',
        stationName: 'Tokyo FM',
        track: 'Mock Song',
        timestamp: Date.UTC(2026, 3, 20, 10, 0, 0)
      }
    ]
  });
  await page.goto('/?api=/api');
  await page.locator('#search-hero-input').first().fill('Tokyo');
  await expect(page.locator('[data-search-station-card]').first()).toBeVisible();
  await page.getByRole('button', { name: /Играть выдачу|Play results/ }).click();
  await expect(page.locator('.player-dock-bar')).toBeVisible();
  await page.locator('.player-dock-artwork-trigger').evaluate((node) => {
    (node as HTMLButtonElement).click();
  });
  await expect(page.locator('[data-full-player-overlay]')).toBeVisible();
  await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    active?.blur?.();
  });
  await expect(page.locator('[data-full-player-overlay] h1')).toContainText(/Tokyo FM/);
  await waitForStableMetrics(page, '[data-full-player-overlay]');
  const mobileShot = await page.locator('[data-full-player-overlay]').screenshot({
    animations: 'disabled'
  });
  expect(mobileShot).toMatchSnapshot('full-player-overlay-mobile.png');

  // The queue bottom-sheet is the other new PR-6 surface (a sibling of the
  // overlay root, so this is a full-page shot) — pin it too.
  await page.getByRole('button', { name: /^(Очередь|Queue)$/ }).first().click();
  await expect(page.locator('[data-full-player-queue]')).toBeVisible();
  const sheetShot = await page.screenshot({ animations: 'disabled' });
  expect(sheetShot).toMatchSnapshot('full-player-queue-sheet-mobile.png');
});

// Globe mobile rebuild: pin the new chrome (full-width now-bar, right-centred
// zoom stack, details sheet) at the canonical 360x780. The full-bleed MapLibre
// canvas is HIDDEN for the shot (its tiles/projection are not deterministic
// across runs, and masking it would cover the whole frame) — what remains is
// the fixed ::before gradient plus exactly the overlay chrome this PR owns.
test('globe mobile visual baseline (now-bar + details sheet)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page, { activeSection: 'search' });
  await page.goto('/?api=/api');
  await page.locator('#search-hero-input').first().fill('Tokyo');
  await expect(page.locator('[data-search-station-card]').first()).toBeVisible();
  await page.getByRole('button', { name: /Играть выдачу|Play results/ }).click();
  await expect(page.locator('.player-dock-bar')).toBeVisible();

  await page.locator('.app-navigation-mobile').getByRole('button', { name: /Глобус|Globe/ }).click();
  await expect(page.locator('.globe canvas')).toBeVisible();
  const nowBar = page.locator('[data-globe-now-bar]');
  await expect(nowBar).toBeVisible();
  await page.addStyleTag({
    content: '.screen-globe-v3 .globe canvas { visibility: hidden !important; }'
  });
  await page.waitForTimeout(450);

  const stageShot = await page.screenshot({ animations: 'disabled' });
  expect(stageShot).toMatchSnapshot('globe-mobile-now-bar.png');

  await nowBar.click();
  await expect(page.locator('[data-globe-sheet]')).toBeVisible();
  const sheetShot = await page.screenshot({
    animations: 'disabled',
    // The readout carries the live ≈local-time — mask it or the baseline
    // changes every minute.
    mask: [page.locator('.globe-sheet-readout')]
  });
  expect(sheetShot).toMatchSnapshot('globe-mobile-sheet.png');
});
