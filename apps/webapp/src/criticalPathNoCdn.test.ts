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

const tagsOf = (html: string, tag: string) =>
  html.match(new RegExp(`<${tag}\\b[^>]*>`, 'gi')) || [];

const attr = (tagText: string, name: string) => {
  const match = tagText.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i'));
  return match ? match[1] : null;
};

describe('nothing on the critical path comes from somebody else', () => {
  const html = readSource('index.html');

  it('loads no stylesheet, font or icon from another origin', () => {
    const external = tagsOf(html, 'link')
      .map((tag) => attr(tag, 'href'))
      .filter((href): href is string => href !== null && EXTERNAL.test(href));

    expect(
      external,
      'a <link> to another origin in <head> holds first paint hostage when it hangs'
    ).toEqual([]);
  });

  it('loads exactly one external script, and it is the Telegram SDK', () => {
    // The one documented exception: inside Telegram this host is on the critical
    // path regardless, and every call site degrades gracefully when it fails
    // (getTelegramWebApp() returns undefined and the app runs standalone).
    const external = tagsOf(html, 'script')
      .map((tag) => attr(tag, 'src'))
      .filter((src): src is string => src !== null && EXTERNAL.test(src));

    expect(external).toEqual(['https://telegram.org/js/telegram-web-app.js']);
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
});
