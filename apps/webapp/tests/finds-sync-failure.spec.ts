import { expect, test, type Page } from '@playwright/test';
import { ACCOUNT_FIXTURE_API_BASE, installGoogleAuthFixture } from './authFixture';
import { createSharedGoogleCredential, prepareSharedGooglePage, signInThroughOnboarding } from './accountSessionFixture';
import { installMediaMocks, mockStations, seedRadioState } from './helpers';

/**
 * State B of «saved means saved»: the find is safe on the device, the cloud
 * copy is not — and then the cloud copy catches up.
 *
 * ⚠ This deliberately does NOT play anything or catch anything. Five earlier
 * attempts at this scenario went through the capture affordance and died in the
 * metadata fixture: signed in, the dock appears and the station plays, but no
 * track ever resolves, so there is no catch control to press. That was the
 * wrong contract to be proving twice — `find-capture.spec.ts` already owns
 * «track → поймать → находка появляется». What is unproven here is what
 * happens to a find that ALREADY EXISTS when the transport fails, and a find
 * seeded into storage is exactly as real as one that was clicked into it.
 *
 * The transport is the real one: a genuine `PUT /me/library` against the API
 * this suite spawns, with only the FIRST attempt intercepted and refused.
 */

const SEEDED_FIND = {
  id: 'seeded-find-1',
  stationId: 'uuid-tokyo',
  stationName: 'Tokyo FM',
  track: 'Seeded Artist - Seeded Title',
  timestamp: 1_756_000_000_000
};

type Recorded = { name?: string; meta?: Record<string, unknown> };

/**
 * Every client event, and every toast, captured as they happen.
 *
 * ⚠ Two traps, both already paid for elsewhere in this suite. Telemetry goes
 * out through `navigator.sendBeacon`, which `page.route` never sees — patch the
 * transport instead. And the toast lives for 2000ms and then removes itself, so
 * an assertion that arrives late finds nothing and reports the product broken;
 * a MutationObserver keeps the text after the element is gone.
 */
const observe = async (page: Page) => {
  await page.addInitScript(() => {
    const events: unknown[] = [];
    const toasts: string[] = [];
    (window as unknown as { __events: unknown[] }).__events = events;
    (window as unknown as { __toasts: string[] }).__toasts = toasts;

    const record = (body: unknown) => {
      try {
        events.push(typeof body === 'string' ? JSON.parse(body) : body);
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

    const noteToast = (node: Node) => {
      if (!(node instanceof HTMLElement)) return;
      const toast = node.matches?.('.toast') ? node : node.querySelector?.('.toast');
      const text = toast?.textContent?.trim();
      if (text) toasts.push(text);
    };
    // ⚠ `document`, NOT `document.documentElement`. An init script runs at
    // document start, where `documentElement` can still be null — `observe(null)`
    // throws, the rest of the script never runs, and the only symptom is an
    // empty array that reads exactly like «the app showed no toast». Cost one
    // red run. `document` is always there and subtree covers the same nodes.
    new MutationObserver((records) => {
      for (const entry of records) entry.addedNodes.forEach(noteToast);
    }).observe(document, { childList: true, subtree: true });
  });
};

const eventsNamed = async (page: Page, name: string) =>
  (
    await page.evaluate(
      () => ((window as unknown as { __events?: Recorded[] }).__events || []) as Recorded[]
    )
  ).filter((event) => event.name === name);

const storedFinds = (page: Page) =>
  page.evaluate(() => {
    try {
      const raw = window.localStorage.getItem('radio:library:v2');
      if (!raw) return [] as Array<{ track: string }>;
      return (JSON.parse(raw).trackHistory || []) as Array<{ track: string }>;
    } catch {
      return [] as Array<{ track: string }>;
    }
  });

test('a find already on the device survives a failed sync and reaches the cloud on the next one', async ({
  page
}) => {
  await installMediaMocks(page);
  await installGoogleAuthFixture(page);
  await mockStations(page, { authProviders: { google: true } });

  // ⚠ Order is load bearing. `prepareSharedGooglePage` does a
  // `localStorage.clear()` inside its own init script, so a library seeded
  // before it is wiped; `seedRadioState` then writes the library AND resets
  // `radio:api-url` to `/api`, which would point the app away from the account
  // fixture's API. Hence the third script putting the base back.
  await prepareSharedGooglePage(page, createSharedGoogleCredential(`${Date.now()}-syncfail`));
  await seedRadioState(page, { trackHistory: [SEEDED_FIND] });
  await page.addInitScript((base) => {
    window.localStorage.setItem('radio:api-url', base);
  }, ACCOUNT_FIXTURE_API_BASE);
  await observe(page);

  const syncedBodies: string[] = [];
  let attempts = 0;
  // Registered last so it wins — Playwright takes the last matching route.
  await page.route('**/me/library', async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.continue();
      return;
    }
    attempts += 1;
    if (attempts === 1) {
      // A server that is up and refusing, which is the ordinary shape of this:
      // a 500 is retried, unlike a 401, which the transport deliberately does
      // not re-flush to avoid a spin-loop.
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'library sync failed' })
      });
      return;
    }
    syncedBodies.push(route.request().postData() || '');
    await route.continue();
  });

  await signInThroughOnboarding(page, ACCOUNT_FIXTURE_API_BASE);
  await expect(page.locator('.app-topbar-primary-cta')).toContainText('Аккаунт');

  // 1. The failure is reported once — and «once» is the assertion, because the
  //    transport re-flushes after a 500 and a counter that fired per attempt
  //    would say «мы теряем sync» far louder than the truth.
  await expect.poll(() => eventsNamed(page, 'find_sync_failed').then((e) => e.length), {
    timeout: 20_000
  }).toBe(1);

  // 2. And it says WHAT was waiting. `pending` is the count this device holds
  //    that the confirmed cloud copy does not — the proof behind the name.
  const failure = (await eventsNamed(page, 'find_sync_failed'))[0]!;
  expect(failure.meta?.pending).toBe(1);
  expect(JSON.stringify(failure)).not.toContain('Seeded Title');

  // 3. The person is told, rather than left to find out later.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts), {
      timeout: 20_000
    })
    .toContain('Находка сохранена на устройстве. Синхронизация не удалась');

  // 4. The find is still on the device. This is the whole promise: a transport
  //    that failed may not cost somebody what they saved.
  expect(await storedFinds(page)).toHaveLength(1);

  // 5. The next sync goes through, carrying the find that was waiting.
  await expect.poll(() => syncedBodies.length, { timeout: 20_000 }).toBeGreaterThan(0);
  expect(syncedBodies.some((body) => body.includes('Seeded Artist - Seeded Title'))).toBe(true);

  // 6. Recovery is reported once. ⚠ This event is also the proof that the
  //    SERVER took it: it only fires when the last confirmed cloud library
  //    leaves nothing pending, and that library is replaced solely by a 200
  //    response body. A PUT that returned 200 while dropping the find would
  //    leave `pending` at 1 and this assertion would fail.
  await expect.poll(() => eventsNamed(page, 'find_sync_recovered').then((e) => e.length), {
    timeout: 20_000
  }).toBe(1);

  // 7. Still exactly one find, locally: the round trip through the cloud merge
  //    must not hand back a second copy of what was already here.
  const finalFinds = await storedFinds(page);
  expect(finalFinds).toHaveLength(1);
  expect(finalFinds[0]!.track).toBe('Seeded Artist - Seeded Title');
});

test('a sync that fails with nothing waiting says nothing about finds', async ({ page }) => {
  // ⚠ The false positive the owner named, as a browser assertion rather than a
  // promise. A condition of `trackHistory.length > 0 && syncState === 'error'`
  // passes every test above and is still wrong here: somebody whose finds are
  // all safely in the cloud changes something else, that sync fails, and the
  // app claims a find did not sync. A counter like that reads as a find-loss
  // problem we do not have.
  await installMediaMocks(page);
  await installGoogleAuthFixture(page);
  await mockStations(page, { authProviders: { google: true } });
  await prepareSharedGooglePage(page, createSharedGoogleCredential(`${Date.now()}-nofind`));
  await seedRadioState(page, { trackHistory: [SEEDED_FIND] });
  await page.addInitScript((base) => {
    window.localStorage.setItem('radio:api-url', base);
  }, ACCOUNT_FIXTURE_API_BASE);
  await observe(page);

  // Let the find reach the cloud first, then refuse everything after it. From
  // that point the device and the cloud agree about finds, so no later failure
  // is a find's failure.
  let settled = false;
  await page.route('**/me/library', async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.continue();
      return;
    }
    if (!settled) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'library sync failed' })
    });
  });

  await signInThroughOnboarding(page, ACCOUNT_FIXTURE_API_BASE);
  await expect(page.locator('.app-topbar-primary-cta')).toContainText('Аккаунт');
  await expect.poll(() => storedFinds(page).then((finds) => finds.length), { timeout: 20_000 }).toBe(
    1
  );
  // Nothing pending: the find synced, so the app must have said nothing.
  await expect
    .poll(() => eventsNamed(page, 'find_sync_failed').then((e) => e.length), { timeout: 5_000 })
    .toBe(0);

  settled = true;
  // A library change that is NOT a find: like a station.
  await page.getByRole('button', { name: 'Поиск' }).first().click();
  await expect(page.locator('.search-hero-card')).toBeVisible();
  await page.locator('#search-hero-input').first().fill('Osaka Nights');
  const stationRow = page.locator('.station-row').filter({ hasText: 'Osaka Nights' }).first();
  await expect(stationRow).toBeVisible();
  await stationRow.getByRole('button', { name: 'В лайки' }).click();

  // The sync genuinely fails — the session-level error is the app's own signal
  // that this is not a no-op test.
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            ((window as unknown as { __events?: Recorded[] }).__events || []).filter(
              (event) => event.name === 'session_sync_error'
            ).length
        ),
      { timeout: 20_000 }
    )
    .toBeGreaterThan(0);

  // And still nothing is claimed about finds, nor said to the person.
  expect(await eventsNamed(page, 'find_sync_failed')).toHaveLength(0);
  const toasts = await page.evaluate(
    () => (window as unknown as { __toasts: string[] }).__toasts
  );
  expect(toasts).not.toContain('Находка сохранена на устройстве. Синхронизация не удалась');
});
