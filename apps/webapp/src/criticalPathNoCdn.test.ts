import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The rule existed; the test did not, and that is how it was broken for months.
 *
 * `.claude/rules/webapp.md` has always said the app is served from our own
 * origin and no CDN import may come back on the critical path. Fonts slipped
 * through anyway: `index.html` carried a render-blocking stylesheet from a font
 * CDN, and it shipped to production.
 *
 * The reason this is a guard and not a preference, measured on the real bundle
 * at 390x844: when that third-party request is REFUSED the page still paints in
 * ~356 ms, but when it HANGS — no response, no refusal, which is exactly what a
 * filtered or throttled network produces, and this app lives inside Telegram on
 * exactly those networks — the page produces NO PAINT AT ALL within 25 seconds.
 * `performance.getEntriesByType('paint')` comes back empty while every one of
 * our own bytes has already arrived at 73 ms.
 *
 * A stylesheet in <head> holds first paint hostage. A font we host ourselves,
 * with `font-display: swap`, costs the typeface when it fails — never the
 * screen.
 */

// jsdom's import.meta.url is not a file: URL, so resolve from import.meta.dirname.
const webappRoot = join(import.meta.dirname, '..');
const readSource = (relative: string) => readFileSync(join(webappRoot, relative), 'utf8');

const EXTERNAL = /^(https?:)?\/\//i;

// Explicitly string[]: `String.match() || []` infers a union with never[], and
// indexOf() on that union rejects a string argument.
const tagsOf = (html: string, tag: string): string[] =>
  html.match(new RegExp(`<${tag}\\b[^>]*>`, 'gi')) ?? [];

const attr = (tagText: string, name: string) => {
  const match = tagText.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i'));
  return match ? match[1] : null;
};

describe('nothing on the critical path comes from somebody else', () => {
  const html = readSource('index.html');

  it('loads no stylesheet, font or icon from another origin', () => {
    // `canonical` is metadata for a search engine, not a resource: a browser
    // never fetches it, so it cannot hold a paint hostage no matter where it
    // points — and ours points at our own domain anyway. Every other rel here
    // declares something the browser WILL go and get, which is the whole subject
    // of this file. Narrowed for that reason, not to make a red test green; the
    // stylesheet case below still fails if a CDN link comes back.
    const METADATA_ONLY = new Set(['canonical']);
    const external = tagsOf(html, 'link')
      .filter((tag) => !METADATA_ONLY.has((attr(tag, 'rel') || '').toLowerCase()))
      .map((tag) => attr(tag, 'href'))
      .filter((href): href is string => href !== null && EXTERNAL.test(href));

    expect(
      external,
      'a <link> to another origin in <head> holds first paint hostage when it hangs'
    ).toEqual([]);
  });

  it('loads NO external script at all, the Telegram SDK included', () => {
    // There used to be one documented exception, on the grounds that inside
    // Telegram that host is on the critical path anyway and every call site
    // degrades gracefully when the load fails. The second half was true and the
    // first was not: measured 2026-08-31 from the Russian host, TCP to
    // telegram.org:443 never connects — three attempts, no response in 20 s.
    //
    // A hanging script is not a failing one. It blocks the parser, so the page
    // never renders, and radioatlas.ru simply would not open on a Russian
    // mobile network without a VPN. The SDK is vendored into
    // public/vendor/telegram-web-app.js and served from our own origin, which
    // keeps the synchronous ordering the app depends on and removes the only
    // third party that could hold first paint hostage.
    const external = tagsOf(html, 'script')
      .map((tag) => attr(tag, 'src'))
      .filter((src): src is string => src !== null && EXTERNAL.test(src));

    expect(
      external,
      'an external script blocks first paint for every listener whose network filters that host'
    ).toEqual([]);
  });

  it('still loads the Telegram SDK, from our own origin and synchronously', () => {
    // Self-hosting must not turn into "quietly dropped": window.Telegram.WebApp
    // has to exist before the Vite module script runs, or the mount effect that
    // calls tg.ready() races it.
    const scripts = tagsOf(html, 'script');
    const sdk = scripts.find((tag) => (attr(tag, 'src') || '').includes('telegram-web-app.js'));
    expect(sdk, 'index.html must still load the Telegram SDK').toBeDefined();
    expect(attr(sdk!, 'src')).toBe('/vendor/telegram-web-app.js');
    expect(sdk!, 'the SDK must not be deferred or async: ordering is the point').not.toMatch(
      /(defer|async)/
    );

    const sdkIndex = scripts.indexOf(sdk!);
    const moduleIndex = scripts.findIndex((tag) => (attr(tag, 'src') || '').includes('main.tsx'));
    expect(moduleIndex).toBeGreaterThan(-1);
    expect(sdkIndex, 'the SDK must come before the app module').toBeLessThan(moduleIndex);
  });

  it('ships its own typeface rather than borrowing one', () => {
    const bootCss = readSource('src/boot.css');
    expect(bootCss).toContain('@font-face');
    // Every src must be a root-relative path on our own origin.
    const sources = bootCss.match(/src:\s*url\(([^)]+)\)/g) || [];
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source).toContain("url('/fonts/");
      expect(EXTERNAL.test(source)).toBe(false);
    }
  });

  it('lets a failed font cost the typeface and never the screen', () => {
    // Without `swap` the browser blocks text rendering for up to 3 s waiting for
    // a face that may never arrive — which reintroduces, at smaller scale, the
    // exact failure this file exists to prevent.
    const bootCss = readSource('src/boot.css');
    const faces = bootCss.match(/@font-face\s*\{[^}]*\}/g) || [];
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      expect(face).toContain('font-display: swap');
    }
  });

  it('lets the browser discover the real JS without parsing a stub first', () => {
    /*
     * `build.modulePreload: false` was set in 271b38c alongside
     * `external: ['react', …]` — the CDN-externalised React era, when preloading
     * would have meant preloading somebody else's origin, which the rest of this
     * file exists to forbid. That externalisation is gone. The flag stayed, and
     * became a pure cost.
     *
     * Measured against the real bundle at 150 ms RTT / 1.6 Mbps: the entry chunk
     * is 0.9 KB and statically imports ~97 KB (brotli) of real JS. Without the
     * preload links the browser could not discover those until it had fetched
     * AND parsed the entry — they began at 812 ms while the entry had finished
     * at 379 ms. With them they begin at 183 ms, and DOMContentLoaded moves from
     * ~1573 ms to ~1426 ms.
     *
     * Note the honest shape of that win: discovery moves ~630 ms earlier, but
     * the end-to-end gain is ~147 ms, because at that bandwidth the transfer —
     * not the round trip — is the limit. Faster link, bigger win.
     */
    const config = readSource('vite.config.ts');
    expect(
      config,
      'modulePreload is disabled again; see the measurement above before restoring it'
    ).not.toMatch(/modulePreload:\s*false/);
  });
});
