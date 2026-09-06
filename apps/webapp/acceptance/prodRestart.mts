/**
 * Production check for 0.1b.2: does a full restart bring the station back,
 * silently, with a working Play?
 *
 *   npx tsx acceptance/prodRestart.mts
 *
 * ⚠ The station is taken FROM THE SCREEN (the play button's `aria-label`), not
 * from the catalogue API — the showcase is deduplicated and the two disagree.
 * And `paused === false` proves nothing here either: the whole point is that
 * `currentTime` must NOT move after the reload until a press.
 */
import { chromium } from '@playwright/test';

const SITE = process.env.PROD_URL || 'https://radioatlas.ru';
const line = (s: string) => console.log(`PROD | ${s}`);

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();

const audioRequests: string[] = [];
page.on('request', (r) => {
  if (r.url().includes('/api/stream?url=')) audioRequests.push(r.url());
});

const readAudio = () =>
  page.evaluate(() => {
    const el = document.querySelector('audio') as HTMLAudioElement | null;
    return { t: el?.currentTime ?? -1, paused: el?.paused ?? true, src: el?.currentSrc || '' };
  });

const dock = () =>
  page.evaluate(() => {
    const bar = document.querySelector('.player-dock-bar');
    const play = bar?.querySelector('.dock-play-btn') as HTMLButtonElement | null;
    return {
      present: Boolean(bar),
      title: bar?.querySelector('.player-dock-title')?.textContent?.trim() ?? null,
      playLabel: play?.getAttribute('aria-label') ?? null,
      disabled: play?.disabled ?? null,
      pill: bar?.querySelector('.player-dock-status-pill')?.textContent?.trim() ?? null,
      dockAttr: document.querySelector('.app-shell-v2')?.getAttribute('data-dock') ?? null
    };
  });

let ok = true;
const check = (label: string, pass: boolean, detail: string) => {
  if (!pass) ok = false;
  line(`${pass ? 'PASS' : '⚠ FAIL'} — ${label}: ${detail}`);
};

try {
  /**
   * ⚠ Retry the FIRST navigation, and only that one.
   *
   * Measured 06.09.2026: the route from this developer machine to the
   * production host drops intermittently — 4 of 6 `curl`s answered in ~0.12 s
   * and 2 timed out, while `uptime.yml` from GitHub's network was 6 of 6 green.
   * The site is fine; the path from here is not. Without this retry the check
   * reports a production failure that is really a local one — and a false alarm
   * about production is worse than no check.
   *
   * Only the first `goto` retries. Anything failing AFTER the app has loaded is
   * a real result and must be reported as one.
   */
  let loaded = false;
  for (let attempt = 1; attempt <= 5 && !loaded; attempt += 1) {
    try {
      await page.goto(`${SITE}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      loaded = true;
    } catch (error) {
      // No escape sequences here on purpose: this file is edited from a shell
      // layer that halves backslashes, and a `\n` written through it lands as a
      // real newline inside the string literal. Slice instead of split.
      line(`reaching ${SITE} failed (attempt ${attempt}/5): ${String(error).slice(0, 90)}`);
      await page.waitForTimeout(3000);
    }
  }
  if (!loaded) throw new Error(`could not reach ${SITE} in 5 attempts — check the local route first`);
  await page.waitForTimeout(4000);
  await page.locator('.app-navigation-mobile').getByRole('button', { name: /Поиск/ }).click();
  const input = page.locator('#search-hero-input').first();
  await input.waitFor({ state: 'visible', timeout: 30_000 });
  await input.fill('Radio Paradise');
  await page.locator('.station-row').first().waitFor({ state: 'visible', timeout: 30_000 });
  const playButton = page.locator('.station-row .play-btn').first();
  const pinned = ((await playButton.getAttribute('aria-label')) || '').replace(/^[^:]*:\s*/, '').trim();
  line(`pinned from the screen: ${pinned}`);
  await playButton.click();

  await page.waitForFunction(
    () => {
      const el = document.querySelector('audio') as HTMLAudioElement | null;
      return Boolean(el) && el!.currentTime > 3;
    },
    undefined,
    { timeout: 90_000 }
  );
  line(`on air: currentTime ${(await readAudio()).t.toFixed(2)}s`);

  // The debounced write has to land, or the reload measures nothing.
  await page.waitForTimeout(3000);

  // ------------------------------ THE RESTART ------------------------------
  const requestsBefore = audioRequests.length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.app-shell-v2').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(5000);

  const restored = await dock();
  check('the station comes back', restored.present && restored.title === pinned, `«${restored.title}»`);
  check('offering Play, not Pause', restored.playLabel === 'Слушать', `«${restored.playLabel}»`);
  check('and pressable', restored.disabled === false, String(restored.disabled));
  check('saying nothing untrue', restored.pill === null, restored.pill ?? 'no pill');
  check('with room reserved', restored.dockAttr === 'bar', String(restored.dockAttr));

  // 30 s of proven silence.
  await page.waitForTimeout(30_000);
  const idle = await readAudio();
  check(
    '30s silent before any press',
    audioRequests.length === requestsBefore && idle.t < 0.05,
    `${audioRequests.length - requestsBefore} audio request(s), currentTime ${idle.t.toFixed(2)}, src=${idle.src ? 'attached' : 'empty'}`
  );

  // One press continues.
  await page.locator('.player-dock-bar .dock-play-btn').click();
  await page.waitForFunction(
    () => {
      const el = document.querySelector('audio') as HTMLAudioElement | null;
      return Boolean(el) && el!.currentTime > 3;
    },
    undefined,
    { timeout: 90_000 }
  );
  const after = await dock();
  check(
    'one press continues the SAME station',
    after.title === pinned && (await readAudio()).t > 3,
    `«${after.title}», currentTime ${(await readAudio()).t.toFixed(2)}s`
  );

  line(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
  await page.screenshot({ path: process.env.PROD_SHOT || 'prod-restart.png' });
  process.exitCode = ok ? 0 : 1;
} finally {
  await browser.close();
}
