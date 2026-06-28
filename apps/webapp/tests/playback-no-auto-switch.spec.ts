import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

// Owner decision: the radio NEVER auto-switches the station. On a runtime
// failure it reconnects the SAME station (useAudioPlayer.scheduleReconnect) and,
// once that gives up, shows "unavailable" and waits for a manual choice — it
// must not advance the queue or jump to a random station. These e2e tests pin
// that contract end-to-end through the real RadioContext.

// Records every mediaSession.setActionHandler(action, handler) call so the test
// can assert which transport actions are bound vs explicitly cleared (null).
const installMediaSessionProbe = async (page: Page) => {
  await page.addInitScript(() => {
    const log: Array<{ action: string; bound: boolean }> = [];
    (window as unknown as { __msLog: typeof log }).__msLog = log;
    const ms = navigator.mediaSession as MediaSession | undefined;
    if (ms && typeof ms.setActionHandler === 'function') {
      const orig = ms.setActionHandler.bind(ms);
      ms.setActionHandler = ((action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
        log.push({ action, bound: Boolean(handler) });
        try {
          return orig(action, handler);
        } catch {
          // Some engines reject unsupported actions (e.g. 'stop'); the probe
          // still recorded the intent, which is what we assert on.
          return undefined;
        }
      }) as MediaSession['setActionHandler'];
    }
  });
};

// Replaces the media mock's play() with one that ALSO records the src of every
// element that reaches the 'playing' state, so we can count how many DISTINCT
// fixture stations were actually started.
const installPlayProbe = async (page: Page) => {
  await page.addInitScript(() => {
    (window as unknown as { __playSrcs: string[] }).__playSrcs = [];
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      (window as unknown as { __playSrcs: string[] }).__playSrcs.push(
        this.src || this.currentSrc || ''
      );
      this.setAttribute('data-ra-state', 'playing');
      this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    };
  });
};

const lastHandlerFor = (page: Page, action: string) =>
  page.evaluate((act) => {
    const log = (window as unknown as { __msLog: Array<{ action: string; bound: boolean }> }).__msLog;
    const entry = [...log].reverse().find((item) => item.action === act);
    return entry ? entry.bound : null;
  }, action);

const STATION_SLUGS = stations.map((s) => s.url_resolved.split('/').pop() as string);

// Distinct fixture stations (by url slug) that ever reached 'playing'.
const distinctPlayedStations = (page: Page) =>
  page.evaluate((slugs) => {
    const srcs = (window as unknown as { __playSrcs: string[] }).__playSrcs;
    return slugs.filter((slug) => srcs.some((src) => src.includes(slug))).length;
  }, STATION_SLUGS);

const queueLength = (page: Page) =>
  page.evaluate(() => {
    try {
      const raw = window.localStorage.getItem('radio:player:v2');
      return raw ? JSON.parse(raw)?.queue?.items?.length ?? 0 : 0;
    } catch {
      return 0;
    }
  });

const queueCurrentIndex = (page: Page) =>
  page.evaluate(() => {
    try {
      const raw = window.localStorage.getItem('radio:player:v2');
      return raw ? JSON.parse(raw)?.queue?.currentIndex ?? -1 : -1;
    } catch {
      return -1;
    }
  });

const openSearch = async (page: Page) => {
  const mobileSearchNav = page
    .locator('.app-navigation-mobile')
    .getByRole('button', { name: /Поиск|Search/ });
  if (await mobileSearchNav.isVisible().catch(() => false)) {
    await mobileSearchNav.click();
  } else {
    await page.locator('.nav-rail-item').filter({ hasText: /Поиск|Search/ }).first().click();
  }
  await page.locator('#search-hero-input').first().fill('a');
  await expect(page.locator('.station-row').first()).toBeVisible();
};

const startSearchResultsRadio = async (page: Page) => {
  await openSearch(page);
  await page.getByRole('button', { name: /Играть выдачу|Play results/ }).click();
  await expect(page.locator('.player-dock-bar')).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await page.setViewportSize({ width: 390, height: 844 });
});

test('FIX 2a: mediaSession next/prev are unbound for a single-item queue, bound for a multi-item queue', async ({
  page
}) => {
  await installMediaSessionProbe(page);
  // The transport-handler effect registers at mount from the queue length, so a
  // seeded single-item queue exercises the lone-station branch directly.
  await seedRadioState(page, { queue: [stations[0]] });
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible();

  await expect.poll(() => lastHandlerFor(page, 'nexttrack')).toBe(false);
  expect(await lastHandlerFor(page, 'previoustrack')).toBe(false);
  // play/pause/stop are always exposed.
  expect(await lastHandlerFor(page, 'play')).toBe(true);
  expect(await lastHandlerFor(page, 'pause')).toBe(true);
  expect(await lastHandlerFor(page, 'stop')).toBe(true);

  // A multi-item queue (search results) binds next/prev.
  await startSearchResultsRadio(page);
  await expect.poll(() => queueLength(page)).toBeGreaterThan(1);
  await expect.poll(() => lastHandlerFor(page, 'nexttrack')).toBe(true);
  expect(await lastHandlerFor(page, 'previoustrack')).toBe(true);
  expect(await lastHandlerFor(page, 'play')).toBe(true);
  expect(await lastHandlerFor(page, 'stop')).toBe(true);
});

test('FIX 2b: exhausting the queue with manual next never jumps to a random station', async ({
  page
}) => {
  await installPlayProbe(page);
  await seedRadioState(page);
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible();

  await startSearchResultsRadio(page);
  await expect.poll(() => queueLength(page)).toBeGreaterThan(1);
  const total = await queueLength(page);

  // Walk past the end of the queue with the manual dock "next". Each in-range
  // next advances one item; once the end is reached, next must be a no-op +
  // toast — NOT a jump into the global pool (the removed random fallback would
  // have appended an extra, out-of-sequence play here).
  for (let i = 0; i < total + 2; i += 1) {
    await page.locator('.dock-next-btn').click();
    await page.waitForTimeout(80);
  }

  // No more distinct stations were started than the queue actually holds: the
  // player never reached for a station outside the queue.
  expect(await distinctPlayedStations(page)).toBeLessThanOrEqual(total);
  // The end-of-queue next surfaces the "nothing playable" notice.
  await expect(page.locator('.toast')).toBeVisible();
});

test('FIX 1: a runtime stream death does not advance the queue or switch stations', async ({
  page
}) => {
  await installPlayProbe(page);
  await seedRadioState(page);
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible();

  // A multi-item queue, first station playing.
  await startSearchResultsRadio(page);
  await expect.poll(() => queueLength(page)).toBeGreaterThan(1);
  expect(await distinctPlayedStations(page)).toBe(1);
  const indexBefore = await queueCurrentIndex(page);

  // Kill the live stream at runtime (the element was already 'playing'). With
  // the old code the failure effect would auto-advance to the next queue item;
  // now it must NOT — the same station stays selected (reconnect re-targets it),
  // and the player is left in its `error` state for the user to choose from.
  await page.evaluate(() => {
    document.querySelectorAll('audio').forEach((audio) => {
      audio.dispatchEvent(new Event('error'));
    });
  });
  await page.waitForTimeout(900);

  // No SECOND distinct station was ever started...
  expect(await distinctPlayedStations(page)).toBe(1);
  // ...and the queue cursor never advanced off the failed station.
  expect(await queueCurrentIndex(page)).toBe(indexBefore);
  // The user is told the stream is unavailable (not silently skipped).
  await expect(page.locator('.toast')).toContainText(/недоступ|unavailable/i);
});

test('FEED #86: opening «Лента» while a station plays does NOT switch it; a deliberate swipe does', async ({
  page
}) => {
  // The Discovery Feed autoplays the card you LAND on — but OPENING the feed is
  // not a swipe, so mounting it while a station is playing must NOT switch the
  // persistent player (the kickstart seeds the opening card as already-played).
  // The first play must come only from a deliberate swipe to a DIFFERENT card.
  await installPlayProbe(page);
  await seedRadioState(page);
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible();

  // A station is playing (first search result).
  await startSearchResultsRadio(page);
  await expect.poll(() => distinctPlayedStations(page)).toBe(1);

  // Open «Лента». Mounting it is NOT a swipe → ZERO new plays past the settle.
  await page.locator('.app-navigation-mobile').getByRole('button', { name: /Лента|Feed/ }).click();
  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  await expect(page.locator('.station-feed-card-name').first()).toBeVisible();
  await page.waitForTimeout(700); // well past the 220ms settle window
  expect(await distinctPlayedStations(page)).toBe(1); // never auto-switched on open

  // A DELIBERATE swipe to the next card DOES play (autoplay-on-landing).
  await page.locator('.station-feed-scroller').evaluate((el) => {
    el.scrollTop += el.clientHeight;
  });
  await expect.poll(() => distinctPlayedStations(page), { timeout: 4000 }).toBeGreaterThanOrEqual(2);
});
