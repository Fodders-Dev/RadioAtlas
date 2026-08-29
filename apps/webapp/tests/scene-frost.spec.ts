import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

/**
 * The frosted snapshot must actually be produced, and its failure mode is
 * silence.
 *
 * `lib/scenePlate.ts` blurs the scene behind a tile's play control once, in a
 * canvas, and hands it over as a background image — the whole reason this app
 * can have glass on a mid-range phone without paying a render pass per element
 * per frame (143 blurs cost 10780ms of GPU compositor thread against 3378ms
 * now, with dropped frames at 8.5% against 0.6%).
 *
 * Every way it can break is quiet. A canvas that turns out tainted, a scene
 * moved to another origin, an image element that stops firing load, a rename of
 * the custom property — each one leaves an app that still renders, still plays,
 * and simply shows a flat coin where the glass was. Nobody would file that.
 *
 * The shared fixture answers the scene endpoint with `unavailable` on purpose,
 * to keep the visual baselines deterministic, so this spec brings its own
 * picture: a real gradient, because a flat colour could pass while the sampling
 * was broken.
 */

const SCENE_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAQDAwMDAgQDAwMEBAQFBgoGBgUFBgwICQcKDgwPDg4MDQ0PERYTDxAVEQ0NExoTFRcYGRkZDxIbHRsYHRYYGRj/2wBDAQQEBAYFBgsGBgsYEA0QGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBj/wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDzuOD2q3HB7VYjg9qtxwe1fr2Orbnw+AxGxWjg9qtxwe1WI4ParccHtXx+Orbn22AxGxXjg9qtxwe1WI4ParUcHtXx+Orbn2uAxGxXjg9qtxwe1WI4ParccHtXx+Orbn2uAxGxw8cHtVqOD2qxHB7Vbjg9q/e8dW3P5FwGI2K8cHtVuOD2qxHB7Vbjg9q+Px1bc+1wGI2K0cHtVuOD2qxHB7Vbjg9q+Px1bc+1wGI2K8cHtVuOD2qxHB7Vajg9q+Px1bc+1wGI2OHjg9qtxwe1WI4ParccHtX73jq25/IuAxGxXjg9qtRwe1WI4ParccHtXx+Orbn2uAxGxXjg9qtxwe1WI4ParccHtXx+Orbn2uAxGxWjg9qtxwe1WI4ParccHtXx2OrH22AxGxw8cHtVqOD2qzHB7Vajg9q/fMdW3P5EwGI2K8cHtVuOD2qxHB7Vbjg9q+Ox1bc+1wGI2K8cHtVqOD2qxHB7Vbjg9q+Px1bc+2wGI2K8cHtVuOD2qxHB7Vbjg9q+Px1bc+1wGI2P/9k=',
  'base64'
);

const openHomeWithScenes = async (page: Page) => {
  // Registered AFTER mockStations, so it wins over the `unavailable` stub.
  await page.route('**/artwork/scene/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ready', url: '/api/artwork/scenes/test-scene.jpg' })
    })
  );
  await page.route('**/artwork/scenes/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: SCENE_JPEG })
  );
  await seedRadioState(page, { playbackHistory: [stations[0]] });
  await page.goto('/?api=/api&glass=lite');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible({ timeout: 15_000 });
};

test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await page.setViewportSize({ width: 390, height: 844 });
});

test('a tile with a scene gets a frosted snapshot, not just a flat plate', async ({ page }) => {
  await openHomeWithScenes(page);

  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            Array.from(document.querySelectorAll('.home-station-tile')).filter((tile) =>
              (tile as HTMLElement).style.getPropertyValue('--station-frost')
            ).length
        ),
      { timeout: 20_000, message: 'no tile ever received --station-frost' }
    )
    .toBeGreaterThan(0);

  const painted = await page.evaluate(() => {
    const tile = Array.from(document.querySelectorAll('.home-station-tile')).find((node) =>
      (node as HTMLElement).style.getPropertyValue('--station-frost')
    ) as HTMLElement | undefined;
    if (!tile) return null;
    const control = tile.querySelector('.home-action-btn');
    return {
      frost: tile.style.getPropertyValue('--station-frost'),
      plate: tile.style.getPropertyValue('--station-plate'),
      backgroundImage: control ? getComputedStyle(control).backgroundImage : null
    };
  });

  expect(painted).not.toBeNull();
  // A real encoded picture, not an empty string that happens to be truthy.
  expect(painted!.frost).toMatch(/^url\("data:image\/jpeg;base64,/);
  expect(painted!.frost.length).toBeGreaterThan(200);
  // And the CONTROL has to be wearing it — the variable being set is only half
  // the chain, and the CSS half is the half that a rename would break.
  expect(painted!.backgroundImage).toContain('data:image/jpeg;base64,');
  // The flat plate stays underneath as the fallback, so a tile that never gets
  // a frost is still a designed control rather than bare artwork.
  expect(painted!.plate).toMatch(/^hsla\(/);
});

test('the frost only runs where it is used: `full` keeps the real blur and paints no snapshot', async ({ page }) => {
  await page.route('**/artwork/scene/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ready', url: '/api/artwork/scenes/test-scene.jpg' })
    })
  );
  await page.route('**/artwork/scenes/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: SCENE_JPEG })
  );
  await seedRadioState(page, { playbackHistory: [stations[0]] });
  await page.goto('/?api=/api&glass=full');
  await expect(page.locator('.home-action-btn').first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(3000);

  const state = await page.evaluate(() => ({
    frosted: Array.from(document.querySelectorAll('.home-station-tile')).filter((tile) =>
      (tile as HTMLElement).style.getPropertyValue('--station-frost')
    ).length,
    controlBlur: getComputedStyle(document.querySelector('.home-action-btn')!).backdropFilter
  }));

  // A phone that can afford the real frost should not pay for a canvas read it
  // will never look at.
  expect(state.frosted).toBe(0);
  expect(state.controlBlur).toContain('blur');
});
