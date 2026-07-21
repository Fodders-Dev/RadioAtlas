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

const currentQueueStationId = (page: Page) =>
  page.evaluate(() => {
    try {
      const raw = window.localStorage.getItem('radio:player:v2');
      if (!raw) return null;
      const queue = JSON.parse(raw)?.queue;
      return queue?.items?.[queue?.currentIndex]?.stationuuid ?? null;
    } catch {
      return null;
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
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

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
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

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
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

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
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

  // A station is playing (first search result).
  await startSearchResultsRadio(page);
  await expect.poll(() => distinctPlayedStations(page)).toBe(1);
  await expect.poll(() => currentQueueStationId(page)).not.toBeNull();
  const stationBeforeFeed = await currentQueueStationId(page);
  expect(stationBeforeFeed).toBeTruthy();

  // Open «Лента» from its Home entry (it's not in the bottom dock). Mounting it
  // is NOT a swipe → ZERO new plays past the settle.
  await page.locator('.app-navigation-mobile').getByRole('button', { name: /Главная|Home/ }).click();
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

  // The hero must ALREADY be showing the on-air station (owner ask #1) — that is
  // what makes the pin below meaningful.
  await expect(page.locator('[data-home-hero]')).toHaveAttribute(
    'data-home-hero-mode',
    'now-playing'
  );
  await expect(page.locator('[data-home-hero]')).toHaveAttribute(
    'data-home-hero',
    stationBeforeFeed as string
  );

  await page.locator('[data-home-feed-entry]').click();
  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  await expect(page.locator('.station-feed-card-name').first()).toBeVisible();

  // The hero IS feed card 0 (owner ask #2): the expanded feed opens ON the same
  // station the hero was showing, not on some other pick. This is a real #86
  // hazard as well as a UX contract — the pin makes resolveFeedEntry's
  // findIndex-hit branch live in production for the first time, and if the pin
  // were ever silently dropped, seedPlayed would seed the WRONG card and the
  // observer's first fire would switch the player on a passive open.
  await expect(page.locator('.station-feed-card[data-feed-index="0"]')).toHaveAttribute(
    'data-feed-station',
    stationBeforeFeed as string
  );

  await page.waitForTimeout(700); // well past the 220ms settle window
  expect(await currentQueueStationId(page)).toBe(stationBeforeFeed); // never auto-switched on open

  // A DELIBERATE swipe to a different card DOES play (autoplay-on-landing).
  // Resolve the active snap point first: the feed can open on the currently
  // playing station at any index, including the end of a personalised mix.
  const scroller = page.locator('.station-feed-scroller');
  const cards = scroller.locator('.station-feed-card');
  const activeCard = cards.filter({ has: page.locator('[data-feed-playback-action]') });
  await expect(activeCard).toHaveCount(1);
  const activeIndex = Number(await activeCard.getAttribute('data-feed-index'));
  const cardCount = await cards.count();
  const targetIndex = activeIndex < cardCount - 1 ? activeIndex + 1 : activeIndex - 1;
  const scrollDistance = await scroller.evaluate((element) => element.clientHeight);
  await scroller.hover();
  await page.mouse.wheel(0, targetIndex > activeIndex ? scrollDistance : -scrollDistance);
  await expect
    .poll(() =>
      scroller.evaluate((element) =>
        Math.round(element.scrollTop / Math.max(element.clientHeight, 1))
      )
    )
    .toBe(targetIndex);
  await expect
    .poll(() => currentQueueStationId(page), { timeout: 4000 })
    .not.toBe(stationBeforeFeed);
});

// Drag the Home hero downward until it commits, i.e. the gesture the owner
// actually asked for. This is a SECOND route into resolveFeedEntry / the
// kickstart and would otherwise be entirely uncovered — the click test above
// cannot catch a gesture path that pins the wrong station (or no station).
const pullHeroDown = async (page: Page, distance = 190) => {
  const hero = page.locator('[data-home-hero]');
  await expect(hero).toBeVisible();
  const box = await hero.boundingBox();
  if (!box) throw new Error('hero has no box');
  // Start in the copy area (title / location / tags): inside the hero, but not
  // on the refresh chip, the favourite button or the play button — a pointerdown
  // that lands on a control is deliberately ignored by the gesture.
  const startX = box.x + box.width * 0.3;
  // NOT `box.y + 60`. On Home at <=959px the glass topbar is lifted out of flow
  // and floated OVER the hero, so it owns the hero's top ~66px; a pointerdown
  // there targets the <header>, `inPullZone()` is false, and the gesture never
  // starts. This spec only ever passed when boundingBox() happened to be
  // sampled mid `motion-rise` (translateY(16px)), which pushed the point far
  // enough down — i.e. it was racing a 480ms entry animation, and lost 6 times
  // out of 8.
  const startY = box.y + box.height * 0.55;
  // Fail LOUDLY if anything ever covers the grab point again, instead of
  // degrading into an intermittent timeout that reads like a product bug.
  const occluder = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x as number, y as number);
      return el && el.closest('.home-hero-card')
        ? null
        : `${el?.tagName}.${String(el?.className ?? '').slice(0, 40)}`;
    },
    [startX, startY]
  );
  expect(occluder, 'hero grab point is occluded — the pull can never start there').toBeNull();
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Several intermediate moves: the tracker needs a real trail (dead zone →
  // engage → commit) and samples velocity from it.
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(startX, startY + (distance * step) / 8);
  }
  await page.mouse.up();
};

test('FEED #86 (gesture): pulling the hero down opens «Лента» on the playing card without switching it', async ({
  page
}) => {
  await installPlayProbe(page);
  await seedRadioState(page);
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

  await startSearchResultsRadio(page);
  await expect.poll(() => distinctPlayedStations(page)).toBe(1);
  await expect.poll(() => currentQueueStationId(page)).not.toBeNull();
  const stationBeforeFeed = await currentQueueStationId(page);
  expect(stationBeforeFeed).toBeTruthy();
  const playsBeforeFeed = await distinctPlayedStations(page);
  const indexBeforeFeed = await queueCurrentIndex(page);

  await page.locator('.app-navigation-mobile').getByRole('button', { name: /Главная|Home/ }).click();
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();
  // The gesture only arms at the top of the page — make that explicit.
  await page.evaluate(() => window.scrollTo(0, 0));

  await pullHeroDown(page);

  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  await expect(page.locator('.station-feed-card-name').first()).toBeVisible();
  // Same two contracts as the click path: opens ON the hero's station, and
  // expanding is not a swipe, so nothing may be played or switched.
  await expect(page.locator('.station-feed-card[data-feed-index="0"]')).toHaveAttribute(
    'data-feed-station',
    stationBeforeFeed as string
  );
  await page.waitForTimeout(700); // past the 220ms settle window
  expect(await currentQueueStationId(page)).toBe(stationBeforeFeed);
  expect(await queueCurrentIndex(page)).toBe(indexBeforeFeed);
  expect(await distinctPlayedStations(page)).toBe(playsBeforeFeed);
});

test('MOUSE: dragging the grabber handle opens «Лента» (Telegram Desktop path)', async ({
  page
}) => {
  // The hero body is covered by the gesture test above; this pins the OTHER
  // half of the same fix — the grabber is a <button>, and the pull deliberately
  // exempts it from the "starts on a control" bail so the thing that says
  // «Потяни вниз» can actually be pulled. Mouse-specific because that path has
  // its own pointerType gate and window-level move/up listeners.
  await seedRadioState(page);
  await page.goto('/?api=/api');
  const grip = page.locator('[data-home-feed-entry]');
  await expect(grip).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));

  const box = await grip.boundingBox();
  if (!box) throw new Error('feed entry has no box');
  const x = box.x + box.width * 0.5;
  const y = box.y + box.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(x, y + (190 * step) / 8);
  }
  await page.mouse.up();

  await expect(page.locator('.station-feed-overlay')).toBeVisible();
});

test('the hero pull does NOT fire on a normal downward scroll or an upward flick back to the top', async ({
  page
}) => {
  // Constraint E, the failure mode that would make Home feel broken. Both of
  // these are ordinary scrolling and must leave Home exactly where it is.
  await seedRadioState(page);
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

  const hero = page.locator('[data-home-hero]');
  const box = await hero.boundingBox();
  if (!box) throw new Error('hero has no box');

  // 1. A drag that goes UP is a page scroll, never a pull.
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.6);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.6 - step * 30);
  }
  await page.mouse.up();
  await expect(page.locator('.station-feed-overlay')).toHaveCount(0);

  // 2. Wheel-scroll to the bottom of Home, then flick back up past the top —
  //    the inertia tail arrives at scrollY 0 with negative deltaY. Its sequence
  //    began mid-page, so it must be ignored wholesale.
  await hero.hover();
  await page.mouse.wheel(0, 1200);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  for (let i = 0; i < 12; i += 1) {
    await page.mouse.wheel(0, -160);
  }
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.waitForTimeout(400);
  await expect(page.locator('.station-feed-overlay')).toHaveCount(0);
  // Home is still the active screen and still scrollable.
  await expect(page.locator('.screen-home-next')).toBeVisible();
});

// ---------------------------------------------------------------------------
// TOUCH. Everything above drives page.mouse, which the compositor never steals,
// so it is structurally incapable of catching the failure that made this feature
// dead on a phone: Chromium fires `pointercancel` ~16px into any vertical touch
// drag, whether or not the page can scroll that way. A passive pointer observer
// therefore never reaches the commit threshold on a touchscreen while passing
// every mouse test. These run the REAL touch pipeline (CDP Input.dispatchTouchEvent
// against a hasTouch context) so that regression cannot come back green.
// ---------------------------------------------------------------------------
test.describe('hero pull on a touchscreen', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  const touchDrag = async (
    page: Page,
    from: { x: number; y: number },
    dy: number,
    steps = 14
  ) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: from.x, y: from.y }]
    });
    for (let step = 1; step <= steps; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: from.x, y: from.y + (dy * step) / steps }]
      });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  };

  const centreOf = async (page: Page, selector: string) => {
    const box = await page.locator(selector).boundingBox();
    if (!box) throw new Error(`${selector} has no box`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  // A deterministic catalogue (mockStations) plus favourites, then an EXPLICIT
  // wait for the hero. Without the mock these tests only found a hero when an
  // earlier test in the file had already warmed the real dev catalogue — they
  // passed by suite ordering and rendered a bare skeleton in isolation, which is
  // exactly the shape of a test that proves nothing.
  const openTouchHome = async (page: Page) => {
    await installPlayProbe(page);
    await installMediaMocks(page);
    await mockStations(page);
    await seedRadioState(page, { favorites: stations.slice(0, 4) });
    await page.goto('/?api=/api');
    await expect(page.locator('[data-home-feed-entry]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-home-hero]')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => window.scrollY === 0);
  };

  test('a downward TOUCH drag on the hero opens «Лента» (the owner ask, on a phone)', async ({
    page
  }) => {
    await openTouchHome(page);

    await touchDrag(page, await centreOf(page, '[data-home-hero]'), 190);

    await expect(page.locator('.station-feed-overlay')).toBeVisible();
  });

  test('the grabber handle is itself draggable — the element that says «Потяни вниз»', async ({
    page
  }) => {
    // The affordance and the drag target were once different elements: the grip
    // lived in a sibling of the hero and received no handlers at all, so the one
    // thing that looked like a handle was the one thing that could not be pulled
    // (and a drag off a button fires no click either, so it did nothing at all).
    await openTouchHome(page);

    await touchDrag(page, await centreOf(page, '[data-home-feed-entry]'), 190);

    await expect(page.locator('.station-feed-overlay')).toBeVisible();
  });

  test('a TOUCH drag still scrolls Home normally in both directions (constraint E)', async ({
    page
  }) => {
    await openTouchHome(page);

    // UP on the hero at page top = an ordinary scroll down. Never a pull.
    const hero = await centreOf(page, '[data-home-hero]');
    await touchDrag(page, hero, -200);
    await expect(page.locator('.station-feed-overlay')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    // DOWN while scrolled = an ordinary scroll back up. Still never a pull: the
    // gesture is refused at touchstart unless the page is already at the top.
    await touchDrag(page, { x: 195, y: 300 }, 200);
    await expect(page.locator('.station-feed-overlay')).toHaveCount(0);
  });

  test('a tap on the grabber still opens the feed (a tap is not a pull)', async ({ page }) => {
    await openTouchHome(page);

    // The pull exempts `.home-feed-entry` from the "starts on a control" bail so
    // the handle can be dragged; that must not cost the button its tap.
    await page.locator('[data-home-feed-entry]').tap();
    await expect(page.locator('.station-feed-overlay')).toBeVisible();
  });
});

test('wheeling up at the top of Home never opens the feed or starts audio', async ({ page }) => {
  // The wheel path is GONE (see heroPullExpand.ts). It used to commit at 260px —
  // three ordinary wheel notches — for any sequence that merely began at scrollY
  // 0, so "I am at the top of Home and I keep wheeling up" opened a fullscreen
  // surface, and on an idle player resolveFeedEntry's autoplayInitial branch
  // started audio out of nowhere. Both patterns that reproduced it are pinned
  // here: a cold wheel-up at rest, and the flick-to-top-pause-flick-again beat.
  await installPlayProbe(page);
  await seedRadioState(page);
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();
  await page.setViewportSize({ width: 515, height: 800 }); // the owner's Telegram Desktop window

  await page.locator('[data-home-hero]').hover();
  await page.evaluate(() => window.scrollTo(0, 0));
  for (let i = 0; i < 6; i += 1) {
    await page.mouse.wheel(0, -120);
  }
  await expect(page.locator('.station-feed-overlay')).toHaveCount(0);
  expect(await distinctPlayedStations(page)).toBe(0);

  // Scroll down, flick back to the top, take a human beat, then keep wheeling up.
  await page.mouse.wheel(0, 1200);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  for (let i = 0; i < 12; i += 1) {
    await page.mouse.wheel(0, -160);
  }
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.waitForTimeout(600);
  for (let i = 0; i < 4; i += 1) {
    await page.mouse.wheel(0, -160);
  }
  await expect(page.locator('.station-feed-overlay')).toHaveCount(0);
  expect(await distinctPlayedStations(page)).toBe(0);
});
