import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, playHomeStation, seedRadioState } from './helpers';

/**
 * Saved means saved — the promise, checked in a browser.
 *
 * Two states this pins, both of which the app used to get wrong in silence:
 *
 * A. Saved. The find survives a reload, which is the only proof that it reached
 *    storage rather than living in React state until the next navigation.
 * C. NOT saved. Storage refused, so «Находка сохранена» would be a lie. Before
 *    0.1b.0 `usePersistentState` swallowed the failure with a bare `catch {}`,
 *    the toast said saved, and the find was gone on the next load.
 *
 * State B — saved locally, cloud sync failed — needs an authenticated session
 * and lives with the account specs.
 */

const openWithTrack = async (page: Page) => {
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page);
  await page.goto('/?api=/api&glass=full');
  await playHomeStation(page, 'Tokyo FM');
  await expect(page.locator('[data-capture-find]')).toBeVisible({ timeout: 15_000 });
};

const storedFinds = (page: Page) =>
  page.evaluate(() => {
    try {
      const raw = window.localStorage.getItem('radio:library:v2');
      if (!raw) return 0;
      return (JSON.parse(raw).trackHistory || []).length as number;
    } catch {
      return -1;
    }
  });

test('a caught find is still there after a reload', async ({ page }) => {
  await openWithTrack(page);
  await page.locator('[data-capture-find]').click();
  await expect.poll(() => storedFinds(page), { timeout: 10_000 }).toBe(1);

  // ⚠ NOT `page.reload()`. `seedRadioState` installs its fixture through
  // `addInitScript`, which runs again on every navigation — a reload rewrites
  // `radio:library:v2` with the empty seed, and the test then measures the
  // harness instead of the product. A second page in the same context shares
  // the origin's storage and does NOT inherit the first page's init scripts.
  const reopened = await page.context().newPage();
  await reopened.goto('/?api=/api&glass=full');
  await expect(reopened.locator('.app-shell-v2')).toBeVisible({ timeout: 15_000 });

  // The find outlived the page, which is the whole claim behind the word.
  // Storage is the claim under test. Whether the Треки tab renders it is a
  // different assertion living in the library specs — asserting it here would
  // have made a persistence test fail for a navigation reason, which is how the
  // first draft of this line went red.
  expect(await storedFinds(reopened)).toBe(1);
  await reopened.close();
});

test('a refused storage says so instead of claiming the find was saved', async ({ page }) => {
  // A phone viewport, because the assertion below walks the mobile navigation
  // and `.app-navigation-mobile` does not render at Playwright's 1280 default.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    // A full quota is the real shape of this: Safari and mobile WebViews throw
    // QuotaExceededError from setItem once the origin's budget is gone, and a
    // private window can throw on the first write.
    const original = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.setItem = (key: string, value: string) => {
      if (key === 'radio:library:v2') {
        const error = new Error('QuotaExceededError');
        error.name = 'QuotaExceededError';
        throw error;
      }
      original(key, value);
    };
  });
  await openWithTrack(page);

  await page.locator('[data-capture-find]').click();

  // ⚠ The defect: before 0.1b.0 this path showed «Находка сохранена» and said
  // nothing else, so the person learned about the loss on their next visit —
  // if they ever noticed at all.
  await expect(page.getByText(/Не удалось сохранить находку|Could not save the find/i)).toBeVisible({
    timeout: 10_000
  });

  // And the storage genuinely holds nothing, so the message is the truth rather
  // than a second guess about what happened.
  expect(await storedFinds(page)).toBe(0);

  // ⚠ The temporary lie, and the reason this assert exists: `setTrackHistory`
  // puts the find into React state immediately while the write is debounced and
  // fails afterwards. Without a rollback the toast says «не удалось сохранить»
  // and the find sits in «Треки» looking saved until the next reload takes it.
  await page.locator('.app-navigation-mobile button', { hasText: 'Моё' }).click();
  await page.locator('button', { hasText: 'Треки' }).first().click();
  await expect(page.locator('.track-list')).toHaveCount(0);
});
