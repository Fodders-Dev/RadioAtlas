/**
 * Isolation probe: can Chromium actually play the endless WAV this rig serves?
 *
 * Run before blaming the app. If `currentTime` does not advance here, the
 * fixture is broken and every conclusion drawn through the product would be
 * about the fixture instead.
 *
 *   npx tsx acceptance/probeStream.mts
 */
import { chromium } from '@playwright/test';

import { startLiveStream } from './liveStreamServer';

const live = await startLiveStream(39178);
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();

await page.setContent(
  `<audio id="a" src="${live.url}" preload="auto"></audio>` +
    '<button id="go" onclick="document.getElementById(\'a\').play()">go</button>'
);
page.on('console', (m) => console.log('  console:', m.text()));
await page.click('#go');

for (let i = 0; i < 12; i += 1) {
  await page.waitForTimeout(1000);
  const s = await page.evaluate(() => {
    const a = document.getElementById('a') as HTMLAudioElement;
    return {
      t: Number(a.currentTime.toFixed(2)),
      paused: a.paused,
      readyState: a.readyState,
      networkState: a.networkState,
      error: a.error ? `${a.error.code}: ${a.error.message}` : null,
      buffered: a.buffered.length ? Number(a.buffered.end(0).toFixed(2)) : 0
    };
  });
  console.log(`t+${i + 1}s`, JSON.stringify(s), 'connections:', live.connections());
}

await browser.close();
await live.close();
