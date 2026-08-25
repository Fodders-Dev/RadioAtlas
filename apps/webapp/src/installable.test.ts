import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Being installable is how this app becomes a phone home-screen icon and a real
 * desktop window — the "app for Android, iOS and PC" request answered without a
 * second program to write. It hangs on a handful of files agreeing with each
 * other, and every way it breaks is SILENT: the app still loads, still plays,
 * still looks finished. It just quietly stops offering to install, and nothing
 * in the running app tells you.
 *
 * So each assertion here stands for one invisible failure:
 *   - the <link rel="manifest"> deleted while editing index.html for something else
 *   - an icon renamed in public/ but not in the manifest, so install shows a hole
 *   - a manifest claiming 512x512 over a file that is actually 192px
 *   - the maskable icon gone, so Android shaves the corners off the artwork
 *   - the registration dropped from main.tsx, which removes installability outright
 */

// jsdom's import.meta.url is not a file: URL, so resolve from import.meta.dirname.
const webappRoot = join(import.meta.dirname, '..');
const publicDir = join(webappRoot, 'public');

const html = readFileSync(join(webappRoot, 'index.html'), 'utf8');
const mainTsx = readFileSync(join(webappRoot, 'src', 'main.tsx'), 'utf8');
const manifestPath = join(publicDir, 'manifest.webmanifest');

type Icon = { src: string; sizes: string; type: string; purpose?: string };
type Manifest = {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: Icon[];
};

/** Width and height straight out of the PNG IHDR chunk, big-endian at 16 and 20. */
const pngSize = (file: string): [number, number] => {
  const bytes = readFileSync(file);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};

describe('the app can actually be installed', () => {
  it('is linked from the page, or no browser ever reads it', () => {
    expect(html).toMatch(/<link[^>]*rel\s*=\s*"manifest"[^>]*>/i);
  });

  it('parses, and states the fields an install prompt requires', () => {
    expect(existsSync(manifestPath), 'public/manifest.webmanifest is missing').toBe(true);
    const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

    expect(manifest.name.length).toBeGreaterThan(0);
    // Launchers truncate past roughly a dozen characters, and a name cut
    // mid-word under the icon is the first thing a new listener sees.
    expect(manifest.short_name.length).toBeGreaterThan(0);
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);

    // Anything but "standalone" installs as a browser tab wearing our icon.
    expect(manifest.display).toBe('standalone');

    // A scope narrower than the app strands routes outside it in the browser.
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');

    // Without these the splash screen is white, which reads as a broken launch
    // against a dark app.
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('points every icon at a real file of the size it claims', () => {
    const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest.icons.length).toBeGreaterThan(0);

    for (const icon of manifest.icons) {
      const file = join(publicDir, icon.src.replace(/^\//, ''));
      expect(existsSync(file), `manifest lists ${icon.src}, which is not in public/`).toBe(true);

      const [width, height] = icon.sizes.split('x').map(Number);
      expect(pngSize(file), `${icon.src} is not ${icon.sizes}`).toEqual([width, height]);
    }
  });

  it('ships the two sizes Android needs plus a maskable one', () => {
    const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const purposes = (icon: Icon) => (icon.purpose ?? 'any').split(/\s+/);

    for (const size of ['192x192', '512x512']) {
      expect(
        manifest.icons.some((icon) => icon.sizes === size && purposes(icon).includes('any')),
        `no "any" icon at ${size}; Chrome will not offer to install`
      ).toBe(true);
    }

    // Android crops icons to its own shape. Without a maskable one it crops the
    // artwork instead of the padding, and the dial loses its corners.
    expect(
      manifest.icons.some(
        (icon) => purposes(icon).includes('maskable') && icon.sizes === '512x512'
      ),
      'no maskable 512x512 icon'
    ).toBe(true);
  });

  it('registers the service worker, without which there is no install prompt', () => {
    expect(existsSync(join(publicDir, 'sw.js')), 'public/sw.js is missing').toBe(true);
    expect(mainTsx).toMatch(/serviceWorker\.register\(\s*'\/sw\.js'\s*\)/);
    // On `load` specifically: registering earlier competes with the first paint,
    // which is the one thing the cold start may not spend.
    expect(mainTsx).toMatch(/addEventListener\(\s*'load'/);
  });
});
