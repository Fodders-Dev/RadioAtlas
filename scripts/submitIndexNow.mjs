#!/usr/bin/env node
/**
 * Tells Yandex and Bing that our pages exist, without an account anywhere.
 *
 *   node scripts/submitIndexNow.mjs --dry-run     # print what would be sent
 *   node scripts/submitIndexNow.mjs               # actually submit
 *
 * WHY THIS AND NOT "SUBMIT THE SITEMAP". There is no longer a way to hand a
 * sitemap to a search engine anonymously: Google retired its ping endpoint in
 * 2023 and Bing retired its own, and Search Console needs a signed-in account
 * and a verified property — which is the owner's to do and cannot be automated
 * from here.
 *
 * IndexNow is the part that CAN be automated. It is a published protocol: host
 * a key file at the site root, POST a list of URLs, and the participating
 * engines fetch the key to confirm the sender owns the host. No account, no
 * verification flow, no credentials to hold.
 *
 * ⚠ WHAT IT DOES NOT DO, so nobody reads more into a 200 than it means:
 *   - Google does NOT participate in IndexNow. This reaches Yandex, Bing,
 *     Seznam and Naver. For a Russian-language product Yandex is the one that
 *     matters most, which is why this is worth doing on its own — but Google
 *     still needs Search Console, by hand, once.
 *   - "Accepted" means the URLs were received, not indexed, and not ranked.
 *     An engine decides for itself whether to crawl.
 *
 * ⚠ NOT WIRED INTO THE DEPLOY, deliberately. IndexNow is for URLs that CHANGED;
 * resubmitting all five thousand on every push is the behaviour the protocol
 * asks you not to have. Run it when the page set actually moves — a catalogue
 * refresh that adds or drops stations — not on every release.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ORIGIN = process.env.SITE_ORIGIN || 'https://radioatlas.ru';
const KEY = process.env.INDEXNOW_KEY || '283736fb444f16340bc40345905bb102';
const ENDPOINT = 'https://api.indexnow.org/indexnow';
// The protocol's own ceiling per request.
const BATCH = 10000;

const dryRun = process.argv.includes('--dry-run');

const host = new URL(ORIGIN).host;

/**
 * The live sitemap is the source of truth rather than the local build: what
 * matters is the set of pages a crawler can actually fetch right now, and a
 * local dist can be ahead of production or behind it.
 */
const readSitemap = async () => {
  const local = process.env.SITEMAP_FILE;
  if (local) return readFile(local, 'utf8');
  const response = await fetch(`${ORIGIN}/sitemap.xml`, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`sitemap fetch failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
};

const main = async () => {
  const xml = await readSitemap();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => match[1].trim())
    .filter((url) => url.startsWith(ORIGIN));

  if (!urls.length) {
    // A sitemap that parses to nothing is the silent failure here: the request
    // would succeed and submit an empty list.
    throw new Error('sitemap contained no URLs on this origin — refusing to submit nothing');
  }

  // Confirm the key is actually reachable BEFORE announcing anything. Every
  // engine fetches it to verify ownership, so a missing file turns the whole
  // submission into a rejection that is easy to misread as "sent".
  //
  // Compare the CONTENTS, not the status. Measured here on 2026-08-30: a key
  // file that does not exist comes back 206 with the SPA shell as its body,
  // because Caddy's `try_files` falls through to index.html for anything it
  // cannot find. A status check would have called that success and submitted
  // five thousand URLs against a key no engine could verify.
  const keyUrl = `${ORIGIN}/${KEY}.txt`;
  const keyResponse = await fetch(keyUrl).catch(() => null);
  const keyBody = keyResponse && keyResponse.ok ? (await keyResponse.text()).trim() : null;
  if (keyBody !== KEY) {
    throw new Error(
      `key file at ${keyUrl} is missing or does not contain the key ` +
        `(status ${keyResponse ? keyResponse.status : 'unreachable'}) — deploy it first`
    );
  }

  console.log(`indexnow: ${urls.length} URLs, key verified at ${keyUrl}`);
  if (dryRun) {
    console.log('indexnow: --dry-run, sending nothing. First three:');
    for (const url of urls.slice(0, 3)) console.log(`  ${url}`);
    return;
  }

  for (let index = 0; index < urls.length; index += BATCH) {
    const chunk = urls.slice(index, index + BATCH);
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key: KEY, keyLocation: keyUrl, urlList: chunk })
    });
    const text = await response.text().catch(() => '');
    console.log(
      `indexnow: batch ${index / BATCH + 1} — ${chunk.length} URLs — ` +
        `${response.status} ${response.statusText}${text ? ` ${text.slice(0, 200)}` : ''}`
    );
    // 200 accepted, 202 accepted while the key is still being checked.
    if (response.status !== 200 && response.status !== 202) {
      throw new Error(`indexnow rejected the batch: ${response.status}`);
    }
  }
};

await main();
