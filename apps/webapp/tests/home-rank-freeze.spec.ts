import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

const openHome = async (page: Page) => {
  await installMediaMocks(page);
  await mockStations(page);
  // A seeded queue with a current station guarantees the Home rails render with
  // a populated resume context, so `[data-home-rail]` containers exist and the
  // first-N station tiles are stable across hydration.
  await seedRadioState(page, {
    queue: stations.slice(0, 4)
  });
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible({
    timeout: 15_000
  });
  await expect(page.locator('[data-home-rail]').first()).toBeVisible({
    timeout: 15_000
  });
};

const captureRailFingerprint = (page: Page) =>
  page.evaluate(() => {
    const rails = Array.from(document.querySelectorAll<HTMLElement>('[data-home-rail]'));
    return rails.map((rail) => ({
      id: rail.getAttribute('data-home-rail') || '',
      stations: Array.from(rail.querySelectorAll<HTMLElement>('[data-home-station]'))
        .slice(0, 4)
        .map((tile) => tile.getAttribute('data-home-station') || '')
    }));
  });

test('home rails do NOT re-shuffle after a click → play burst', async ({ page }) => {
  await openHome(page);

  // Capture the visible rail order BEFORE any user action. This is
  // the post-mount frozen rank; the assertion below proves it survives
  // a full play burst (play-started + play-success session events,
  // addRecent, recordBehaviorForStation, recordTasteForStation, etc.
  // — eight-ish flips of live state inside one click) instead of
  // re-ranking under the user's finger.
  //
  // T_audit_9 churn-guard: this is now ALSO the regression guard for eager
  // taste. A `play-started` (+1.71 to one tag) is too small to reorder the
  // top-N tags, so tasteSignature is stable → the snapshot stays frozen → no
  // re-shuffle. The companion test below proves the OTHER direction: a `liked`
  // (+11.4) does change the signature and re-ranks fresh-now.
  const before = await captureRailFingerprint(page);
  expect(before.length).toBeGreaterThan(0);
  expect(before[0]?.stations.length ?? 0).toBeGreaterThan(0);

  // Click the play button on the first station tile of the first rail.
  // That's exactly the action the user reported as the trigger
  // ("click play → list shuffles under my finger").
  const firstRail = page.locator('[data-home-rail]').first();
  const firstTile = firstRail.locator('[data-home-station]').first();
  await firstTile.locator('.home-action-btn-play').click();
  await page.waitForTimeout(600);

  const after = await captureRailFingerprint(page);
  // A play action can legitimately MOUNT new rails (e.g. "Resume"
  // pops in once player.current is set and the resume module sees
  // it). What it must NOT do is REORDER the first-4 of a rail that
  // was already on screen — that's the user-reported jump. Compare
  // only rails that survived from `before` to `after`.
  const beforeById = new Map(before.map((rail) => [rail.id, rail.stations]));
  for (const rail of after) {
    const beforeStations = beforeById.get(rail.id);
    if (!beforeStations) continue; // rail mounted post-play, ignore
    expect(
      rail.stations,
      `rail "${rail.id}" first-4 stations re-shuffled after play; ` +
        `before=${beforeStations.join(',')} after=${rail.stations.join(',')}`
    ).toEqual(beforeStations);
  }
  // Sanity: at least one rail survived; otherwise we're not testing
  // anything.
  const survived = after.filter((rail) => beforeById.has(rail.id));
  expect(survived.length).toBeGreaterThan(0);
});

test('T_audit_9: a like re-ranks fresh-now within the session bucket (eager taste)', async ({
  page
}) => {
  await openHome(page);

  const freshNow = page.locator('[data-home-rail="fresh-now"]');
  await expect(freshNow).toBeVisible({ timeout: 15_000 });
  const freshNowIds = () =>
    freshNow
      .locator('[data-home-station]')
      .evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute('data-home-station') || ''));

  const before = await freshNowIds();
  expect(before.length, 'fresh-now renders at least two tiles').toBeGreaterThanOrEqual(2);

  // Like every fresh-now tile EXCEPT the leader. These are in-rail stations
  // (not blocked by the personal-radio queue), so a +12 `liked` — fired by the
  // heart button via recordTasteForStation('liked'), pushing each station's own
  // score and tag well past the signature threshold — must pull a non-leading
  // station to the front, re-ranking the rail. Pre-fix the snapshot froze on
  // the bucket seed and ignored the taste change, so fresh-now stayed
  // byte-identical — that's the red side of the red→green.
  const tiles = freshNow.locator('[data-home-station]');
  const tileCount = await tiles.count();
  let liked = 0;
  for (let i = 1; i < tileCount; i += 1) {
    const likeBtn = tiles.nth(i).locator('.home-action-btn-like');
    if ((await likeBtn.count()) === 0) continue;
    await likeBtn.click();
    liked += 1;
    await page.waitForTimeout(60);
  }
  expect(liked, 'liked at least one non-leading fresh-now tile').toBeGreaterThanOrEqual(1);

  // Eager propagation: fresh-now must re-rank WITHOUT a manual refresh and
  // WITHOUT a session-bucket flip — on the next render after the like.
  await expect
    .poll(async () => JSON.stringify(await freshNowIds()), { timeout: 5000 })
    .not.toBe(JSON.stringify(before));
});

test('explicit "refresh feed" button still wires through to handleRefresh', async ({ page }) => {
  // Positive control for the freeze: if the rails are frozen on plays,
  // the user needs SOME path to fold the session bias back in. That
  // path is the .home-surface-refresh icon-button above the Feed hero.
  // We don't try to observe the new rank order (small
  // mock dataset, small chance of visible reorder), but we DO observe
  // that the button enters its `is-loading` state for the duration of
  // the async handleRefresh — proof the click reached
  // refreshSummary(forceNetwork: true) and the path is intact.
  // homeState.sessionSeed is React-only transient state and never
  // persists to localStorage, so we can't read it externally; the
  // loading-state spinner is the externally visible proxy.
  await openHome(page);

  // Trigger the play burst first so the snapshot rail state is the
  // "frozen post-play" shape — exactly what refresh is supposed to
  // fold the bias into.
  const firstRail = page.locator('[data-home-rail]').first();
  await firstRail.locator('[data-home-station]').first().locator('.home-action-btn-play').click();
  await page.waitForTimeout(300);

  const refreshButton = page.locator('.home-surface-refresh').first();
  await expect(refreshButton).toBeVisible({ timeout: 5000 });

  // Slow refreshSummary down so the loading class is observable. The
  // catalog summary endpoint is mocked by mockStations; we re-route
  // it to a slow handler just for this test so the transition through
  // `setRefreshing(true)` is catchable in Playwright's polling.
  await page.route('**/catalog/summary**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        counts: { stations: 12, countries: 3, languages: 3, genres: 4 },
        catalogPool: [],
        freshSignals: [],
        generatedAt: Date.now()
      })
    });
  });

  await refreshButton.click();
  await expect(refreshButton).toHaveClass(/is-loading/, { timeout: 1000 });
});
