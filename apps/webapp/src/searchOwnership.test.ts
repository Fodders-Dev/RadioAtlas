import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The two files that prove to a search engine that this site is ours.
 *
 * Both are single lines in `public/`, both look like clutter to anyone tidying
 * that directory, and deleting either costs something that nothing in the app
 * will report:
 *
 *   - `google<hash>.html` is what Google Search Console verified against.
 *     Google's own dialog says it plainly: remove the file and the verification
 *     can be revoked. The property then stops reporting, the sitemap stops
 *     being read, and the app looks exactly the same.
 *   - `<key>.txt` is the IndexNow key. Every engine fetches it to confirm the
 *     sender owns the host, so without it `npm run seo:indexnow` submits
 *     nothing — 5 001 URLs rejected, and only the script's exit code says so.
 *
 * ⚠ Neither would fail loudly on the site either. Caddy's `try_files` falls
 * through to index.html, so a deleted file here comes back as the SPA shell
 * with a 2xx rather than a 404 — measured 2026-08-30, status 206. Anything
 * checking "does the URL respond" would call that fine. So these assert
 * CONTENTS, and so does the submitter.
 */

const publicDir = join(import.meta.dirname, '..', 'public');
const files = readdirSync(publicDir);

describe('search engine ownership files', () => {
  it('keeps the Google Search Console verification file', () => {
    const verification = files.filter(
      (name) => name.startsWith('google') && name.endsWith('.html')
    );
    expect(
      verification,
      'public/ must keep the google<hash>.html Search Console verified against'
    ).toHaveLength(1);

    // Google's file states its own name, and the check reads that line rather
    // than merely fetching the URL — an empty file at the right path verifies
    // nothing.
    const contents = readFileSync(join(publicDir, verification[0]), 'utf8').trim();
    expect(contents).toBe(`google-site-verification: ${verification[0]}`);
  });

  it('keeps the IndexNow key, and the key still matches its own filename', () => {
    const keys = files.filter((name) => /^[0-9a-f]{32}\.txt$/.test(name));
    expect(keys, 'public/ must keep the IndexNow key file').toHaveLength(1);

    // The protocol's own rule: the file is named for the key and contains it.
    // A rotated key that only changed in one of the two places fails here
    // rather than at the next submission.
    const key = basename(keys[0], '.txt');
    expect(readFileSync(join(publicDir, keys[0]), 'utf8').trim()).toBe(key);
  });

  it('the submitter defaults to the key that is actually deployed', () => {
    // The script carries the key as a default so it runs with no environment.
    // If someone rotates the file and not the script, the submission fails with
    // a 403 that reads like an outage.
    const script = readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'scripts', 'submitIndexNow.mjs'),
      'utf8'
    );
    const keyFile = files.find((name) => /^[0-9a-f]{32}\.txt$/.test(name));
    expect(keyFile).toBeDefined();
    expect(script).toContain(basename(keyFile!, '.txt'));
  });
});
