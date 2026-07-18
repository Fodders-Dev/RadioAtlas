import { expect, test } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState } from './helpers';

// Card chrome: where the play button sits, and when the station emblem shows.
//
// Both guard owner-reported regressions:
//  * the play button used to sit in the CORNER on desktop but dead-CENTRE on
//    narrow windows — the dense rule in home.css makes the action overlay a
//    full-width square with centred content, and overriding `inset` alone did
//    not undo that geometry;
//  * the emblem must appear only for stations that actually have a logo, never
//    as a placeholder letter.

test('play button stays in the top-right corner of the card at every width', async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page);

  for (const width of [320, 360, 390, 511, 719, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?api=/api');
    await expect(page.locator('[data-home-station]').first()).toBeVisible({ timeout: 15_000 });

    const geometry = await page.evaluate(() => {
      const tile = document.querySelector('[data-home-station]')!;
      const tileBox = tile.getBoundingClientRect();
      const play = tile.querySelector('.home-action-btn-play')!;
      const playBox = play.getBoundingClientRect();
      return {
        fromTop: Math.round(playBox.top - tileBox.top),
        fromRight: Math.round(tileBox.right - playBox.right),
        centred: Math.abs(playBox.left + playBox.width / 2 - (tileBox.left + tileBox.width / 2)) < 12,
        overhangsCard: playBox.bottom > tileBox.bottom + 1
      };
    });

    expect(geometry.centred, `play must not be centred at ${width}px`).toBe(false);
    expect(geometry.overhangsCard, `play must stay inside the card at ${width}px`).toBe(false);
    expect(geometry.fromTop, `play top offset at ${width}px`).toBeLessThanOrEqual(16);
    expect(geometry.fromRight, `play right offset at ${width}px`).toBeLessThanOrEqual(16);
  }
});

test('the station emblem renders over the scene only when the station has one', async ({
  page
}) => {
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?api=/api');
  await expect(page.locator('[data-home-station]').first()).toBeVisible({ timeout: 15_000 });

  // Every mocked station ships `favicon: ''`, so no card may show an emblem —
  // and crucially no card falls back to a placeholder initial either.
  const badges = page.locator('.home-station-logo');
  expect(await badges.count(), 'badge is rendered for every tile').toBeGreaterThan(0);
  await expect(badges.first()).toBeHidden();
  const anyVisible = await badges.evaluateAll((nodes) =>
    nodes.some((node) => getComputedStyle(node).display !== 'none')
  );
  expect(anyVisible, 'no emblem may show when no station has a logo').toBe(false);

  // Give one station a real logo → its badge appears, over the scene, and does
  // not cover the play button.
  const revealed = await page.evaluate(() => {
    const tile = document.querySelector('[data-home-station]')!;
    const badge = tile.querySelector<HTMLElement>('.home-station-logo')!;
    const img = document.createElement('img');
    img.src =
      'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiI+PHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSIjNjVlNGZmIi8+PC9zdmc+';
    badge.querySelector('span')?.remove();
    badge.appendChild(img);
    badge.setAttribute('data-has-image', 'true');
    const badgeBox = badge.getBoundingClientRect();
    const tileBox = tile.getBoundingClientRect();
    const playBox = tile.querySelector('.home-action-btn-play')!.getBoundingClientRect();
    const scene = tile.querySelector('.home-station-scene');
    return {
      visible: getComputedStyle(badge).display !== 'none',
      overlapsPlay: !(
        badgeBox.right < playBox.left ||
        badgeBox.left > playBox.right ||
        badgeBox.bottom < playBox.top ||
        badgeBox.top > playBox.bottom
      ),
      insideCard: badgeBox.left >= tileBox.left - 1 && badgeBox.top >= tileBox.top - 1,
      sceneStillPresent: Boolean(scene)
    };
  });

  expect(revealed.visible, 'a station with a logo shows its emblem').toBe(true);
  expect(revealed.overlapsPlay, 'the emblem must not collide with the play button').toBe(false);
  expect(revealed.insideCard).toBe(true);
  // The emblem sits ON the generated scene — it must not replace it.
  expect(revealed.sceneStillPresent).toBe(true);
});
