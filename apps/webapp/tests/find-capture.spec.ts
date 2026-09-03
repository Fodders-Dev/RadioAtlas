import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, playHomeStation, seedRadioState } from './helpers';

/**
 * Catching a find — the product's central act, and until 0.1a the least
 * defended thing in the app.
 *
 * Three defects this pins, all measured rather than assumed:
 *
 * 1. The find was saved AFTER `await navigator.clipboard.writeText(...)`, so a
 *    clipboard that was denied, unavailable, or simply rejected threw before
 *    the find existed. The listener got «не удалось скопировать» and lost the
 *    find itself, silently. The clipboard does not get a veto over the object
 *    the whole product is built on.
 * 2. Nothing was reported. `copyTrack` wrote to state and to the taste profile
 *    and called no analytics at all, so 200 finds in the owner's own library
 *    left no trace on the server and the product could not measure its own
 *    central moment.
 * 3. The affordance was the track title with a COPY glyph on it, 20px tall —
 *    invisible as an action and under half the 44px touch floor.
 */

const openWithTrack = async (page: Page) => {
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page);
  await page.goto('/?api=/api&glass=full');
  await playHomeStation(page, 'Tokyo FM');
  await expect(page.locator('[data-capture-find]')).toBeVisible({ timeout: 15_000 });
};

/**
 * Every client event the app sent, in order.
 *
 * ⚠ `page.route` is the wrong tool here and silently reports zero: the app
 * sends through `navigator.sendBeacon` (lib/observability.ts) and only falls
 * back to fetch, and Playwright's routing never sees a beacon. `helpers.ts`
 * also already routes this path, so a route registered before
 * `installMediaMocks` loses to it anyway. Patch the transport instead.
 */
const captureEvents = async (page: Page) => {
  await page.addInitScript(() => {
    const seen: unknown[] = [];
    (window as unknown as { __events: unknown[] }).__events = seen;
    const record = (body: unknown) => {
      try {
        seen.push(typeof body === 'string' ? JSON.parse(body) : body);
      } catch {
        /* an unparseable body is still a send we witnessed */
      }
    };
    const original = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: (url: string, data?: BodyInit | null) => {
        if (String(url).includes('/observability/client-event')) {
          if (data instanceof Blob) void data.text().then(record);
          else record(data);
        }
        return original ? original(url, data as BodyInit) : true;
      }
    });
  });
};

const sentEvents = (page: Page) =>
  page.evaluate(
    () => ((window as unknown as { __events?: Array<Record<string, unknown>> }).__events || [])
  );

test('a refused clipboard does not cost the listener the find', async ({ page }) => {
  await page.addInitScript(() => {
    // The real failure this reproduces: a denied permission, an insecure
    // context, or a browser that simply rejects. All of them land here.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) }
    });
  });
  await openWithTrack(page);

  await page.locator('[data-capture-find]').click();

  // The find is what matters, and it is kept despite the refusal. Read the
  // library the app actually persists rather than walking the UI to it: the
  // Медиатека's own rendering has its own specs, and this one is about whether
  // the object survived a clipboard that said no.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          try {
            return window.localStorage.getItem('radio:library:v2') || '';
          } catch {
            return '';
          }
        }),
      { timeout: 10_000 }
    )
    .toContain('Mock Song');
});

test('the find is reported once per catch, with no track title in it', async ({ page }) => {
  await captureEvents(page);
  await openWithTrack(page);

  const finds = async () =>
    (await sentEvents(page)).filter((event) => event.name === 'find_captured');

  await page.locator('[data-capture-find]').click();
  await expect.poll(async () => (await finds()).length, { timeout: 10_000 }).toBe(1);

  const event = (await finds())[0]!;
  const meta = (event.meta || {}) as Record<string, unknown>;
  expect(meta.stationId).toBeTruthy();
  expect(meta.clipboard).toBeTruthy();

  // What somebody listens to is theirs. The station and the outcome answer
  // every question the roadmap asks; the title answers none of them.
  expect(JSON.stringify(event)).not.toContain('Mock Song');

  // ⚠ The regression that would be invisible: `reportProductEvent` defaults to
  // `dedupeKey: '<name>:<sessionId>'` with no window, and `shouldSend` then
  // drops every repeat. A counter shaped like "finds" would quietly have meant
  // "sessions with at least one find". Two catches must be two events.
  await page.locator('[data-capture-find]').click();
  await expect.poll(async () => (await finds()).length, { timeout: 10_000 }).toBe(2);
});

test('the catch row is a real 44px target, not a band faked over its neighbours', async ({
  page
}) => {
  // ⚠ Every width, and the phone ones are the point: `MiniPlayerDock.css` has a
  // `@media (max-width: 430px)` block that redeclares this row's min-height, so
  // a change made only in the base rules passes at Playwright's 1280 default and
  // is invisible on the device the app actually runs in. That happened here.
  for (const width of [360, 390, 426, 1280]) {
    await page.setViewportSize({ width, height: width < 500 ? 800 : 720 });
    await openWithTrack(page);
    const height = await page
      .locator('[data-capture-find]')
      .evaluate((node) => Math.round(node.getBoundingClientRect().height));
    expect(height, `the catch row owes 44px at ${width}px`).toBeGreaterThanOrEqual(44);
  }

  const reach = await page.locator('[data-capture-find]').evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const hits = (y: number) => {
      const found = document.elementFromPoint(x, y);
      return Boolean(found && (found === node || node.contains(found)));
    };
    return {
      layoutHeight: Math.round(rect.height),
      // Inside its OWN box, top and bottom. 0.1a shipped 35px of hit area
      // borrowed from outside the element, and the first attempt at 44 that way
      // ate the control above it. The height is real now, so these probes stay
      // within the border box.
      nearTop: hits(rect.top + 3),
      nearBottom: hits(rect.bottom - 3)
    };
  });

  expect(reach.layoutHeight, 'the product’s central action owes 44px').toBeGreaterThanOrEqual(44);
  expect(reach.nearTop).toBe(true);
  expect(reach.nearBottom).toBe(true);
});

test('the find outranks its source, and the bookmark rides with the track', async ({ page }) => {
  await openWithTrack(page);

  const read = await page.evaluate(() => {
    const track = document.querySelector('.player-dock-track-button-text');
    const station = document.querySelector('.player-dock-title');
    const capture = document.querySelector('[data-capture-find]');
    const actions = document.querySelector('.player-dock-actions');
    if (!track || !station || !capture || !actions) return null;
    const t = getComputedStyle(track);
    const s = getComputedStyle(station);
    return {
      trackPx: parseFloat(t.fontSize),
      trackWeight: Number(t.fontWeight),
      stationPx: parseFloat(s.fontSize),
      stationWeight: Number(s.fontWeight),
      bookmarkInsideTrackRow: Boolean(capture.querySelector('svg')),
      bookmarkInActionGroup: actions.contains(capture),
      // The station row still has to be READABLE — a caption, not a footnote.
      stationOpacity: s.color
    };
  });

  expect(read).not.toBeNull();
  // The model, asserted as a direction rather than as constants: a find is the
  // object, a station is where it came from. Until 0.1a.1 it was inverted and a
  // screenshot caught it before any measurement did.
  expect(read!.trackPx).toBeGreaterThan(read!.stationPx);
  expect(read!.trackWeight).toBeGreaterThan(read!.stationWeight);

  // ⚠ The defect this pins: with the bookmark sitting in the action group it
  // read as a third transport button next to ⋮ and pause, and the link «this
  // track → keep it» was lost. It belongs to the track row.
  expect(read!.bookmarkInsideTrackRow).toBe(true);
  expect(read!.bookmarkInActionGroup).toBe(false);
});

test('the widened hit area steals nothing from its neighbours', async ({ page }) => {
  // The chip keeps 30px of layout and reaches 7px further each way for the
  // touch floor. That invisible band is the risk: it sits inside the dock,
  // inches from the heart that saves the STATION, from play/next, and from
  // whatever opens the full player. A band that overlaps any of them turns a
  // deliberate tap into a find nobody asked for — and it would be invisible,
  // because nothing about the layout looks wrong.
  for (const width of [360, 390, 426]) {
    await page.setViewportSize({ width, height: 844 });
    await openWithTrack(page);

    // A long title is the adversarial case: the chip grows toward the actions.
    await page.locator('.player-dock-track-button-text').evaluate((node) => {
      node.textContent = 'Very long track title bbb bbb bbb bbb bbb bbb bbb bbb bbb bbb';
    });
    await page.waitForTimeout(200);

    const theft = await page.evaluate(() => {
      const capture = document.querySelector('[data-capture-find]');
      if (!capture) return ['no capture control'];
      const dock = capture.closest('.player-dock, .player-dock-bar') || document.body;
      const others = Array.from(
        dock.querySelectorAll('button, a, [role="button"], input')
      ).filter((node) => node !== capture && !capture.contains(node));

      const stolen: string[] = [];
      for (const node of others) {
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        // Centre plus the four inner corners: a band that clips an edge is
        // just as broken as one that covers the middle.
        const points: Array<[number, number]> = [
          [rect.left + rect.width / 2, rect.top + rect.height / 2],
          [rect.left + 2, rect.top + 2],
          [rect.right - 2, rect.top + 2],
          [rect.left + 2, rect.bottom - 2],
          [rect.right - 2, rect.bottom - 2]
        ];
        for (const [x, y] of points) {
          const hit = document.elementFromPoint(x, y);
          if (hit && (hit === capture || capture.contains(hit))) {
            const label =
              node.getAttribute('aria-label') || node.className || node.tagName.toLowerCase();
            stolen.push(`${label} @ ${Math.round(x)},${Math.round(y)}`);
          }
        }
      }
      return stolen;
    });

    expect(theft, `the catch band swallows a neighbour at ${width}px`).toEqual([]);
  }
});

test('a station that names nothing gets no control, not a dead one', async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page);

  // Registered AFTER installMediaMocks so this wins (Playwright takes the
  // last matching route). ~40% of the catalogue behaves exactly like this.
  await page.route('**/metadata?url=**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ title: '', logs: ['silent'], source: 'test' })
    })
  );

  await page.goto('/?api=/api&glass=full');
  await playHomeStation(page, 'Tokyo FM');
  await expect(page.locator('.player-dock-bar')).toBeVisible({ timeout: 15_000 });

  // The row still says something — the genre or «Прямой эфир», per the silent
  // station ladder — but it is TEXT. It used to be a DISABLED button captioned
  // with the genre («Спорт» on RMC FR, measured on production 2026-09-03),
  // which reads as a broken control rather than an honest absence and teaches a
  // new listener that the action does not work.
  await expect(page.locator('.player-dock-track-button-text')).toBeVisible();
  await expect(page.locator('[data-capture-find]')).toHaveCount(0);
  await expect(page.locator('.player-dock-track-button:disabled')).toHaveCount(0);
});
