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
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible({ timeout: 15_000 });
  // (No dock wait here: with nothing playing the dormant dock renders nothing,
  // and the feed-entry assertion above is already the load anchor. Do NOT use
  // .app-navigation-mobile — it is display:none at >=960, where these suites run.)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(180);
  await waitForStableMetrics(page);
};

const readHomeSurfaceSignature = async (page: Page) =>
  page.evaluate(() => ({
    feedEntry: Boolean(document.querySelector('[data-home-feed-entry]')),
    // The RENDERED hero — it follows playback by design now (owner ask #1).
    hero: document.querySelector('[data-home-hero]')?.getAttribute('data-home-hero') || null,
    // 'recommendation' | 'now-playing'.
    heroMode: document.querySelector('[data-home-hero]')?.getAttribute('data-home-hero-mode') || null,
    // The FROZEN recommendation behind the override — this is the id the
    // rank-freeze invariant actually lives on.
    heroRecommended:
      document.querySelector('[data-home-hero]')?.getAttribute('data-home-hero-recommended') || null,
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
  // The full Home shell is the subject here. A listener with no history gets the
  // first-run screen instead (hero + top-voted shelf), so seed one play.
  await openHome(page, { playbackHistory: [stations[0]] });
  const screenshot = await page.screenshot({
    animations: 'disabled',
    // The hero now carries the station's LOCAL TIME, which ticks in real time —
    // the one part of this surface that can never match a stored baseline.
    // Masked rather than frozen: page.clock.setFixedTime stalls the queue step
    // further down this suite (learned the hard way in #234).
    mask: [page.locator('.home-hero-clock')],
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
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();
  // Shell chrome still renders without the SDK. This suite runs at 1440, so the
  // desktop rail is the visible navigation (.app-navigation-mobile is
  // display:none there), and the dock is absent by design while nothing plays.
  await expect(page.locator('.nav-rail-item').first()).toBeVisible();
});

test('home shell mobile visual baseline', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // The full Home shell is the subject here. A listener with no history gets the
  // first-run screen instead (hero + top-voted shelf), so seed one play.
  await openHome(page, { playbackHistory: [stations[0]] });
  await expect(page).toHaveScreenshot('home-shell-mobile.png', {
    animations: 'disabled',
    fullPage: true,
    // The hero now carries the station's LOCAL TIME, which ticks in real time —
    // the one part of this surface that can never match a stored baseline.
    // Masked rather than frozen: page.clock.setFixedTime stalls the queue step
    // further down this suite (learned the hard way in #234).
    mask: [page.locator('.home-hero-clock')],
  });
});

test('home shell compact-wide visual baseline', async ({ page }) => {
  await page.setViewportSize({ width: 540, height: 900 });
  // The full Home shell is the subject here. A listener with no history gets the
  // first-run screen instead (hero + top-voted shelf), so seed one play.
  await openHome(page, { playbackHistory: [stations[0]] });
  await expect(page).toHaveScreenshot('home-shell-compact-wide.png', {
    animations: 'disabled',
    fullPage: true,
    // The hero now carries the station's LOCAL TIME, which ticks in real time —
    // the one part of this surface that can never match a stored baseline.
    // Masked rather than frozen: page.clock.setFixedTime stalls the queue step
    // further down this suite (learned the hard way in #234).
    mask: [page.locator('.home-hero-clock')],
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
    // The hero now carries the station's LOCAL TIME, which ticks in real time —
    // the one part of this surface that can never match a stored baseline.
    // Masked rather than frozen: page.clock.setFixedTime stalls the queue step
    // further down this suite (learned the hard way in #234).
    mask: [page.locator('.home-hero-clock')],
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

test('home surface stays stable during play actions', async ({ page }) => {
  // The full Home shell is the subject here. A listener with no history gets the
  // first-run screen instead (hero + top-voted shelf), so seed one play.
  await openHome(page, { playbackHistory: [stations[0]] });
  const before = await readHomeSurfaceSignature(page);

  // Cards no longer render a like button; a normal rail play must not reshape
  // the discovery surface.
  const playedTile = page.locator('[data-home-rail] [data-home-station]').first();
  const playedStationId = await playedTile.getAttribute('data-home-station');
  expect(playedStationId).toBeTruthy();
  await playedTile.locator('.home-station-primary-action').click();
  await expect(page.locator('[data-home-resume]')).toBeVisible();

  const after = await readHomeSurfaceSignature(page);
  // Rail composition stays the same after a normal rail play; the discovery
  // surface should keep its shape and never drop a rail or swap the Feed entry
  // while playback state updates.
  expect(after.feedEntry).toBe(before.feedEntry);
  expect(after.rails.map((rail) => rail.id)).toEqual(before.rails.map((rail) => rail.id));

  // The RENDERED hero deliberately follows playback now (owner ask #1: «Рекомендуем»
  // becomes «Сейчас играет»), so `after.hero === before.hero` is false BY DESIGN
  // and is no longer the invariant to assert. The invariant this test actually
  // guards — the recommendation deck must not advance under the user's finger
  // (Home.tsx's keepHero clause + the surfaceFeedBase memo that deliberately
  // excludes player.current) — now lives on the frozen id, which stays observable
  // while the on-air override is rendered.
  expect(before.heroMode).toBe('recommendation');
  expect(after.heroMode).toBe('now-playing');
  expect(after.heroRecommended).toBe(before.heroRecommended);
  // Pinned to the station we actually played rather than merely "not the
  // recommendation": the weaker form would fail for an unrelated reason the day
  // the ranking happens to surface the played station as the recommendation.
  expect(after.hero).toBe(playedStationId);
});

test('home refresh rebuilds the discovery surface', async ({ page }) => {
  await openHome(page);
  const before = JSON.stringify(await readHomeSurfaceSignature(page));
  await page.locator('.home-surface-refresh').click();
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
  await page.locator('.nav-rail-item').filter({ hasText: 'Моё' }).first().click();
  await expect(page).toHaveScreenshot('library-screen.png', {
    animations: 'disabled',
    fullPage: true
  });
});

test('settings sheet mobile visual baseline', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page);
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();
  await page.locator('.mobile-settings-trigger').click();

  const sheet = page.locator('.settings-sheet');
  await expect(sheet).toBeVisible();
  await expect(page.locator('[data-dialog-initial-focus]')).toBeFocused();
  await waitForStableMetrics(page, '.settings-sheet-card');
  const shot = await page.screenshot({ animations: 'disabled' });
  expect(shot).toMatchSnapshot('settings-sheet-mobile.png', { maxDiffPixelRatio: 0.04 });

  const clearCache = page.getByRole('button', { name: /Очистить кэш|Clear cache/ });
  await clearCache.scrollIntoViewIfNeeded();
  await clearCache.click();
  const confirmation = page.getByText(/Очистить кэш каталога|Clear the catalog and globe cache/i);
  await expect(confirmation).toBeVisible();
  await confirmation.scrollIntoViewIfNeeded();
  const confirmationShot = await page.screenshot({ animations: 'disabled' });
  expect(confirmationShot).toMatchSnapshot('settings-data-confirmation-mobile.png', {
    maxDiffPixelRatio: 0.04
  });

  await page.getByRole('button', { name: /Отмена|Cancel/ }).click();
  const developerSection = page.locator('details.settings-developer-section');
  await developerSection.locator('summary').scrollIntoViewIfNeeded();
  await developerSection.locator('summary').click();
  await expect(developerSection).toHaveAttribute('open', '');
  const developerShot = await page.screenshot({ animations: 'disabled' });
  expect(developerShot).toMatchSnapshot('settings-developer-mobile.png', {
    maxDiffPixelRatio: 0.04
  });
});

// The «compact live dock» baseline is gone with the surface it covered: the
// «Свернуть» button was removed (owner: «какой смысл в кнопке свернуть???») and
// every play snapped the presentation back to the bar anyway, so the compact
// dock was unreachable. A baseline for a surface nobody can open is worse than
// no baseline — it looks like coverage and proves nothing.

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
    animations: 'disabled',
    // The station's local time ticks in real time — the only part of this
    // surface that cannot match a stored baseline. Mask it rather than freezing
    // Date globally, which stalls the queue sheet further down this test.
    mask: [page.locator('.full-player-clock')]
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
    animations: 'disabled',
    // The station's local time ticks in real time — the only part of this
    // surface that cannot match a stored baseline. Mask it rather than freezing
    // Date globally, which stalls the queue sheet further down this test.
    mask: [page.locator('.full-player-clock')]
  });
  expect(mobileShot).toMatchSnapshot('full-player-overlay-mobile.png');

  // The queue bottom-sheet is the other new PR-6 surface (a sibling of the
  // overlay root, so this is a full-page shot) — pin it too. The pill is
  // addressed by role/name since #237 renamed it «Очередь» / "Queue" to match
  // what it actually does (it OPENS the queue; it never added to it).
  await page
    .locator('[data-full-player-overlay]')
    .getByRole('button', { name: /^(Очередь|Queue)$/ })
    .first()
    .click();
  await expect(page.locator('[data-full-player-queue]')).toBeVisible();
  const sheetShot = await page.screenshot({
    animations: 'disabled',
    mask: [page.locator('.full-player-clock')]
  });
  expect(sheetShot).toMatchSnapshot('full-player-queue-sheet-mobile.png');
});

// Globe mobile rebuild: pin the selection-only chrome and single global dock
// at the canonical 360x780. The full-bleed MapLibre
// canvas is HIDDEN for the shot (its tiles/projection are not deterministic
// across runs, and masking it would cover the whole frame) — what remains is
// the fixed ::before gradient plus exactly the overlay chrome this PR owns.
test('globe mobile visual baseline (single global dock)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page, { activeSection: 'search' });
  await page.goto('/?api=/api');
  await page.locator('#search-hero-input').first().fill('Tokyo');
  await expect(page.locator('[data-search-station-card]').first()).toBeVisible();
  await page.getByRole('button', { name: /Играть выдачу|Play results/ }).click();
  await expect(page.locator('.player-dock-bar')).toBeVisible();
  // This shot used to collapse the dock first; «Свернуть» is gone, so it just
  // frames the normal bar. Freeze the artwork's reactive glow either way.
  await page.addStyleTag({
    content: '.player-dock-artwork-trigger { --ra-energy: 0 !important; }'
  });

  await page.locator('.app-navigation-mobile').getByRole('button', { name: /Глобус|Globe/ }).click();
  await expect(page.locator('.globe canvas')).toBeVisible();
  await expect(page.locator('[data-globe-selection-preview]')).toHaveCount(0);
  // The reticle pulse is JS-driven (masking it flakes too — its bbox breathes
  // with the pulse), so hide it alongside the canvas for the shot.
  await page.addStyleTag({
    content:
      '.screen-globe-v3 .globe canvas, .screen-globe-v3 .globe-reticle { visibility: hidden !important; }'
  });
  await page.waitForTimeout(450);

  const stageShot = await page.screenshot({ animations: 'disabled' });
  expect(stageShot).toMatchSnapshot('globe-mobile-single-dock.png', {
    maxDiffPixelRatio: 0.04
  });
});

// Search mobile rebuild: pin the @360x780 result view (count|filters row,
// full-width play-all, compact cards) and the filters bottom sheet.
test('search mobile visual baseline (results + filters sheet)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page, { activeSection: 'search' });
  await page.goto('/?api=/api');
  await page.locator('#search-hero-input').first().fill('jpop');
  await expect(page.locator('[data-search-station-card]').first()).toBeVisible();
  await waitForStableMetrics(page, '.screen-search-v3');

  // The ratio absorbs sub-pixel text shifts under parallel-suite load (the
  // same class of noise home-shell tolerates via maxDiffPixels).
  const resultsShot = await page.screenshot({ animations: 'disabled' });
  expect(resultsShot).toMatchSnapshot('search-mobile-results.png', { maxDiffPixelRatio: 0.04 });

  await page.locator('.search-hero-filters-pill').click();
  await expect(page.locator('[data-search-filters-sheet]')).toBeVisible();
  const sheetShot = await page.screenshot({ animations: 'disabled' });
  expect(sheetShot).toMatchSnapshot('search-mobile-filters-sheet.png', {
    maxDiffPixelRatio: 0.04
  });
});

// Library mobile rebuild: pin the @360x780 queue tab (single column, the
// metric pills as one horizontal peek strip) and the single-column collections
// grid with the Play+«···» card actions.
test('library mobile visual baseline (queue + collections)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page, {
    activeSection: 'library',
    libraryTab: 'queue',
    stationCache: stations,
    queue: [stations[0], stations[1], stations[2]],
    recent: [stations[3]],
    trackHistory: [
      {
        id: 'visual-track-1',
        stationId: stations[3].stationuuid,
        stationName: stations[3].name,
        track: 'Visual Mock Song',
        timestamp: Date.UTC(2026, 4, 1, 9, 0, 0)
      }
    ],
    collections: [
      {
        id: 'collection-visual',
        name: 'Visual set',
        stationIds: stations.slice(0, 4).map((station) => station.stationuuid)
      }
    ]
  });
  await page.goto('/?api=/api');
  await expect(page.locator('.library-queue-now-card')).toBeVisible();
  await waitForStableMetrics(page, '.screen-library-v2');

  const queueShot = await page.screenshot({ animations: 'disabled' });
  expect(queueShot).toMatchSnapshot('library-mobile-queue.png', { maxDiffPixelRatio: 0.04 });

  await page.locator('.library-tab-chip').filter({ hasText: /Плейлисты|Playlists/ }).click();
  await expect(page.locator('.library-collection-card')).toBeVisible();
  await waitForStableMetrics(page, '.screen-library-v2');
  const collectionsShot = await page.screenshot({ animations: 'disabled' });
  expect(collectionsShot).toMatchSnapshot('library-mobile-collections.png', {
    maxDiffPixelRatio: 0.04
  });
});

// Phase 2 discovery feed: pin the @360x780 fullscreen card — station-backdrop
// stage, bottom identity block, right action rail (like · queue · open player).
// The landed card autoplays, so the active backdrop's --ra-energy glow is
// written per-frame from JS (animations:'disabled' can't freeze it) → the energy
// layer is hidden for the shot; the deterministic palette gradient + scrim +
// copy/controls remain. Pinned in BOTH themes — the stage is a dark immersive
// surface either way, so the light copy must stay AA in both.
test('discovery feed mobile visual baseline (card + actions)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page, { activeSection: 'feed' });
  await page.goto('/?api=/api');
  await expect(page.locator('.station-feed-card-name').first()).toBeVisible();
  // Opening the feed no longer auto-plays when a station is already current (the
  // #86 fix), so we pin the card chrome rather than waiting on a live pill (which
  // reflects playback state, not the render under test).
  // The waveform's bar heights are written from JS at 30Hz through --ra-level,
  // exactly like the backdrop's energy glow — animations:'disabled' cannot reach
  // either, so both are hidden for the shot. visibility:hidden rather than
  // display:none keeps every box in place, so the baseline still pins full
  // layout geometry.
  // The geo line needs no freezing: it is the fixture's stored coordinates and
  // nothing else. It used to carry a live wall clock as well — removed, because
  // it was solar time from the longitude rather than the station's real zone.
  const freezeStage = {
    content:
      '.station-backdrop-energy, .station-backdrop-image, .station-feed-wave { visibility: hidden !important; }'
  };
  await page.addStyleTag(freezeStage);
  // ⚠ waitForStableMetrics CANNOT see this one. It samples document scroll
  // dimensions and the target's bounding rect — and the target here is
  // `.station-feed-overlay`, which is `position: fixed; inset: 0` and therefore
  // has a CONSTANT rect from first paint. It is structurally blind to whether
  // the geo line has landed inside the card. That line needs the lazily-imported
  // geoResolver chunk (d3-geo + topojson + a ~107KB topology) to download, parse
  // and build its country index before a re-render adds it, so without an
  // explicit wait whichever side of the race won would become the committed
  // baseline. Every fixture station carries real coordinates, so the focused
  // card must end up with a geo line.
  await expect(
    page.locator('.station-feed-card-content[data-focus="true"] .station-feed-card-geo')
  ).toBeVisible();
  await waitForStableMetrics(page, '.station-feed-overlay');
  const darkShot = await page.screenshot({ animations: 'disabled' });
  expect(darkShot).toMatchSnapshot('station-feed-mobile.png', { maxDiffPixelRatio: 0.04 });

  // Light theme (pastel) — the dark stage and its light copy must still read AA.
  await page.evaluate(() =>
    window.localStorage.setItem('radio:theme-current:v1', JSON.stringify('pastel'))
  );
  await page.reload();
  await expect(page.locator('.station-feed-card-name').first()).toBeVisible();
  await page.addStyleTag(freezeStage);
  await expect(
    page.locator('.station-feed-card-content[data-focus="true"] .station-feed-card-geo')
  ).toBeVisible();
  await waitForStableMetrics(page, '.station-feed-overlay');
  const lightShot = await page.screenshot({ animations: 'disabled' });
  expect(lightShot).toMatchSnapshot('station-feed-mobile-light.png', { maxDiffPixelRatio: 0.04 });
});

// PR-4b fix round: pin the TOP of the studio sheet (current-theme hero + the
// preset list) in BOTH modes. The original PR shipped only dark builder-crop
// baselines and the Warm-Light/list breakage sailed through a green gate —
// theme-dependent regressions need a light-mode pin.
test('theme studio list mobile visual baseline (dark + warm light)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page);
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

  await page.locator('.mobile-settings-trigger').click();
  await page.getByRole('button', { name: /Open Theme Studio|Открыть Theme Studio/ }).click();
  await expect(page.locator('[data-theme-studio]')).toBeVisible();
  await waitForStableMetrics(page, '.settings-sheet-card--bottom');
  const darkShot = await page.screenshot({ animations: 'disabled' });
  expect(darkShot).toMatchSnapshot('theme-studio-list-mobile.png', { maxDiffPixelRatio: 0.04 });

  // Switch to Warm Light through the sheet itself (also pins the active-card
  // state), then rewind the card scroll the click may have caused.
  await page.locator('[data-theme-card="pastel"]').click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.themeMode || ''))
    .toBe('light');
  await page.locator('.settings-sheet-card--bottom').evaluate((node) => node.scrollTo(0, 0));
  await waitForStableMetrics(page, '.settings-sheet-card--bottom');
  const lightShot = await page.screenshot({ animations: 'disabled' });
  expect(lightShot).toMatchSnapshot('theme-studio-list-mobile-light.png', {
    maxDiffPixelRatio: 0.04
  });
});

// PR-4b: pin the @360x780 theme-editor bottom form (sticky preview + section
// nav + one-column fields + sticky save) and the gradient composer sub-sheet.
test('theme editor mobile visual baseline (form + gradient sheet)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page);
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

  await page.locator('.mobile-settings-trigger').click();
  await page.getByRole('button', { name: /Open Theme Studio|Открыть Theme Studio/ }).click();
  await expect(page.locator('[data-theme-studio]')).toBeVisible();
  // Scroll the builder form into view inside the bottom card (the bundled
  // theme grid sits above it).
  await page.locator('[data-theme-builder]').scrollIntoViewIfNeeded();
  await waitForStableMetrics(page, '.settings-sheet-card--bottom');
  const formShot = await page.screenshot({ animations: 'disabled' });
  expect(formShot).toMatchSnapshot('theme-editor-mobile-form.png', { maxDiffPixelRatio: 0.04 });

  await page.locator('[data-theme-builder-background-source]').selectOption('__custom__');
  await page.locator('.theme-builder-gradient-trigger').click();
  await expect(page.locator('[data-theme-builder-subsheet="gradient"]')).toBeVisible();
  const sheetShot = await page.screenshot({ animations: 'disabled' });
  expect(sheetShot).toMatchSnapshot('theme-editor-mobile-gradient-sheet.png', {
    maxDiffPixelRatio: 0.04
  });
});
