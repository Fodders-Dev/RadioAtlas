import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState } from './helpers';

/**
 * «Находки» — the screen a find lives on after the air moved on.
 *
 * The thirteen checks the owner asked for before this was written, plus the
 * geometry guard carried over from the mockup, so the 44x44 that was agreed on
 * paper cannot quietly become 38 in the product.
 */

type SeedFind = {
  id: string;
  stationId: string;
  track: string;
  stationName: string;
  timestamp: number;
};

const DAY = 86_400_000;

const makeFinds = (count: number, now: number): SeedFind[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `find-${i}`,
    stationId: `station-${i % 5}`,
    stationName: ['Radio Paradise', 'SomaFM Groove Salad', 'FIP', 'Наше Радио', 'KEXP'][i % 5],
    track: `Artist ${i} - Track ${i}`,
    // Spread across today, yesterday, this week and older months so the
    // grouping is exercised rather than assumed.
    timestamp: now - i * 5 * 3600_000
  }));

/**
 * ⚠ Midday TODAY, not a literal date — and this is a repair, not a preference.
 *
 * It was `Date.UTC(2026, 8, 4, 12, 0, 0)`. The app groups finds against the
 * REAL clock, so a find seeded an hour before that literal stopped being «today»
 * the moment the date rolled past 4 September: «a row says only what its
 * heading does not» started printing «Radio Paradise · 4 сент., 14:00» where it
 * expected a bare time, and failed for everyone, forever, on a change nobody
 * made. A time bomb with a two-day fuse.
 *
 * Anchored to midday of the current day it is both correct and stable: an hour
 * before is always today, and no run lands near a midnight boundary.
 */
const NOW = (() => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.getTime();
})();

const openFinds = async (
  page: Page,
  finds: SeedFind[],
  options: { viewport?: { width: number; height: number } } = {}
) => {
  await page.setViewportSize(options.viewport || { width: 390, height: 844 });
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page, { activeSection: 'library', libraryTab: 'tracks', trackHistory: finds });
  await page.goto('/?api=/api&glass=full');
  await expect(page.locator('.screen-library-v2')).toBeVisible({ timeout: 15_000 });
  // The tab strip may land on another tab; click through to «Находки» by its
  // NEW label, which also proves the rename shipped.
  const tab = page.getByRole('tab', { name: 'Находки' });
  if (await tab.isVisible().catch(() => false)) await tab.click();
  await expect(page.locator('[data-finds-search]')).toBeVisible({ timeout: 10_000 });
};

const findRows = (page: Page) => page.locator('[data-find-row]');

test('the tab is «Находки» and the list is not a scroller inside a scroller', async ({ page }) => {
  await openFinds(page, makeFinds(24, NOW));

  // 13. no nested scroll, no horizontal overflow — with a big library.
  const scroll = await page.evaluate(() => {
    const offenders: string[] = [];
    const list = document.querySelector('[data-finds-list]');
    let node: HTMLElement | null = list as HTMLElement | null;
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      const scrolls = /(auto|scroll)/.test(`${style.overflowY}`);
      if (scrolls && node.scrollHeight > node.clientHeight + 1) {
        offenders.push(node.className || node.tagName);
      }
      node = node.parentElement;
    }
    return {
      offenders,
      docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });
  // ⚠ What this replaced: `.track-list-scroll { max-height: min(420px,55vh);
  // overflow:auto }` — finds scrolled inside a page that also scrolled.
  expect(scroll.offenders, 'the finds list must scroll with the page').toEqual([]);
  expect(scroll.docOverflowX, 'no horizontal overflow at 390px').toBeLessThanOrEqual(0);
});

/**
 * ⚠ A document-level overflow check is NOT enough, and this test exists because
 * the first version of the one above passed over a broken screen.
 *
 * `.finds-list` was a grid with an implicit column, which sizes to MAX-CONTENT.
 * `.find-row-track` is `nowrap`, so a single long title — «Гражданская оборона
 * — Всё идёт по плану» — stretched every row to 422px inside a 390px viewport
 * and pushed the «⋮» 48px off screen. An ancestor clips with `overflow:
 * hidden`, so `document.scrollWidth` never grew and the check stayed green
 * while the control was unreachable.
 *
 * So: measure the CONTROLS against the viewport, with titles long enough to
 * provoke it.
 */
test('a long title cannot push the controls off screen', async ({ page }) => {
  const now = NOW;
  await openFinds(page, [
    {
      id: 'long',
      stationId: 's1',
      track: 'Гражданская оборона — Всё идёт по плану, и это очень длинное название трека',
      stationName: 'Станция с очень длинным названием для проверки переполнения',
      timestamp: now - 3600_000
    },
    { id: 'short', stationId: 's2', track: 'Кино — Пачка сигарет', stationName: 'FIP', timestamp: now - 2 * DAY }
  ]);

  for (const width of [360, 390, 412]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(150);
    const worst = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-find-row]')] as HTMLElement[];
      let maxRight = 0;
      let ellipsised = true;
      for (const row of rows) {
        for (const control of row.querySelectorAll('[data-find-service], [data-find-more]')) {
          maxRight = Math.max(maxRight, Math.round(control.getBoundingClientRect().right));
        }
        const track = row.querySelector('.find-row-track') as HTMLElement;
        // The title must be CLAMPED, not allowed to set the row's width.
        if (track.scrollWidth > track.clientWidth + 1 && getComputedStyle(track).textOverflow !== 'ellipsis') {
          ellipsised = false;
        }
      }
      return { maxRight, viewport: window.innerWidth, ellipsised };
    });
    expect(
      worst.maxRight,
      `a control ends at ${worst.maxRight}px in a ${width}px viewport`
    ).toBeLessThanOrEqual(worst.viewport);
    expect(worst.ellipsised, 'a long title must ellipsis rather than widen the row').toBe(true);
  }
});

test('the controls are real 44x44 and steal nothing from the text', async ({ page }) => {
  await openFinds(page, makeFinds(12, NOW));
  for (const width of [360, 390, 412]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(150);
    const geom = await page.evaluate(() => {
      const row = document.querySelector('[data-find-row]') as HTMLElement;
      const svc = row.querySelector('[data-find-service]')!.getBoundingClientRect();
      const more = row.querySelector('[data-find-more]')!.getBoundingClientRect();
      const body = row.querySelector('.find-row-body')!.getBoundingClientRect();
      return {
        svc: { w: Math.round(svc.width), h: Math.round(svc.height) },
        more: { w: Math.round(more.width), h: Math.round(more.height) },
        overlapsText: svc.left < body.right - 1,
        controlsOverlap: more.left < svc.right - 1
      };
    });
    expect(geom.svc.w, `service width @${width}`).toBeGreaterThanOrEqual(44);
    expect(geom.svc.h, `service height @${width}`).toBeGreaterThanOrEqual(44);
    expect(geom.more.w, `kebab width @${width}`).toBeGreaterThanOrEqual(44);
    expect(geom.more.h, `kebab height @${width}`).toBeGreaterThanOrEqual(44);
    // 0.1a shipped 35px of hit area borrowed from a neighbour. Real geometry
    // means the boxes do not sit on the text or on each other.
    expect(geom.overlapsText, `a control sits over the text @${width}`).toBe(false);
    expect(geom.controlsOverlap, `the controls overlap @${width}`).toBe(false);
  }
});

test('search finds by track and by station, and says so when it finds nothing', async ({ page }) => {
  const now = NOW;
  await openFinds(page, [
    { id: 'a', stationId: 's1', track: 'Gnarls Barkley - Accept It', stationName: 'Radio Paradise', timestamp: now - 3600_000 },
    { id: 'b', stationId: 's2', track: 'Boards of Canada - Roygbiv', stationName: 'SomaFM Groove Salad', timestamp: now - 2 * DAY },
    { id: 'c', stationId: 's3', track: 'Кино - Пачка сигарет', stationName: 'Наше Радио', timestamp: now - 40 * DAY }
  ]);

  const search = page.locator('[data-finds-search]');
  await expect(findRows(page)).toHaveCount(3);

  // 4. by track
  await search.fill('roygbiv');
  await expect(findRows(page)).toHaveCount(1);
  await expect(findRows(page).first()).toContainText('Roygbiv');

  // 5. by station
  await search.fill('наше радио');
  await expect(findRows(page)).toHaveCount(1);
  await expect(findRows(page).first()).toContainText('Пачка сигарет');

  // Searching flattens: no time headings over a result set.
  expect(await page.locator('.finds-group-head').count()).toBe(0);

  await search.fill('zzzznothing');
  await expect(findRows(page)).toHaveCount(0);
  await expect(page.getByText('Ничего не нашли')).toBeVisible();

  // And clearing restores the grouped view.
  await search.fill('');
  await expect(findRows(page)).toHaveCount(3);
  expect(await page.locator('.finds-group-head').count()).toBeGreaterThan(0);
});

test('the first tap picks a service, the next tap does not ask again, and it survives a reload', async ({
  page
}) => {
  const finds = makeFinds(4, NOW);
  await openFinds(page, finds);

  // Keep the external navigation from actually leaving: we are testing the
  // choice, not the browser.
  await page.addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
  });
  await page.evaluate(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.open = ((url?: string | URL) => {
      (window as unknown as { __opened: string[] }).__opened.push(String(url));
      return null;
    }) as typeof window.open;
  });

  // 6. first tap raises the picker
  await page.locator('[data-find-service]').first().click();
  await expect(page.locator('[data-testid="finds-service-picker"]')).toBeVisible();
  await page.locator('[data-find-service-option="spotify"]').click();
  await expect(page.locator('[data-testid="finds-service-picker"]')).toHaveCount(0);

  // 8. the next tap opens straight away, no picker
  await page.locator('[data-find-service]').nth(1).click();
  await expect(page.locator('[data-testid="finds-service-picker"]')).toHaveCount(0);

  const stored = await page.evaluate(() => window.localStorage.getItem('radio:finds:service:v1'));
  expect(stored).toBe('spotify');

  // 7. and it survives a reload. ⚠ A second page in the same context, not
  // `page.reload()`: `seedRadioState` installs its fixture through
  // `addInitScript`, which runs again on every navigation and would rewrite
  // storage — the test would then measure the harness.
  const reopened = await page.context().newPage();
  await reopened.goto('/?api=/api&glass=full');
  await expect(reopened.locator('.app-shell-v2')).toBeVisible({ timeout: 15_000 });
  expect(await reopened.evaluate(() => window.localStorage.getItem('radio:finds:service:v1'))).toBe(
    'spotify'
  );
  await reopened.close();
});

test('«открыть в другом сервисе» is a one-off and does not move the default', async ({ page }) => {
  await openFinds(page, makeFinds(3, NOW));
  await page.evaluate(() => {
    window.localStorage.setItem('radio:finds:service:v1', 'yandex');
  });
  await page.reload();
  await expect(page.locator('[data-finds-search]')).toBeVisible({ timeout: 15_000 });

  await page.locator('[data-find-more]').first().click();
  await expect(page.locator('[data-testid="finds-row-menu"]')).toBeVisible();
  await page.locator('[data-find-open-other]').click();
  await expect(page.locator('[data-testid="finds-service-picker"]')).toBeVisible();
  await page.locator('[data-find-service-option="youtube"]').click();

  // 9. one curious tap must not redefine every future tap.
  expect(await page.evaluate(() => window.localStorage.getItem('radio:finds:service:v1'))).toBe(
    'yandex'
  );
});

test('a refused clipboard is visible to the person', async ({ page }) => {
  await openFinds(page, makeFinds(3, NOW));
  // ⚠ AFTER the fixture, not before. `installMediaMocks` defines a WORKING
  // `navigator.clipboard` through its own init script, and init scripts run in
  // registration order — so an override registered first is overwritten by the
  // fixture and this spec would quietly assert that a working clipboard works.
  // The first draft did exactly that and failed for the right reason.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) }
    });
  });

  await page.locator('[data-find-more]').first().click();
  await page.locator('[data-find-copy]').click();

  // 10. ⚠ What this replaced said NOTHING — not on failure and not on success.
  await expect(page.getByText('Не удалось скопировать')).toBeVisible({ timeout: 5_000 });
});

test('deleting asks first, and cancelling keeps the find', async ({ page }) => {
  await openFinds(page, makeFinds(3, NOW));
  await expect(findRows(page)).toHaveCount(3);

  await page.locator('[data-find-more]').first().click();
  await page.locator('[data-find-delete]').click();
  const confirm = page.locator('[data-testid="finds-delete-confirm"]');
  await expect(confirm).toBeVisible();
  // The confirm names the track, so a menu opened on the wrong row is visible
  // before anything is destroyed.
  await expect(confirm).toContainText('Artist 0 - Track 0');

  // 11. cancel keeps it
  await page.locator('[data-find-delete-cancel]').click();
  await expect(confirm).toHaveCount(0);
  await expect(findRows(page)).toHaveCount(3);
});

test('confirming deletes exactly the find that was chosen', async ({ page }) => {
  await openFinds(page, makeFinds(3, NOW));
  // The middle one, so an off-by-one takes a different row and is visible.
  await page.locator('[data-find-more]').nth(1).click();
  await page.locator('[data-find-delete]').click();
  await expect(page.locator('[data-testid="finds-delete-confirm"]')).toContainText('Artist 1 - Track 1');
  await page.locator('[data-find-delete-confirm]').click();

  // 12. exactly that one, and the others stay.
  await expect(findRows(page)).toHaveCount(2);
  await expect(page.locator('[data-finds-list]')).not.toContainText('Artist 1 - Track 1');
  await expect(page.locator('[data-finds-list]')).toContainText('Artist 0 - Track 0');
  await expect(page.locator('[data-finds-list]')).toContainText('Artist 2 - Track 2');
});

test('two hundred finds stay one page scroll with grouped headings', async ({ page }) => {
  await openFinds(page, makeFinds(204, NOW));

  const shape = await page.evaluate(() => {
    const list = document.querySelector('[data-finds-list]') as HTMLElement;
    const nested: string[] = [];
    list.querySelectorAll('*').forEach((node) => {
      const style = getComputedStyle(node as HTMLElement);
      if (/(auto|scroll)/.test(style.overflowY) && (node as HTMLElement).scrollHeight > (node as HTMLElement).clientHeight + 1) {
        nested.push((node as HTMLElement).className);
      }
    });
    return {
      rows: document.querySelectorAll('[data-find-row]').length,
      headings: document.querySelectorAll('.finds-group-head').length,
      nested,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });

  // 13. Every find is rendered — no hidden «…ещё 117», which was a mockup
  // device and never a product decision.
  expect(shape.rows).toBe(204);
  expect(shape.nested, 'nothing inside the list may scroll on its own').toEqual([]);
  expect(shape.overflowX, 'no horizontal overflow with a big library').toBeLessThanOrEqual(0);
  // Coarsening means a handful of headings, not one per day.
  expect(shape.headings).toBeGreaterThan(1);
  expect(shape.headings, 'headings must not become a second wall').toBeLessThan(12);
});

test('the Находки tab shows exactly ONE search field', async ({ page }) => {
  await openFinds(page, makeFinds(6, NOW));

  // ⚠ The defect on the real screen: «Поиск по медиатеке» and, directly under
  // it, «Поиск: исполнитель, трек, станция». Two near-identical fields with no
  // way to tell which searches what.
  await expect(page.locator('.library-search-bar')).toHaveCount(0);
  await expect(page.locator('[data-finds-search]')).toHaveCount(1);
  expect(await page.locator('input[type="search"]').count()).toBe(1);

  // And the shared search comes back on the other tabs, unchanged.
  await page.getByRole('tab', { name: 'Избранное' }).click();
  await expect(page.locator('.library-search-bar')).toHaveCount(1);
  await expect(page.locator('[data-finds-search]')).toHaveCount(0);
});

test('a library search does not follow you into the finds, or back out of them', async ({ page }) => {
  await openFinds(page, makeFinds(6, NOW));

  // Search the finds, then leave.
  await page.locator('[data-finds-search]').fill('Track 2');
  await expect(findRows(page)).toHaveCount(1);
  await page.getByRole('tab', { name: 'Избранное' }).click();

  // ⚠ The scenario the owner named: the station list must NOT come up filtered
  // by what was typed into the finds. Separate state, not a shared query.
  await expect(page.locator('.library-search-input')).toHaveValue('');

  // The reverse direction cannot be walked in the UI at all, and that is worth
  // recording rather than asserting something unreachable: while the shared
  // search holds a query the library replaces its TAB STRIP with results, so
  // there is no «Находки» tab to press. Verified here so a future change that
  // keeps the tabs visible during search has to come back and decide what the
  // finds tab does with a live library query.
  await page.locator('.library-search-input').fill('Radio Paradise');
  await expect(page.locator('.library-search-results')).toHaveCount(1);
  await expect(page.getByRole('tab', { name: 'Находки' })).toHaveCount(0);

  // Clear it and the tabs — and the finds, unfiltered — come back.
  await page.locator('.library-search-input').fill('');
  await page.getByRole('tab', { name: 'Находки' }).click();
  await expect(page.locator('.library-search-bar')).toHaveCount(0);
  await expect(findRows(page)).toHaveCount(6);
});

test('a row says only what its heading does not', async ({ page }) => {
  const now = NOW;
  await openFinds(page, [
    { id: 'today', stationId: 's1', track: 'Today Track', stationName: 'Radio Paradise', timestamp: now - 3600_000 },
    { id: 'old', stationId: 's2', track: 'Old Track', stationName: 'FIP', timestamp: now - 40 * DAY }
  ]);

  const sourceOf = (track: string) =>
    page.locator('[data-find-row]', { hasText: track }).locator('.find-row-source').innerText();

  // ⚠ Under «СЕГОДНЯ», printing «4 сент., 23:36» says the day twice. The clock
  // is what the heading has not already told you.
  const todayLine = await sourceOf('Today Track');
  expect(todayLine).toMatch(/^Radio Paradise · \d{1,2}:\d{2}$/);

  // A month bucket has no day in its heading, so the row keeps the date.
  const oldLine = await sourceOf('Old Track');
  expect(oldLine).toMatch(/\d/);
  expect(oldLine.length).toBeGreaterThan(todayLine.length - 'Radio Paradise'.length + 'FIP'.length);
});

test('the menu offers «в сервисе» before a default exists and «в другом» after', async ({ page }) => {
  await openFinds(page, makeFinds(3, NOW));

  // No preference yet — there is no «main» service, so nothing can be «other».
  await page.locator('[data-find-more]').first().click();
  await expect(page.locator('[data-find-open-other]')).toHaveText('Открыть в сервисе');
  await page.locator('[data-testid="finds-row-menu"] .finds-overlay-scrim').click();

  // Choose one, and the wording earns its «другом».
  await page.locator('[data-find-service]').first().click();
  await page.locator('[data-find-service-option="spotify"]').click();
  await page.locator('[data-find-more]').first().click();
  await expect(page.locator('[data-find-open-other]')).toHaveText('Открыть в другом сервисе');
});
