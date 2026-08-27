import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Digital Asset Links. This one file decides whether the Android wrapper runs
 * full-screen or with a browser address bar pinned across the top — which is the
 * one thing a Trusted Web Activity exists to remove.
 *
 * Every way it breaks is silent. The app still installs, still opens, still
 * plays. Nothing errors, nothing is logged, and the only symptom is a URL bar
 * that looks like it might just be how the app is. So the checks here are for
 * drift, not for syntax:
 *
 *   - the package name must match apps/android/twa-manifest.json. Change the
 *     packageId and forget this file and verification stops matching, with no
 *     other consequence anybody would notice.
 *   - the fingerprint must be 32 colon-separated hex bytes. A SHA-1 fingerprint,
 *     a lowercase one or one pasted without colons is accepted by nothing and
 *     rejected loudly by nobody.
 */

const webappRoot = join(import.meta.dirname, '..');
const assetLinksPath = join(webappRoot, 'public', '.well-known', 'assetlinks.json');
const twaManifestPath = join(webappRoot, '..', 'android', 'twa-manifest.json');

type AssetLink = {
  relation: string[];
  target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
};

describe('the Android wrapper can prove it owns this domain', () => {
  it('is a file, at the exact path Android fetches', () => {
    // Android asks for https://<host>/.well-known/assetlinks.json and follows no
    // redirects. Verified 2026-08-27 that Caddy serves this path rather than
    // reserving the /.well-known/ prefix, and that Vite copies dot-directories
    // out of public/ — neither was safe to assume.
    expect(existsSync(assetLinksPath), 'public/.well-known/assetlinks.json is missing').toBe(true);
  });

  it('declares the one relation that grants the app the domain', () => {
    const links = JSON.parse(readFileSync(assetLinksPath, 'utf8')) as AssetLink[];
    expect(Array.isArray(links)).toBe(true);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.relation).toContain('delegate_permission/common.handle_all_urls');
      expect(link.target.namespace).toBe('android_app');
    }
  });

  it('names the same package the Android project builds', () => {
    const links = JSON.parse(readFileSync(assetLinksPath, 'utf8')) as AssetLink[];
    const twa = JSON.parse(readFileSync(twaManifestPath, 'utf8')) as { packageId: string };
    for (const link of links) {
      expect(
        link.target.package_name,
        'assetlinks names a different package than twa-manifest.json builds'
      ).toBe(twa.packageId);
    }
  });

  it('carries fingerprints in the only shape Android accepts', () => {
    const links = JSON.parse(readFileSync(assetLinksPath, 'utf8')) as AssetLink[];
    for (const link of links) {
      const prints = link.target.sha256_cert_fingerprints;
      expect(prints.length).toBeGreaterThan(0);
      for (const print of prints) {
        // SHA-256, uppercase hex, colon separated: exactly 32 bytes.
        expect(print, `not a SHA-256 fingerprint: ${print}`).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
      }
    }
  });

  /*
   * ⚠ This currently lists ONE fingerprint: the local upload key, which is what
   * a sideloaded APK is signed with. With Play App Signing — the default — Google
   * re-signs the app with ITS OWN certificate, and a store install then presents
   * a fingerprint that is not in this list.
   *
   * So this file is correct for testing today and INCOMPLETE for the store. After
   * the first upload, Play Console shows the app-signing certificate's SHA-256;
   * append it to the same array (the format allows several) and redeploy. Until
   * then, anybody installing from Play would see the address bar this file exists
   * to remove — and nothing would say why.
   */
  it('is honest about being a one-key list while that is still true', () => {
    const links = JSON.parse(readFileSync(assetLinksPath, 'utf8')) as AssetLink[];
    const total = links.reduce((sum, link) => sum + link.target.sha256_cert_fingerprints.length, 0);
    // Fails the day a second fingerprint is added, which is the moment to delete
    // this test and the warning above it rather than leave a stale caveat.
    expect(total, 'a second fingerprint appeared — update the note above and drop this test').toBe(1);
  });
});
