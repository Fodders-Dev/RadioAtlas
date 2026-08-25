import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A link to RadioAtlas dropped into a chat used to show nothing: no picture, no
 * title beyond the bare word, no description. For a product whose only route to
 * its first listeners is somebody sharing it with a friend, that is a growth
 * mechanism failing on a handful of missing tags.
 *
 * These are easy to delete by accident — they live in the one file everybody
 * edits for something else — and the failure is invisible from inside the app.
 * Nothing renders differently; you simply stop being shareable.
 */

// jsdom's import.meta.url is not a file: URL, so resolve from import.meta.dirname.
const webappRoot = join(import.meta.dirname, '..');
const html = readFileSync(join(webappRoot, 'index.html'), 'utf8');

const meta = (attribute: 'name' | 'property', key: string) => {
  const pattern = new RegExp(
    `<meta[^>]*\\b${attribute}\\s*=\\s*"${key}"[^>]*>`,
    'i'
  );
  const tag = html.match(pattern)?.[0];
  if (!tag) return null;
  return tag.match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1] ?? null;
};

describe('a shared link looks like something worth opening', () => {
  it('carries a description for search results and chat previews', () => {
    const description = meta('name', 'description');
    expect(description, 'no <meta name="description">').toBeTruthy();
    expect(description!.length).toBeGreaterThan(60);
  });

  it('carries the Open Graph set a chat preview needs', () => {
    for (const key of ['og:title', 'og:description', 'og:image', 'og:url', 'og:type']) {
      expect(meta('property', key), `missing ${key}`).toBeTruthy();
    }
    expect(meta('name', 'twitter:card')).toBe('summary_large_image');
  });

  it('points the preview image at a file that actually exists', () => {
    const image = meta('property', 'og:image');
    expect(image).toMatch(/^https:\/\//);
    // Crawlers need an absolute URL, but the file is ours and must be committed —
    // a preview pointing at a 404 is worse than no preview, because the chat
    // renders an empty grey box instead of falling back to text.
    const path = new URL(image!).pathname.replace(/^\//, '');
    expect(
      existsSync(join(webappRoot, 'public', path)),
      `og:image references ${path}, which is not in public/`
    ).toBe(true);
  });

  it('states no counts, because a cached preview cannot be kept honest', () => {
    // "46 048 stations" is true today and stale the first time the catalogue
    // moves — and Telegram and Google hold a preview for a long time. Short
    // numbers like 24/7 are fine; a three-digit run is a claim about quantity.
    for (const key of ['description'] as const) {
      expect(meta('name', key)).not.toMatch(/\d[\d\s ]{2,}/);
    }
    expect(meta('property', 'og:description')).not.toMatch(/\d[\d\s ]{2,}/);
  });
});
