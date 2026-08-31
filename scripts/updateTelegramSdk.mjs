// Refresh the vendored Telegram WebApp SDK.
//
//   node scripts/updateTelegramSdk.mjs
//
// The SDK is served from our own origin (apps/webapp/public/vendor/) rather
// than from telegram.org, because that host does not answer from Russia — TCP
// to telegram.org:443 never connects, three attempts, no response in 20 s,
// measured 2026-08-31 — and index.html loads it SYNCHRONOUSLY. A hanging
// script blocks the parser, so the page never renders at all. That is why the
// app would not open on a Russian mobile network without a VPN.
//
// The cost of self-hosting is that the copy goes stale, which is what this
// script is for. Run it when Telegram ships something the app needs; the diff
// is the whole review.
//
// ⚠ It cannot run from a network that cannot reach telegram.org, which includes
// the machine this is most likely to be typed on. In that case the failure
// below says so, and the way through is to fetch it from a host that can:
//
//   ssh <foreign-host> 'curl -s https://telegram.org/js/telegram-web-app.js' \
//     > apps/webapp/public/vendor/telegram-web-app.js
//
// and then re-run this script with CHECK_ONLY=1 to verify what landed.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const SOURCE = 'https://telegram.org/js/telegram-web-app.js';
const TARGET = new URL('../apps/webapp/public/vendor/telegram-web-app.js', import.meta.url);
const TIMEOUT_MS = 15_000;
const MIN_BYTES = 20_000;

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

const describeExisting = async () => {
  try {
    const current = await readFile(TARGET);
    return { bytes: current.length, hash: sha256(current) };
  } catch {
    return null;
  }
};

const main = async () => {
  const before = await describeExisting();
  if (before) {
    console.log(`vendored now: ${before.bytes} bytes, sha256 ${before.hash}`);
  } else {
    console.log('vendored now: (absent)');
  }

  if (process.env.CHECK_ONLY === '1') {
    if (!before) {
      console.error('CHECK_ONLY: nothing vendored — index.html would 404 on its own SDK');
      process.exitCode = 1;
    return;
    }
    // Cheap sanity rather than a signature: the file has to be the SDK, not an
    // error page somebody redirected into it.
    const text = await readFile(TARGET, 'utf8');
    const looksRight = text.includes('TelegramWebviewProxy') || text.includes('WebApp');
    if (!looksRight || before.bytes < MIN_BYTES) {
      console.error('CHECK_ONLY: that file does not look like the Telegram SDK');
      process.exitCode = 1;
    return;
    }
    console.log('CHECK_ONLY: looks like the SDK.');
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let downloaded;
  try {
    const response = await fetch(SOURCE, { signal: controller.signal });
    if (!response.ok) throw new Error(`${SOURCE} -> ${response.status}`);
    downloaded = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    clearTimeout(timer);
    const reason = error && error.name === 'AbortError' ? `no response in ${TIMEOUT_MS} ms` : String(error?.message || error);
    console.error(`Could not fetch the SDK: ${reason}`);
    console.error('If this machine is in Russia that is expected, not a bug — see the header of');
    console.error('this file for how to pull it through a host that can reach telegram.org.');
    process.exitCode = 1;
    return;
  }
  clearTimeout(timer);

  if (downloaded.length < MIN_BYTES) {
    console.error(`Refusing to write ${downloaded.length} bytes: that is not the SDK.`);
    process.exitCode = 1;
    return;
  }
  const text = downloaded.toString('utf8');
  if (!text.includes('TelegramWebviewProxy') && !text.includes('WebApp')) {
    console.error('Refusing to write: the response does not look like the Telegram SDK.');
    process.exitCode = 1;
    return;
  }

  const hash = sha256(downloaded);
  if (before && before.hash === hash) {
    console.log('Unchanged — the vendored copy is already current.');
    return;
  }

  await writeFile(TARGET, downloaded);
  console.log(`Updated: ${downloaded.length} bytes, sha256 ${hash}`);
  console.log('Review the diff before committing — this file runs before anything else on the page.');
};

await main();
