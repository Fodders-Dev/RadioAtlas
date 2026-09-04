import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

/**
 * The price of glass, charged in the only currency that matters here.
 *
 * The nav and the player bar were made nearly opaque once already, and the
 * reason is recorded in styles.css: at a 0.32 fill the nav read as transparent
 * and its labels mixed into whatever scrolled underneath. Making them glass
 * again re-opens exactly that risk, so it is measured rather than hoped for.
 *
 * ⚠ Measured on PIXELS, never from the DOM. A computed style reports the colour
 * a rule declared; it knows nothing about what a backdrop-filter put behind the
 * text, and this repo has already recorded a DOM-derived 1.10:1 for white type
 * that was perfectly readable. So: screenshot the strip, hand the PNG back to
 * the page, draw it on a canvas and read it.
 *
 * The floor is WCAG AA for normal text. It is a product contract, not a
 * tolerance to tune — if a future glass change fails this, the glass is wrong.
 */

const AA_NORMAL_TEXT = 4.5;

type Reading = { ratio: number; text: number; ground: number };

/**
 * Contrast inside one strip of the rendered page.
 *
 * Type on chrome is bimodal — near-white glyphs on a dark bar — so the brightest
 * few per cent of pixels are the text and the median is the surface behind it.
 * That is crude for a photograph and exactly right here.
 */
const measureStrip = async (page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<Reading> => {
  const shot = await page.screenshot({ clip });
  const dataUrl = `data:image/png;base64,${shot.toString('base64')}`;
  return page.evaluate(async (url) => {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);

    const channel = (value: number) => {
      const v = value / 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const luminances: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      luminances.push(
        0.2126 * channel(data[i]) + 0.7152 * channel(data[i + 1]) + 0.0722 * channel(data[i + 2])
      );
    }
    luminances.sort((a, b) => a - b);
    const brightest = luminances.slice(Math.floor(luminances.length * 0.96));
    const textLuminance = brightest.reduce((sum, v) => sum + v, 0) / brightest.length;
    // The ground is the strip's MEDIAN: the bar's own surface.
    //
    // Two other estimators were tried and both were wrong. The median alone,
    // with nothing behind the bar, does not bite — dropping the fill to 0.04
    // alpha changed nothing over a dark page. The 90th percentile does not
    // work either: this strip contains ICONS, and it read them as "bright
    // background", reporting 3.13:1 for chrome that is nearly opaque.
    //
    // What the contract actually says is that content passing behind the bar
    // must not wash the bar out. So the worst case is supplied behind it (see
    // openPlayingHome) and the median then measures exactly that: how much of
    // the bright band survived into the surface the labels sit on.
    const ground = luminances[Math.floor(luminances.length / 2)];
    const lighter = Math.max(textLuminance, ground);
    const darker = Math.min(textLuminance, ground);
    return { ratio: (lighter + 0.05) / (darker + 0.05), text: textLuminance, ground };
  }, dataUrl);
};

/**
 * ⚠ `power` is not a nicety — it is the reason this file was red in CI for five
 * days while passing on the developer's machine.
 *
 * `?glass=full` pins `data-glass` on <html>. It does NOT pin `data-low-power`,
 * which `main.tsx` derives separately from `getDeviceProfile()` and which
 * carries its own rules — two of them strip the chrome's `backdrop-filter` with
 * `!important`. So the tier was pinned and the OTHER core-count switch was not,
 * and the suite measured whichever app the hardware happened to produce:
 * `full` glass on a 12-core Windows box, blur-less on a 4-vCPU runner.
 *
 * A legibility gate whose subject depends on the machine cannot fail honestly,
 * so both states are now measured by name. Reduced motion is the deterministic
 * way in — `lowPower` is true for `prefers-reduced-motion`, a constrained
 * network, `hardwareConcurrency <= 4` or `deviceMemory <= 4` — and it is also a
 * real listener: anyone who turned motion down gets the blur-less chrome.
 */
const openPlayingHome = async (page: Page, power: 'normal' | 'low' = 'normal') => {
  if (power === 'low') await page.emulateMedia({ reducedMotion: 'reduce' });
  await installMediaMocks(page);
  await mockStations(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await seedRadioState(page, { playbackHistory: [stations[0]] });
  await page.goto('/?api=/api&glass=full');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible({ timeout: 20_000 });
  await page.locator('button.home-station-primary-action').first().click();
  await expect(page.locator('.player-dock')).toBeVisible({ timeout: 10_000 });
  // Content behind the chrome is the whole point: glass over an empty dark page
  // cannot fail a legibility check, so a test taken there would guard nothing.
  // The fixture's own page is mostly dark, so the worst case is supplied — a
  // bright band pinned exactly where the chrome sits. That is the contract:
  // the labels stay readable over ANY content, not merely over our own gaps.
  //
  // ⚠ The band goes inside .app-shell-v2, not on <body>. The shell declares
  // `isolation: isolate`, so it is its own stacking context: a fixed element
  // appended to the body sits ABOVE the whole app regardless of the nav's
  // z-index: 90, and the first version of this test measured the band itself
  // (text L=0.987 against ground L=0.932 — both of them the band).
  await page.evaluate(() => {
    const shell = document.querySelector('.app-shell-v2');
    if (!shell) throw new Error('no app shell to place the worst case behind');
    const band = document.createElement('div');
    band.id = 'legibility-worst-case';
    band.style.cssText = [
      'position: fixed',
      'left: 0',
      'right: 0',
      'bottom: 0',
      'height: 220px',
      'z-index: 0',
      'pointer-events: none',
      'background: linear-gradient(90deg, #fff8e1, #b6ff7a 25%, #7ad4ff 50%, #ffffff 75%, #ffe08a)'
    ].join(';');
    shell.appendChild(band);
    window.scrollBy(0, 240);
  });
  await page.waitForTimeout(600);
};

const stripOf = async (page: Page, selector: string) => {
  const box = await page.locator(selector).boundingBox();
  expect(box, `${selector} must be on screen to be measured`).not.toBeNull();
  return box!;
};

for (const power of ['normal', 'low'] as const) {
test(`the navigation labels stay readable through the glass (${power} power)`, async ({ page }) => {
  await openPlayingHome(page, power);
  // Fail loudly if the emulation stopped producing the state under test: a
  // silently-normal "low power" run would report a healthy number for a case
  // nobody measured.
  expect(
    await page.evaluate(
      () => (document.querySelector('.app-shell-v2') as HTMLElement)?.dataset.lowPower ?? null
    ),
    'the power state under test must actually be the one rendered'
  ).toBe(power === 'low' ? 'true' : 'false');
  const box = await stripOf(page, '.app-navigation-mobile');

  // The label row sits in the lower half of the bar, under the icons.
  const reading = await measureStrip(page, {
    x: Math.round(box.x),
    y: Math.round(box.y + box.height * 0.5),
    width: Math.round(box.width),
    height: Math.max(12, Math.round(box.height * 0.42))
  });

  // Printed on success too: a gate that only speaks when it fails hides how
  // close it was, and the margin is what tells you whether the next tweak is
  // safe.
  console.log(
    `nav labels (${power} power): ${reading.ratio.toFixed(2)}:1 (floor ${AA_NORMAL_TEXT}, text L=${reading.text.toFixed(3)}, ground L=${reading.ground.toFixed(3)})`
  );
  expect(
    reading.ratio,
    `nav labels measured ${reading.ratio.toFixed(2)}:1 at ${power} power (text L=${reading.text.toFixed(3)}, ground L=${reading.ground.toFixed(3)})`
  ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
});
}

for (const power of ['normal', 'low'] as const) {
test(`the station name on the player bar stays readable through the glass (${power} power)`, async ({ page }) => {
  await openPlayingHome(page, power);
  const box = await stripOf(page, '.player-dock-bar');

  // Skip the artwork square on the left and the transport buttons on the right;
  // both are bright and would flatter the reading.
  const reading = await measureStrip(page, {
    x: Math.round(box.x + 56),
    y: Math.round(box.y + 6),
    width: Math.max(40, Math.round(box.width - 56 - 130)),
    height: Math.max(12, Math.round(box.height * 0.45))
  });

  console.log(
    `dock title (${power} power): ${reading.ratio.toFixed(2)}:1 (floor ${AA_NORMAL_TEXT}, ground L=${reading.ground.toFixed(3)})`
  );
  expect(
    reading.ratio,
    `dock title measured ${reading.ratio.toFixed(2)}:1 at ${power} power (text L=${reading.text.toFixed(3)}, ground L=${reading.ground.toFixed(3)})`
  ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
});
}
