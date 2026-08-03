import { expect, test } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState } from './helpers';

/**
 * "I like this track — open it in my music service" is a thought you have WHILE
 * it plays. The links existed, but only inside Lira's chat, so reaching them
 * meant leaving the player and asking. They are pure search urls, so the player
 * builds them itself — no network, no assistant.
 *
 * The track row also used to copy the title on tap with nothing on screen saying
 * so. Copying is now a visible row in the same sheet.
 */
const openFullPlayer = async (page: import('@playwright/test').Page) => {
  await page.locator('#search-hero-input').first().fill('Tokyo');
  await expect(page.locator('[data-search-station-card]').first()).toBeVisible();
  await page.getByRole('button', { name: /Играть выдачу|Play results/ }).click();
  await expect(page.locator('.player-dock-bar')).toBeVisible();
  await page
    .locator('.player-dock-artwork-trigger')
    .evaluate((node) => (node as HTMLButtonElement).click());
  await expect(page.locator('[data-full-player-overlay]')).toBeVisible();
  await page.waitForTimeout(400);
};

test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page, { activeSection: 'search' });
  await page.goto('/?api=/api');
});

test('the track row opens every music service plus copy', async ({ page }) => {
  await openFullPlayer(page);
  await page.locator('[data-full-player-track]').click();

  const sheet = page.locator('.full-player-sheet');
  await expect(sheet).toBeVisible();

  const rows = await sheet.locator('.full-player-action-row span').allInnerTexts();
  expect(rows).toEqual([
    'Яндекс Музыка',
    'Звук',
    'VK Музыка',
    'Spotify',
    'SoundCloud',
    'YouTube',
    'Копировать трек'
  ]);
});

test('a service row carries a real search url for the track on air', async ({ page }) => {
  await openFullPlayer(page);
  const track = (await page.locator('[data-full-player-track] span').first().innerText()).trim();
  expect(track.length).toBeGreaterThan(0);

  // The sheet opens links through Telegram's openLink when present, so assert on
  // what the app would hand over rather than on a navigation.
  await page.evaluate(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    (window as unknown as { Telegram?: unknown }).Telegram = {
      WebApp: { openLink: (url: string) => (window as unknown as { __opened: string[] }).__opened.push(url) }
    };
  });

  await page.locator('[data-full-player-track]').click();
  await page.locator('.full-player-action-row', { hasText: 'Яндекс Музыка' }).click();

  const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
  expect(opened).toHaveLength(1);
  expect(opened[0]).toContain('music.yandex.ru/search?text=');
  // A SEARCH page for the actual title — never a guessed track id.
  expect(decodeURIComponent(opened[0]!)).toContain(track.split(' - ')[0]!.slice(0, 12));
});

/**
 * Caught on production, not by this suite: the fixtures always carry a track, so
 * nothing exercised the ~90% of stations that never send ICY. The sheet offered
 * all six services anyway and Yandex Music searched for the literal placeholder
 * «Название трека пока недоступно» — the links were built from the DISPLAY
 * string, which already has the fallback substituted in.
 */
test('a station with no track metadata offers no search at all', async ({ page }) => {
  // Later routes win in Playwright, so this overrides the fixture's Mock Song.
  await page.route('**/metadata?url=**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ title: '', logs: [], source: 'test' })
    })
  );
  await page.route('**/status-json.xsl', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ icestats: {} }) })
  );
  await page.route('**/fetch?url=**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: '' })
  );

  await openFullPlayer(page);

  const row = page.locator('[data-full-player-track]');
  // The line no longer apologises. About 40% of stations never send a title, so
  // it falls to what IS true about this one — its genre, or «Прямой эфир» when
  // even that is unknown. What must NOT change is that there is nothing here to
  // search for: the button stays dead and the sheet never opens.
  await expect(row).not.toContainText(/недоступно|unavailable/i);
  await expect(row).toHaveText(/\S/);
  await expect(row).toBeDisabled();

  // And nothing opens if the tap lands anyway.
  await row.click({ force: true });
  await expect(page.locator('.full-player-sheet')).toHaveCount(0);
});

test('after a long silent stretch the player says the station sends no titles', async ({ page }) => {
  // ⚠ This needs controllable time: the note is deliberately withheld for 75
  // seconds so a station between records is never accused. It also needs real
  // playback — the note is gated on audio actually playing, because two
  // different metadata branches produce an identical "unavailable" snapshot and
  // only one of them means "we listened and nothing came".
  await page.clock.install();
  await page.route('**/metadata?url=**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ title: '', logs: [], source: 'test' })
    })
  );
  await page.route('**/status-json.xsl', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ icestats: {} }) })
  );
  await page.route('**/fetch?url=**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: '' })
  );

  await openFullPlayer(page);

  const note = page.locator('.full-player-onair-note');

  // Not on arrival, and not at half a minute: a station between records must
  // never be accused of never naming anything.
  await expect(note).toHaveCount(0);
  await page.clock.fastForward(30_000);
  await expect(note).toHaveCount(0);

  // ⚠ Two jumps, not one, and the total is not the assertion. `fastForward`
  // fires the timers that were already armed; the countdown is only armed once
  // the app itself settles into "playing", which happens across a render after
  // the first jump. A single long jump therefore proves nothing (verified: 200s
  // in one go leaves the note absent, 90s twice shows it). What this test does
  // guarantee is the pair that matters — withheld early, shown eventually.
  await page.clock.fastForward(90_000);
  await page.waitForTimeout(300);
  await page.clock.fastForward(90_000);

  await expect(note).toHaveText(/не переда|does not send/i);
  // It explains the line above without competing with it.
  await expect(page.locator('[data-full-player-track]')).not.toContainText(/не переда|does not send/i);
});

test('a junk title the trust filter rejects leaves no live copy button', async ({ page }) => {
  // ⚠ The regression this guards: everything the listener SEES goes through the
  // station-aware trust filter, but `canCopyTrack` used to read the RAW value.
  // A station broadcasting its own ident — very common — therefore showed «нет
  // названия» under a lit button that led nowhere. Tightening the filter (#252)
  // made the state MORE common, so the two now read one value.
  await page.route('**/metadata?url=**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      // Rejected by trackTrust: an HTML fragment, seen in production on
      // NewDanceRadio.
      body: JSON.stringify({ title: 'whois"> <meta content="text/html"', logs: [], source: 'test' })
    })
  );
  await page.route('**/status-json.xsl', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ icestats: {} }) })
  );
  await page.route('**/fetch?url=**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: '' })
  );

  await openFullPlayer(page);

  const row = page.locator('[data-full-player-track]');
  await expect(row).not.toContainText(/whois|meta content/i);
  await expect(row).toBeDisabled();
  await row.click({ force: true });
  await expect(page.locator('.full-player-sheet')).toHaveCount(0);
});
