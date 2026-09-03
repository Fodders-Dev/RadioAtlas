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

test('the catch control is reachable by a thumb, and absent when there is no track', async ({
  page
}) => {
  await openWithTrack(page);

  const reach = await page.locator('[data-capture-find]').evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const hits = (y: number) => {
      const found = document.elementFromPoint(x, y);
      return Boolean(found && (found === node || node.contains(found)));
    };
    return {
      layoutHeight: Math.round(rect.height),
      // The hit area is widened outward by the ::after inset so the dock's own
      // height never moves — `--dock-offset-v2` is a constant the bottom scroll
      // reserve is computed from, and growing the bar would desynchronise it.
      aboveTheBorder: hits(rect.top - 5),
      belowTheBorder: hits(rect.bottom + 5)
    };
  });

  expect(reach.layoutHeight).toBeGreaterThanOrEqual(28);
  expect(reach.aboveTheBorder, 'the touch target must extend above the chip').toBe(true);
  expect(reach.belowTheBorder, 'the touch target must extend below the chip').toBe(true);

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
