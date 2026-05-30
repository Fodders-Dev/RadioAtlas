import { expect, test } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState } from './helpers';

// T_deeplink_lifecycle_fix: a station shared via deep link (?startapp=station_<uuid>)
// opened the Mini App but never played — the dock stayed on "Выбери станцию".
// Telemetry (PR #41) proved the async play hit a `cancelled` guard: the deep-link
// effect depended on [fetchStationById, playStation, t], whose identities change
// during boot re-renders (and under StrictMode's dev remount), so the effect
// re-ran, its cleanup cancelled the in-flight fetch, and the re-run bailed via
// startHandledRef without restarting → the play was permanently abandoned.
//
// The fix runs the effect once on mount (deps []), reads the handlers from a ref,
// and keeps NO cancelling cleanup. This test cold-boots a deep link and asserts
// the station is actually selected (the dock shows it) — RED on the old effect
// (the boot re-renders / StrictMode remount cancel the play), GREEN on the fix.
test('a deep-linked station resolves and plays despite boot re-renders', async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page); // /catalog/stations/** → { item: Tokyo FM }
  await seedRadioState(page);

  // Cold boot carrying the deep-link start param (getStartParam reads `startapp`).
  await page.goto('/?api=/api&startapp=station_uuid-tokyo');

  // The deep link must SELECT the station — the dock leaves the empty
  // "Выбери станцию" state and shows the resolved station. The old effect never
  // got here (cancelled before playStation).
  await expect(page.locator('.player-dock-title')).toContainText('Tokyo FM', {
    timeout: 15_000
  });
});
