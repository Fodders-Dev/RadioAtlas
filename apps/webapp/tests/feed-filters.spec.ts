import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

// «Лента» filter chips.
//
// The reason this file exists is the #86 hazard in the LAST test below: tapping a
// chip rebuilds the deck, which changes visibleFeedStations' identity, which
// tears down and re-creates the IntersectionObserver — whose initial callback
// fires straight into the autoplay settler. At a non-zero scroll offset, index N
// in the NEW deck is a DIFFERENT station, so without the synchronous
// cancel/scroll-to-0/seedPlayed(0) sequence in handleSelectFilter a chip tap
// switches the persistent player with no swipe involved.
//
// Nothing else in the suite would catch that: it is invisible to the type system,
// stationFeed.test.ts and feedAutoplay.test.ts both stay green if it breaks, and
// playback-no-auto-switch.spec.ts never taps a chip.

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

// «Новое для тебя» is gated on the exposure ledger having something to exclude:
// with an empty ledger its predicate admits everything, so it would rebuild a
// byte-identical deck and the chip would visibly do nothing. Every test that
// expects the chip therefore has to seed real impressions, exactly as a real
// session would (Home records them, the feed flushes them on close).
const SEEN_STATIONS = {
  'uuid-rio': { lastShownAt: Date.now() - 60_000, shownCount: 2 },
  'uuid-saopaulo': { lastShownAt: Date.now() - 120_000, shownCount: 1 }
};

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

const openFeedFromHome = async (page: Page) => {
  await page.locator('.app-navigation-mobile').getByRole('button', { name: /Главная|Home/ }).click();
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();
  await page.locator('[data-home-feed-entry]').click();
  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  await expect(page.locator('.station-feed-card-name').first()).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await page.setViewportSize({ width: 390, height: 844 });
});

test('chips render as real pressed-state buttons, with «Подборка» active by default', async ({
  page
}) => {
  await seedRadioState(page, { activeSection: 'feed', stationExposure: SEEN_STATIONS });
  await page.goto('/?api=/api');
  await expect(page.locator('.station-feed-overlay')).toBeVisible();

  const chips = page.locator('.station-feed-chip');
  // «Подборка» + «Новое для тебя» always; «Популярное» only when the server sent
  // a popular set, which the shared e2e mock deliberately does not (see below).
  await expect(chips).toHaveCount(2);
  await expect(page.locator('.station-feed-chip[data-feed-filter="picks"]')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.locator('.station-feed-chip[data-feed-filter="fresh"]')).toHaveAttribute(
    'aria-pressed',
    'false'
  );

  // «LIVE» is deliberately absent: the liveness gate is already applied to every
  // candidate, so such a chip would filter nothing.
  await expect(page.locator('.station-feed-chip[data-feed-filter="live"]')).toHaveCount(0);

  // Selecting moves the pressed state.
  await page.locator('.station-feed-chip[data-feed-filter="fresh"]').click();
  await expect(page.locator('.station-feed-chip[data-feed-filter="fresh"]')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.locator('.station-feed-chip[data-feed-filter="picks"]')).toHaveAttribute(
    'aria-pressed',
    'false'
  );
});

test('«Популярное» appears only when the summary actually carries trending/topVoted', async ({
  page
}) => {
  // Per-spec override rather than adding the fields to the shared mock: putting
  // trending/topVoted into tests/helpers.ts would materialise two extra Home
  // discovery rails and churn every Home visual baseline.
  await mockStations(page, {
    summaryHandler: async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          generatedAt: Date.UTC(2026, 3, 20, 9, 0, 0),
          counts: { stations: stations.length, countries: 3, languages: 3, genres: 8 },
          catalogPool: stations.slice(0, 8),
          trending: stations.slice(2, 6),
          topVoted: stations.slice(4, 8),
          freshSignals: stations.slice(0, 6),
          searchLaunch: stations.slice(0, 6),
          sponsored: stations.slice(0, 2),
          countrySpotlight: { label: 'Japan', stations: stations.slice(0, 4) },
          genreSpotlight: { label: 'jpop', stations: stations.slice(0, 4) }
        })
      });
    }
  });
  await seedRadioState(page, { activeSection: 'feed', stationExposure: SEEN_STATIONS });
  await page.goto('/?api=/api');
  await expect(page.locator('.station-feed-overlay')).toBeVisible();

  await expect(page.locator('.station-feed-chip[data-feed-filter="popular"]')).toBeVisible();
  await page.locator('.station-feed-chip[data-feed-filter="popular"]').click();
  await expect(page.locator('.station-feed-chip[data-feed-filter="popular"]')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  // It genuinely produces a deck rather than an empty screen.
  await expect(page.locator('.station-feed-card').first()).toBeVisible();
});

test('the filter toggle collapses the chip row out of the tab cycle', async ({ page }) => {
  await seedRadioState(page, { activeSection: 'feed', stationExposure: SEEN_STATIONS });
  await page.goto('/?api=/api');
  await expect(page.locator('.station-feed-overlay')).toBeVisible();

  const toggle = page.locator('.station-feed-filter-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.station-feed-chip').first()).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#station-feed-filters')).toBeHidden();
  // Collapsed chips are not RENDERED, not merely hidden. Hiding alone was not
  // enough and is the bug this asserts against: useDialog's isVisible() reads
  // each candidate's OWN computed style, and a chip under a display:none parent
  // still reports `display: inline-flex`, so getFocusable kept enumerating them.
  await expect(page.locator('.station-feed-chip')).toHaveCount(0);

  // ⚠ THE REAL PROPERTY (WCAG 2.1.2). The previous assertion here was
  // "chip.focus() fails" — which is precisely the MECHANISM of the trap, not
  // proof of safety: focus() on a non-rendered element silently no-ops,
  // activeElement never moves, and useDialog's nextIndex recomputes to the same
  // dead chip on every keypress. Measured before the fix: 8 consecutive Tab
  // presses ALL left focus on the toggle, and the play orb, favourite, queue,
  // share, expand and peek strip were unreachable by forward Tab. So assert
  // that Tab actually MOVES.
  await toggle.focus();
  const walked: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    await page.keyboard.press('Tab');
    walked.push(
      await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        return active ? active.className || active.tagName : 'none';
      })
    );
  }
  expect(walked[0]).not.toContain('station-feed-filter-toggle');
  expect(new Set(walked).size).toBeGreaterThan(1);
  // And the primary action is genuinely reachable from the collapsed state.
  expect(walked.some((cls) => cls.includes('station-feed-action--play'))).toBe(true);

  await toggle.click();
  await expect(page.locator('.station-feed-chip').first()).toBeVisible();
});

test('#86 + a11y: tabbing through the dialog never switches the station', async ({ page }) => {
  // The hole this closes: cards within the ±2 render window mount their full
  // action rail, so peeking cards contributed ~8 extra tab stops. Focusing one
  // makes the BROWSER scroll it into view, which fires the pager's passive
  // scroll handler → commitLandedIndex → settler.notify → playStation. Measured
  // before the fix: 8 Tab presses from the close button moved scrollTop 0 →
  // 1688 (two whole cards) and started a station. A Tab press is not a swipe, so
  // that is exactly the unrequested auto-switch #86 forbids — and it stayed
  // green in every other spec because none of them tab into a card.
  await installPlayProbe(page);
  await seedRadioState(page, { stationExposure: SEEN_STATIONS });
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

  // Start a station FIRST, then open the feed. That is deliberate: with a
  // station already current, resolveFeedEntry opens on its card and seeds it as
  // already-played, so the feed autoplays nothing at all. Any play or station
  // change after this point is unambiguously the Tab run's fault — no idle
  // open-autoplay to confound the baseline.
  await startSearchResultsRadio(page);
  await expect.poll(() => currentQueueStationId(page)).not.toBeNull();
  await openFeedFromHome(page);

  const scroller = page.locator('.station-feed-scroller');
  await page.waitForTimeout(900); // past the 220ms settle window
  const stationBefore = await currentQueueStationId(page);
  expect(stationBefore).toBeTruthy();
  const dockTitleBefore = await page.locator('.player-dock-title').first().innerText();
  const playsBefore = await page.evaluate(
    () => (window as unknown as { __playSrcs: string[] }).__playSrcs.length
  );
  const scrollBefore = await scroller.evaluate((element) => element.scrollTop);

  await page.locator('.station-feed-close').focus();
  // Well past the number of controls on the focused card, so a leak into a
  // peeking card's rail would certainly be hit.
  for (let index = 0; index < 16; index += 1) {
    await page.keyboard.press('Tab');
  }
  await page.waitForTimeout(900); // past the 220ms settle window

  // Focus must never have DRAGGED THE PAGER — that scroll is the whole
  // mechanism, and without it the settler is never notified.
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(scrollBefore);
  expect(await currentQueueStationId(page)).toBe(stationBefore);
  expect(await page.locator('.player-dock-title').first().innerText()).toBe(dockTitleBefore);
  expect(
    await page.evaluate(() => (window as unknown as { __playSrcs: string[] }).__playSrcs.length)
  ).toBe(playsBefore);

  // Every control the cycle DOES reach is on the focused card, visible, and
  // named — no invisible tab stops painting a focus ring nobody can see (the
  // entrance rule paints non-focused cards' controls at opacity 0).
  const activeIndex = await page
    .locator('.station-feed-card-content[data-focus="true"]')
    .evaluate((node) => (node.closest('.station-feed-card') as HTMLElement).dataset.feedIndex);
  const reached = await page.evaluate(() => {
    const seen: Array<{ opacity: string; label: string | null; cardIndex: string | null }> = [];
    document
      .querySelectorAll<HTMLElement>('.station-feed-overlay .station-feed-action')
      .forEach((node) => {
        if (node.tabIndex === -1) return;
        const card = node.closest('.station-feed-card') as HTMLElement | null;
        seen.push({
          opacity: getComputedStyle(node).opacity,
          label: node.getAttribute('aria-label'),
          cardIndex: card?.dataset.feedIndex ?? null
        });
      });
    return seen;
  });
  expect(reached.length).toBeGreaterThan(0);
  reached.forEach((entry) => {
    expect(entry.opacity).toBe('1');
    expect(entry.cardIndex).toBe(activeIndex);
    // Rail labels name their station, so a screen-reader user knows which of
    // the windowed cards a control belongs to.
    expect(entry.label && entry.label.length > 0).toBe(true);
    expect(entry.label).toContain(':');
  });
});

test('the play orb stays clear of the topbar on a SHORT viewport (three chips)', async ({
  page
}) => {
  // The rail is bottom-anchored with a fixed natural height, so on a short
  // viewport its top used to rise into the topbar band: the topbar wins the hit
  // test at z-index 5, which made the screen's PRIMARY action untappable where
  // they overlapped (and below ~350px tall the top of the rail was clipped off
  // the card entirely). Landscape phones and Telegram compact mode live here.
  // Three chips = the tallest topbar, i.e. the worst case.
  await mockStations(page, {
    summaryHandler: async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          generatedAt: Date.UTC(2026, 3, 20, 9, 0, 0),
          counts: { stations: stations.length, countries: 3, languages: 3, genres: 8 },
          catalogPool: stations.slice(0, 8),
          trending: stations.slice(2, 6),
          topVoted: stations.slice(4, 8),
          freshSignals: [],
          searchLaunch: [],
          sponsored: [],
          countrySpotlight: { label: 'Japan', stations: [] },
          genreSpotlight: { label: 'jpop', stations: [] }
        })
      });
    }
  });
  await seedRadioState(page, { activeSection: 'feed', stationExposure: SEEN_STATIONS });
  await page.setViewportSize({ width: 390, height: 420 });
  await page.goto('/?api=/api');
  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  await expect(page.locator('.station-feed-chip')).toHaveCount(3);

  const geometry = await page.evaluate(() => {
    const orb = document.querySelector('[data-feed-playback-action]') as HTMLElement | null;
    const topbar = document.querySelector('.station-feed-topbar') as HTMLElement | null;
    const card = document.querySelector('.station-feed-card-content') as HTMLElement | null;
    if (!orb || !topbar || !card) return null;
    const box = orb.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return {
      hitsOrb: Boolean(hit?.closest('.station-feed-action--play')),
      orbTop: box.y,
      topbarBottom: topbar.getBoundingClientRect().bottom,
      cardTop: card.getBoundingClientRect().top
    };
  });
  expect(geometry).not.toBeNull();
  // The whole point: a tap in the middle of the orb reaches the orb.
  expect(geometry!.hitsOrb).toBe(true);
  // And it is below the topbar rather than merely winning the hit test there,
  // and inside its own card rather than clipped off the top of it.
  expect(geometry!.orbTop).toBeGreaterThanOrEqual(geometry!.topbarBottom);
  expect(geometry!.orbTop).toBeGreaterThanOrEqual(geometry!.cardTop);
});

test('a swipe hands focus over instead of stranding it in an aria-hidden rail', async ({
  page
}) => {
  // The rail of a card that stops being active goes aria-hidden + tabIndex -1.
  // Neither blurs an element that is ALREADY focused, so focusing a rail control
  // and then swiping left focus inside an aria-hidden subtree painted at opacity
  // 0 — axe `aria-hidden-focus` (AT loses the focus location entirely) plus WCAG
  // 2.4.7 (no visible indicator). Reachable by any mixed touch+keyboard user and
  // on Telegram Desktop by focusing the heart and scrolling with the wheel.
  await seedRadioState(page, { activeSection: 'feed', stationExposure: SEEN_STATIONS });
  await page.goto('/?api=/api');
  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  await expect(page.locator('.station-feed-card-name').first()).toBeVisible();

  const focusedCard = page.locator('.station-feed-card-content[data-focus="true"]');
  await focusedCard.locator('[data-feed-action="favorite"]').focus();
  const startIndex = Number(
    await focusedCard.evaluate(
      (node) => (node.closest('.station-feed-card') as HTMLElement).dataset.feedIndex
    )
  );

  const scroller = page.locator('.station-feed-scroller');
  const cardHeight = await scroller.evaluate((element) => element.clientHeight);
  await scroller.hover();
  await page.mouse.wheel(0, cardHeight);
  await expect
    .poll(() =>
      scroller.evaluate((element) => Math.round(element.scrollTop / Math.max(element.clientHeight, 1)))
    )
    .toBe(startIndex + 1);

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        if (!active || active === document.body) return { action: null };
        return {
          action: active.dataset.feedAction ?? null,
          inAriaHidden: Boolean(active.closest('[aria-hidden="true"]')),
          opacity: getComputedStyle(active).opacity,
          cardIndex: (active.closest('.station-feed-card') as HTMLElement | null)?.dataset.feedIndex
        };
      })
    )
    .toEqual({
      // The SAME control, on the card that just became active — not a teleport
      // back to the ✕ button, which is where Tab used to dump it.
      action: 'favorite',
      inAriaHidden: false,
      opacity: '1',
      cardIndex: String(startIndex + 1)
    });
});

test('the pager is keyboard-operable in BOTH directions', async ({ page }) => {
  // «Дальше» only ever advances, and native arrow-scrolling reaches the snap
  // container only while focus happens to sit inside it — from the ✕ button
  // ArrowDown did nothing, and nothing in the tab cycle went back a card at all.
  // Scrolling is all the handler does, so the landing still goes through the
  // same scroll → IntersectionObserver → settler path a swipe does (#86).
  await seedRadioState(page, { activeSection: 'feed', stationExposure: SEEN_STATIONS });
  await page.goto('/?api=/api');
  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  await expect(page.locator('.station-feed-card-name').first()).toBeVisible();

  const scroller = page.locator('.station-feed-scroller');
  const cardIndex = () =>
    scroller.evaluate((element) => Math.round(element.scrollTop / Math.max(element.clientHeight, 1)));
  await page.locator('.station-feed-close').focus();
  expect(await cardIndex()).toBe(0);

  await page.keyboard.press('ArrowDown');
  await expect.poll(cardIndex).toBe(1);
  // One key press = exactly one card, even though the browser would also scroll
  // the snap container natively once focus is inside it.
  await page.keyboard.press('ArrowDown');
  await expect.poll(cardIndex).toBe(2);
  await page.keyboard.press('ArrowUp');
  await expect.poll(cardIndex).toBe(1);
  // And it clamps at the top rather than rubber-banding past card 0.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect.poll(cardIndex).toBe(0);
});

test('every feed control clears the 44px touch-target floor', async ({ page }) => {
  await seedRadioState(page, { activeSection: 'feed', stationExposure: SEEN_STATIONS });
  await page.goto('/?api=/api');
  await expect(page.locator('.station-feed-card-name').first()).toBeVisible();

  const selectors = [
    '.station-feed-close',
    '.station-feed-filter-toggle',
    '.station-feed-chip',
    '.station-feed-next',
    '.station-feed-action'
  ];
  for (const selector of selectors) {
    const nodes = page.locator(selector);
    const count = await nodes.count();
    expect(count, `${selector} should render`).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      const box = await nodes.nth(index).boundingBox();
      if (!box) continue; // windowed-out cards are legitimately not laid out
      expect(box.width, `${selector}[${index}] width`).toBeGreaterThanOrEqual(43.5);
      expect(box.height, `${selector}[${index}] height`).toBeGreaterThanOrEqual(43.5);
    }
  }
});

test('GEOMETRY: one card is exactly one scroller viewport, chips and peek strip included', async ({
  page
}) => {
  // The peek is achieved by insetting the card CONTENT, never by shrinking the
  // snap unit — card height is the divisor in the production scroll fallback, in
  // the kickstart jump, and in playback-no-auto-switch's own index arithmetic.
  // A chip row rendered as a flow child of the scroller would break all three.
  await seedRadioState(page, { activeSection: 'feed', stationExposure: SEEN_STATIONS });
  await page.goto('/?api=/api');
  await expect(page.locator('.station-feed-card-name').first()).toBeVisible();

  const cardCount = await page.locator('.station-feed-card').count();
  expect(cardCount).toBeGreaterThan(1);
  const metrics = await page.locator('.station-feed-scroller').evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight
  }));
  expect(metrics.scrollHeight).toBeCloseTo(metrics.clientHeight * cardCount, 0);

  // And the peek strip really does sit below the card stage.
  const stage = await page.locator('.station-feed-card-content').first().boundingBox();
  const peek = await page.locator('.station-feed-next').boundingBox();
  expect(stage).not.toBeNull();
  expect(peek).not.toBeNull();
  expect(peek!.y).toBeGreaterThanOrEqual(stage!.y + stage!.height - 1);
});

test('#86: changing the filter mid-scroll does NOT switch the playing station', async ({
  page
}) => {
  await installPlayProbe(page);
  await seedRadioState(page, { stationExposure: SEEN_STATIONS });
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

  await startSearchResultsRadio(page);
  await expect.poll(() => currentQueueStationId(page)).not.toBeNull();
  const stationBeforeFeed = await currentQueueStationId(page);
  expect(stationBeforeFeed).toBeTruthy();

  await openFeedFromHome(page);
  // The hero IS card 0 — the pin, which every filter branch must preserve.
  await expect(page.locator('.station-feed-card[data-feed-index="0"]')).toHaveAttribute(
    'data-feed-station',
    stationBeforeFeed as string
  );

  // FIRST: prove a real swipe still plays. Without this the test could pass on a
  // feed where autoplay-on-land is simply broken.
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

  const stationAfterSwipe = await currentQueueStationId(page);
  const dockTitleAfterSwipe = await page.locator('.player-dock-title').first().innerText();

  // NOW the hazard: tap a chip while parked on a non-zero card. The deck rebuild
  // re-creates the IntersectionObserver, whose initial callback fires straight
  // into the settler. Nothing here is a swipe, so nothing may play.
  await page.locator('.station-feed-chip[data-feed-filter="fresh"]').click();
  await page.waitForTimeout(900); // well past the 220ms settle window

  expect(await currentQueueStationId(page)).toBe(stationAfterSwipe);
  expect(await page.locator('.player-dock-title').first().innerText()).toBe(dockTitleAfterSwipe);

  // And the rebuilt deck is still pinned to the entry station at card 0.
  await expect(page.locator('.station-feed-card[data-feed-index="0"]')).toHaveAttribute(
    'data-feed-station',
    stationBeforeFeed as string
  );

  // Going back to «Подборка» is equally silent.
  await page.locator('.station-feed-chip[data-feed-filter="picks"]').click();
  await page.waitForTimeout(900);
  expect(await currentQueueStationId(page)).toBe(stationAfterSwipe);
});
