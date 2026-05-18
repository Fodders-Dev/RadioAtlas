import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

const openHome = async (page: Page) => {
  await installMediaMocks(page);
  await mockStations(page);
  // A seeded queue with a current station guarantees the home rails
  // render with a primed personal-radio module and a populated hero,
  // so `[data-home-rail]` containers exist and the first-N station
  // tiles are stable across hydration.
  await seedRadioState(page, {
    queue: stations.slice(0, 4)
  });
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible({
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

test('explicit "refresh feed" button still wires through to handleRefresh', async ({ page }) => {
  // Positive control for the freeze: if the rails are frozen on plays,
  // the user needs SOME path to fold the session bias back in. That
  // path is the home-refresh-chip on the hero card. We don't try to
  // observe the new rank order (small mock dataset, small chance of
  // visible reorder), but we DO observe that the chip enters its
  // `is-loading` state for the duration of the async handleRefresh
  // — proof the click reached refreshSummary(forceNetwork: true) and
  // the path is intact. homeState.sessionSeed is React-only transient
  // state and never persists to localStorage, so we can't read it
  // externally; the loading-state spinner is the externally visible
  // proxy.
  await openHome(page);

  // Trigger the play burst first so the snapshot rail state is the
  // "frozen post-play" shape — exactly what refresh is supposed to
  // fold the bias into.
  const firstRail = page.locator('[data-home-rail]').first();
  await firstRail.locator('[data-home-station]').first().locator('.home-action-btn-play').click();
  await page.waitForTimeout(300);

  const refreshButton = page.locator('.home-refresh-chip').first();
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
