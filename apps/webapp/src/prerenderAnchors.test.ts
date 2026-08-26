import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

/**
 * `scripts/buildStationPages.mts` builds every indexable station page by taking
 * the BUILT index.html and substituting into it: the title, the canonical link,
 * six meta tags, and the contents of #root. Those shapes are therefore load
 * bearing, and this file is edited constantly for unrelated reasons.
 *
 * The failure is silent in the worst way. If a substitution stops matching, the
 * build still succeeds, the pages are still written, and they are still served —
 * they simply all carry the HOME PAGE's title and description. Thousands of
 * pages claiming to be the same thing is not a missing feature, it is duplicate
 * content, which is actively worse for ranking than having no pages at all.
 * Nothing inside the app looks different, and nobody would notice for months.
 *
 * So: assert the anchors, and say what depends on each.
 */

const webappRoot = join(import.meta.dirname, '..');
const html = readFileSync(join(webappRoot, 'index.html'), 'utf8');

describe('index.html still carries the anchors the station prerender substitutes into', () => {
  it('has an EMPTY #root div, which is where the crawler-readable content goes', () => {
    // Matched as `<div id="root"></div>`, optional whitespace between. Content
    // goes inside it because createRoot().render() replaces the container's
    // children, so React clears it on mount with no hydration mismatch — and a
    // crawler is never shown anything a visitor cannot also see.
    expect(html).toMatch(/<div id="root">\s*<\/div>/i);
  });

  it('has a single-line canonical link that can be repointed per station', () => {
    expect(html).toMatch(/<link\s+rel="canonical"[^>]*>/i);
  });

  it('has every meta tag the per-station page rewrites', () => {
    // Each of these gets the station's own value. A tag that stops matching does
    // not fail the build; it just keeps the home page's text on every station.
    const named = ['description', 'twitter:title', 'twitter:description'];
    const properties = ['og:url', 'og:title', 'og:description', 'og:image:alt'];

    for (const key of named) {
      expect(html, `<meta name="${key}"> is gone; station pages would inherit the home page's`).toMatch(
        new RegExp(`<meta\\s[^>]*\\bname="${key}"[^>]*>`, 'i')
      );
    }
    for (const key of properties) {
      expect(html, `<meta property="${key}"> is gone; station pages would inherit the home page's`).toMatch(
        new RegExp(`<meta\\s[^>]*\\bproperty="${key}"[^>]*>`, 'i')
      );
    }
  });

  it('gives every one of those tags a content attribute to overwrite', () => {
    // The substitution rewrites `content="…"` inside the matched tag. A tag
    // written without one would be found and then silently left alone.
    const tags = html.match(/<meta\s[^>]*(name|property)="(description|twitter:|og:)[^"]*"[^>]*>/gi) ?? [];
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(tag, `no content="" to substitute into: ${tag}`).toMatch(/\bcontent="[^"]*"/i);
    }
  });

  it('has a <title> the station name can replace', () => {
    expect(html).toMatch(/<title>[^<]*<\/title>/i);
  });

  /*
   * The whole design rests on this: the station text is written INSIDE #root, and
   * createRoot().render() replaces the container's children, so React wipes it on
   * mount. If that ever stopped being true — a React major, a switch to
   * hydrateRoot — every visitor arriving from a search result would see the
   * prerendered heading stranded above the running app, on every station page at
   * once. It is documented React behaviour, which is exactly the kind of thing
   * worth pinning rather than trusting across an upgrade.
   */
  it('lets React wipe prerendered content on mount, so nobody sees it twice', async () => {
    const container = document.createElement('div');
    container.id = 'root';
    container.innerHTML = '<h1>Prerendered station name</h1>';
    document.body.appendChild(container);

    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement('main', null, 'the app'));
    });

    expect(container.querySelector('h1'), 'prerendered heading survived the mount').toBeNull();
    expect(container.textContent).toBe('the app');

    await act(async () => root.unmount());
    container.remove();
  });
});
