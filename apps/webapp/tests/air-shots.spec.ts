import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

/**
 * Full mobile Home in the REAL app, for review. Not a gate — air-block.spec.ts
 * is the gate.
 *
 * Review-only, because producing PNGs is not something CI needs to spend time
 * on:  AIR_SHOTS=1 npx playwright test tests/air-shots.spec.ts
 *
 * ⚠ PNGs are written OUTSIDE apps/webapp: a file written under the Vite root is
 * a change the dev server watches, and it answers with an HMR reload in the
 * middle of the run.
 *
 * ⚠ What is real and what is not, so a screenshot is not read as more than it
 * is. REAL: the components, the theme tokens, the player state machine, the
 * ladder, the layout at a Samsung-sized viewport. MOCKED: the catalogue (three
 * fixture stations from helpers.ts), the now-playing metadata («Mock Song»),
 * and the audio itself — `installMediaMocks` serves a silent WAV and fires
 * `playing` synchronously, so `data-mode="playing"` here proves the app renders
 * the status it was given, NOT that audio is moving. Real audio is what the
 * acceptance run (`apps/webapp/acceptance/`) exists for.
 */

const OUT = '../../acceptance-artifacts/shots/home';

/**
 * Representative covers for review. The fixture stations carry no artwork, and
 * a screen full of procedural letter tiles says nothing about the design. These
 * are generated, deterministic and clearly decorative — they stand in for the
 * scene layer, never for a station's real emblem.
 */
const COVERS: Record<string, [string, string, string]> = {
  'uuid-tokyo': ['#2b1055', '#7597de', '#ffd6a5'],
  'uuid-osaka': ['#0f2027', '#2c5364', '#7dffd4'],
  'uuid-berlin': ['#3a1c71', '#d76d77', '#ffaf7b'],
  'uuid-hamburg': ['#134e5e', '#71b280', '#f7ff9c'],
  'uuid-rio': ['#f12711', '#f5af19', '#ffe29f'],
  'uuid-sao': ['#42275a', '#734b6d', '#ffd1ff'],
  'uuid-kyoto': ['#0b486b', '#f56217', '#ffd89b'],
  'uuid-reykjavik': ['#1e3c72', '#2a5298', '#c9ffbf']
};

const cover = (id: string, index: number) => {
  const [a, b, c] = COVERS[id] || ['#241539', '#5f4b8b', '#e0c3fc'];
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    `<stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>` +
    '</linearGradient>' +
    '<radialGradient id="h" cx="0.7" cy="0.28" r="0.6">' +
    `<stop offset="0" stop-color="${c}" stop-opacity="0.85"/>` +
    `<stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient></defs>` +
    '<rect width="300" height="300" fill="url(#g)"/>' +
    '<rect width="300" height="300" fill="url(#h)"/>' +
    `<g fill="${c}" opacity="0.5">` +
    Array.from({ length: 7 }, (_, i) => {
      const x = 34 + i * 34;
      const h = 30 + ((i * 47 + index * 29) % 120);
      return `<rect x="${x}" y="${240 - h}" width="12" height="${h}" rx="6"/>`;
    }).join('') +
    '</g></svg>';
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
};

const withArt = stations.map((station, index) => ({
  ...station,
  stationArtwork: cover(station.stationuuid, index)
}));

const summaryBody = () =>
  JSON.stringify({
    generatedAt: '2026-01-01T00:00:00.000Z',
    counts: { stations: withArt.length, countries: 3, languages: 3, genres: 8 },
    catalogPool: withArt.slice(0, 8),
    freshSignals: withArt.slice(0, 6),
    searchLaunch: withArt.slice(0, 6),
    sponsored: withArt.slice(0, 2),
    countrySpotlight: { label: 'Japan', stations: withArt.slice(0, 4) },
    genreSpotlight: { label: 'jpop', stations: withArt.slice(0, 4) }
  });

const mockWithArt = (page: Page) =>
  mockStations(page, {
    summaryHandler: (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: summaryBody() })
  });


test.skip(process.env.AIR_SHOTS !== '1', 'review-only, run with AIR_SHOTS=1');

// 390x844 is the canonical Telegram width. The Mini App does NOT get the whole
// phone: Telegram keeps a 44px status bar and a 52px header above it, so the
// webview is 390x748 and the comparison page draws that chrome back on top.
test.use({ viewport: { width: 390, height: 748 } });

const themed = (page: Page, themeId: string) =>
  page.addInitScript((id) => {
    window.localStorage.setItem('radio:theme-current:v1', JSON.stringify(id));
  }, themeId);

const settle = async (page: Page) => {
  await page.locator('[data-home-feed-entry]').waitFor({ state: 'visible' });
  await page.waitForFunction(() => Boolean(document.querySelector('[data-air-block]')));
  await page.waitForTimeout(900);
};

const shoot = async (page: Page, name: string) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  const switches = await page.evaluate(() => ({
    glass: document.documentElement.dataset.glass || '(unset)',
    lowPower: document.documentElement.dataset.lowPower || '(unset)',
    theme: document.documentElement.dataset.theme || '(unset)',
    mode: document.documentElement.dataset.themeMode || '(unset)',
    backdrop: document.documentElement.dataset.themeBackdrop || '(unset)',
    airMode: document.querySelector('[data-air-block]')?.getAttribute('data-mode') || '(none)',
    // Measured, not eyeballed: the crop could not show that the block was
    // sliding under the app topbar, nor that two players were on screen.
    topbarBottom: Math.round(
      document.querySelector('.app-topbar-v2')?.getBoundingClientRect().bottom ?? -1
    ),
    airTop: Math.round(
      document.querySelector('[data-air-block]')?.getBoundingClientRect().top ?? -1
    ),
    dockVisible: (() => {
      const dock = document.querySelector('.player-dock.player-dock-bar') as HTMLElement | null;
      if (!dock) return false;
      const r = dock.getBoundingClientRect();
      return r.height > 0 && getComputedStyle(dock).display !== 'none';
    })()
  }));
  console.log(name, JSON.stringify(switches));
};

const seedRestored = (page: Page) =>
  seedRadioState(page, {
    queue: [withArt[0]],
    queueCurrentIndex: 0,
    stationCache: [withArt[0]]
  });

for (const theme of ['aurora-field', 'pastel']) {
  test(`full mobile Home: ${theme}`, async ({ page }) => {
    await mockWithArt(page);
    await installMediaMocks(page);
    await themed(page, theme);

    // 1. First run — nothing chosen, nothing played.
    await seedRadioState(page);
    await page.goto('/?air2=1');
    await settle(page);
    await shoot(page, `${theme}-1-first-run`);

    // 2. Restored after a restart: the station is back, silent, with Play.
    await seedRestored(page);
    await page.goto('/?air2=1');
    await settle(page);
    await shoot(page, `${theme}-2-restored`);

    // 3. Playing (mocked audio — see the header note).
    await page.locator('[data-air-block] .air-block-play').click();
    await expect(page.locator('[data-air-block]')).toHaveAttribute('data-mode', 'playing');
    await page.waitForTimeout(700);
    await shoot(page, `${theme}-3-playing`);
  });
}

test('full mobile Home: a theme the listener built, with their own picture', async ({ page }) => {
  await mockWithArt(page);
  await installMediaMocks(page);
  await seedRestored(page);
  await page.goto('/?air2=1');
  await settle(page);

  // Built through Theme Studio itself, not by writing a theme into storage:
  // the question is whether the new block survives the real editor.
  await page.locator('.mobile-settings-trigger').click();
  await page.getByRole('button', { name: /Open Theme Studio|Открыть Theme Studio/ }).click();
  await page.getByLabel(/Name|Название/).fill('Закат');
  for (const [field, value] of [
    ['[data-theme-builder-hue]', '18'],
    ['[data-theme-builder-sat]', '86']
  ] as const) {
    await page.locator(field).evaluate((node, next) => {
      const input = node as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, next);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  }
  await page.locator('[data-theme-builder-print]').setInputFiles({
    name: 'zakat.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 800">' +
        '<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#2a1140"/><stop offset="0.45" stop-color="#a8365a"/>' +
        '<stop offset="0.62" stop-color="#ff9a3c"/><stop offset="1" stop-color="#3a0f22"/>' +
        '</linearGradient></defs>' +
        '<rect width="400" height="800" fill="url(#s)"/>' +
        '<circle cx="248" cy="470" r="54" fill="#ffd08a"/>' +
        '<rect y="500" width="400" height="300" fill="#2a0a18" opacity="0.55"/>' +
        '<ellipse cx="248" cy="560" rx="120" ry="6" fill="#ffb066" opacity="0.5"/>' +
        '<ellipse cx="248" cy="620" rx="160" ry="8" fill="#ff9a3c" opacity="0.3"/></svg>'
    )
  });
  await expect(page.locator('[data-theme-builder-background="print"]')).toBeVisible();
  await page.getByRole('button', { name: /Save and apply|Сохранить и применить/ }).click();
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.dataset.theme || ''))
    .toContain('custom-');
  // The whole point of the layer decision: a picture theme must leave the
  // backdrop marked as an image, so the glass knows to raise its veil.
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.dataset.themeBackdrop || ''))
    .toBe('image');

  // Back to Home through the sheets' own close controls.
  for (let i = 0; i < 2; i += 1) {
    const chip = page.locator('.settings-sheet').last().locator('.settings-sheet-head .chip');
    if (await chip.count()) await chip.click();
  }
  await settle(page);
  await shoot(page, 'custom-1-restored');

  await page.locator('[data-air-block] .air-block-play').click();
  await expect(page.locator('[data-air-block]')).toHaveAttribute('data-mode', 'playing');
  await page.waitForTimeout(700);
  await shoot(page, 'custom-2-playing');
});
