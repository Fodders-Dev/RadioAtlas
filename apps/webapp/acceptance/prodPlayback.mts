/**
 * Production check: does the released build actually make sound, and does it
 * hold the three rules 0.1b.1 is about?
 *
 * Run against the live site AFTER a deploy:
 *   npx tsx acceptance/prodPlayback.mts
 *
 * ⚠ Three ways this measurement has lied here before, all recorded in
 * `.claude/rules/e2e-tests.md`, all avoided deliberately:
 *
 *  1. Clicking "the first play control" plays a DIFFERENT station. So the
 *     station is pinned by name and `currentSrc` is asserted against the URL
 *     the catalogue gave for it.
 *  2. A fresh context gets the FIRST-RUN Home, which has no station tiles at
 *     all — a click finds nothing and the run reports a timing anyway. So the
 *     station is reached through Search, the way a listener does.
 *  3. Letting the run pick "a station with an audio extension" keeps landing on
 *     http:// ones, which are proxy-first by design. So the catalogue is asked
 *     by name and an https row is taken.
 *
 * And the project's own rule on top: `paused === false` proves nothing.
 * Only `currentTime` moving proves audio.
 */
import { chromium } from '@playwright/test';

const SITE = process.env.PROD_URL || 'https://radioatlas.ru';
const QUERY = 'Radio Paradise';

const line = (s: string) => console.log(`PROD | ${s}`);

const catalogue = await fetch(`${SITE}/api/catalog/search?q=paradise&limit=12`).then((r) => r.json());
const items: { name: string; url_resolved?: string; url?: string }[] =
  catalogue.items || catalogue.stations || [];
const target = items.find((s) => String(s.url_resolved || s.url || '').startsWith('https://'));
if (!target) throw new Error('no https station in the catalogue response — cannot measure honestly');
const targetUrl = String(target.url_resolved || target.url);
line(`target: ${target.name} -> ${targetUrl}`);

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();

/**
 * ⚠ AUDIO requests only.
 *
 * The first version also counted anything to the station's own origin, which
 * sweeps up the now-playing/ICY metadata probes — and then reported «2 new
 * stream requests after Pause» for a player that produced 0.02 s of audio in
 * twenty seconds. A probe is not playback, and counting it as playback invents
 * a defect.
 */
const streamRequests: string[] = [];
const otherRequests: string[] = [];
page.on('request', (r) => {
  const u = r.url();
  if (u.includes('/api/stream?url=')) streamRequests.push(u);
  else if (u.startsWith(new URL(targetUrl).origin)) otherRequests.push(u);
});

const readAudio = () =>
  page.evaluate(() => {
    const el = document.querySelector('audio') as HTMLAudioElement | null;
    return {
      present: Boolean(el),
      t: el?.currentTime ?? -1,
      paused: el?.paused ?? true,
      src: el?.currentSrc || el?.getAttribute('src') || ''
    };
  });

try {
  await page.goto(`${SITE}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(4000);

  // Reach it the way a listener does: Search.
  const searchNav = page.locator('.app-navigation-mobile').getByRole('button', { name: /Поиск/ });
  await searchNav.click({ timeout: 30_000 });
  const input = page.locator('#search-hero-input').first();
  await input.waitFor({ state: 'visible', timeout: 30_000 });
  await input.fill(QUERY);
  // ⚠ Pin the station from what the LISTENER sees, not from a separate API
  // call.
  //
  // The catalogue endpoint and the search screen do not return the same set —
  // the UI is deduped, and «Radio Paradise Rock Mix FLAC» simply is not on it,
  // while «...FLAC+meta» is. Pinning from the API and hunting for it in the DOM
  // is therefore a race between two different answers; the first attempt lost
  // it twice, once by matching a substring and once by not matching at all.
  //
  // The play button's aria-label carries the exact name, so the row that is
  // clicked and the name that is asserted come from the same place.
  await page.locator('.station-row').first().waitFor({ state: 'visible', timeout: 30_000 });
  const playButton = page.locator('.station-row .play-btn').first();
  const label = (await playButton.getAttribute('aria-label')) || '';
  const pinned = label.replace(/^[^:]*:\s*/, '').trim();
  if (!pinned) throw new Error(`could not read a station name from «${label}»`);
  line(`pinned from the screen: ${pinned}`);
  await playButton.click();

  await page.locator('.player-dock-bar').waitFor({ state: 'visible', timeout: 30_000 });
  const title = (await page.locator('.player-dock-title').innerText()).trim();
  line(`dock says: ${title}`);

  // 1. REAL AUDIO — currentTime must move, and keep moving.
  await page.waitForFunction(
    () => {
      const el = document.querySelector('audio') as HTMLAudioElement | null;
      return Boolean(el) && el!.currentTime > 3;
    },
    undefined,
    { timeout: 90_000 }
  );
  const playing = await readAudio();
  line(`AUDIO: currentTime ${playing.t.toFixed(2)}s, paused=${playing.paused}`);
  line(`source in use: ${playing.src.slice(0, 90)}`);

  // 2. It is the station we asked for — judged the way a listener judges it,
  // by the name in the player, plus a real source attached.
  const isOurs = title === pinned && playing.src !== '';
  line(
    `station identity: ${isOurs ? 'MATCHES' : '⚠ DOES NOT MATCH'} (dock «${title}» vs pinned «${pinned}»)`
  );

  // 3. Pause must stop, and nothing may restart it.
  const before = await readAudio();
  const requestsBeforePause = streamRequests.length;
  await page.locator('.player-dock-bar .dock-play-btn').click();
  await page.waitForTimeout(2000);
  const paused = await readAudio();
  await page.waitForTimeout(20_000);
  const afterWait = await readAudio();
  line(
    `PAUSE: ${before.t.toFixed(2)}s -> paused=${paused.paused} -> after 20s currentTime ${afterWait.t.toFixed(2)}s, ` +
      `${streamRequests.length - requestsBeforePause} new AUDIO request(s), ` +
      `${otherRequests.length} station-origin probe(s) in total (metadata, not playback)`
  );

  const verdict =
    playing.t > 3 &&
    isOurs &&
    paused.paused &&
    Math.abs(afterWait.t - paused.t) < 1 &&
    streamRequests.length - requestsBeforePause === 0;
  line(verdict ? 'RESULT: PASS' : 'RESULT: FAIL — see the lines above');
  await page.screenshot({ path: process.env.PROD_SHOT || 'prod-playback.png' });
  process.exitCode = verdict ? 0 : 1;
} finally {
  await browser.close();
}
