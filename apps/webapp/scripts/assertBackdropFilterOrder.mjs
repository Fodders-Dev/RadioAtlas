#!/usr/bin/env node
/**
 * Fails if any CSS rule declares the standard `backdrop-filter` without a
 * `-webkit-backdrop-filter` sibling BEFORE it.
 *
 * Why this exists, measured on the real bundle rather than argued:
 *
 * The bundler treats the two properties as one prefix group and keeps the LAST
 * of them. Written prefixed-first, both survive minification; written
 * standard-first, only `-webkit-backdrop-filter` is emitted. And Chrome no
 * longer accepts that spelling — in Chrome 148,
 * `CSS.supports('-webkit-backdrop-filter', 'blur(1px)')` is **false**, so a rule
 * that keeps only the prefixed property has no blur at all in the engine
 * Telegram uses on Android and on the desktop client.
 *
 * That was not hypothetical. Until 2026-08-17 `ChatSheet.css` wrote all twelve
 * of its pairs in the losing order, and the built bundle carried 76 standard
 * declarations against 89 prefixed ones: every glass surface of the Лира chat —
 * card, header, bubbles, prompt cards, station cards, input, composer — shipped
 * transparent and unblurred. The `@supports not (backdrop-filter: ...)` fallback
 * could not save it, because the browser does support the standard property;
 * what was missing was the declaration. After the reorder the bundle is 89
 * against 89.
 *
 * Nothing in the test suite could see it: Playwright runs the dev server, where
 * nothing is minified and declaration order is irrelevant, so every screenshot
 * showed perfect glass and the bug shipped green for months. This script is the
 * only mitigation that survives the next redesign, and
 * `src/glassPrefixOrder.test.ts` is what makes CI run it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(ROOT, 'src');

// Declarations written with no prefixed twin at all. These are NOT the bug
// above — measured on the same build, the bundler adds `-webkit-` for them and
// both properties reach the bundle, so nothing is lost today. They stay listed
// rather than auto-tolerated for two reasons: no target is pinned anywhere in
// this repo, so that autoprefixing is a default someone can change without
// noticing, and a written-out pair keeps the file's convention visible to the
// next person editing it. NEW code should write both, in this order.
//
// Keyed by file + exact declaration text (NOT line number) so unrelated edits
// above them cannot silently re-arm or disarm an entry. The count is asserted
// too, so a second copy of an already-allowed declaration is still caught.
const ALLOWED = new Map([
  ['src/screens/discover.css|backdrop-filter: blur(8px);', 1],
  ['src/boot.css|backdrop-filter: blur(16px);', 1],
  ['src/boot.css|backdrop-filter: blur(20px);', 1],
  // A reduced-motion/low-power OFF switch, not a glass declaration — harmless
  // either way, but listed so the scan stays at zero unexplained hits.
  ['src/components/globe/globe.css|backdrop-filter: none;', 1],
  ['src/components/winampShell/winamp.css|backdrop-filter: blur(30px) saturate(180%);', 1],
  ['src/components/winampShell/winamp.css|backdrop-filter: blur(8px);', 1]
]);
const seen = new Map();

const cssFiles = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (entry.endsWith('.css')) cssFiles.push(full);
  }
};
walk(SRC);

const violations = [];

for (const file of cssFiles) {
  const relPath = relative(ROOT, file).split('\\').join('/');
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    // Standard property only (the prefixed one contains '-webkit-').
    if (!/^backdrop-filter\s*:/.test(trimmed)) return;
    const lineNo = index + 1;
    const id = `${relPath}:${lineNo}`;
    const allowKey = `${relPath}|${trimmed}`;
    // Look backwards within the same declaration block for the prefixed twin.
    let found = false;
    for (let i = index - 1; i >= 0; i -= 1) {
      const prev = lines[i].trim();
      if (prev.includes('{') || prev.includes('}')) break;
      if (/^-webkit-backdrop-filter\s*:/.test(prev)) {
        found = true;
        break;
      }
    }
    if (found) return;
    const budget = ALLOWED.get(allowKey) ?? 0;
    const used = seen.get(allowKey) ?? 0;
    if (used < budget) {
      seen.set(allowKey, used + 1);
      return;
    }
    violations.push(id);
  });
}

if (violations.length) {
  console.error(
    'backdrop-filter written without a -webkit-backdrop-filter BEFORE it.\n' +
      'The bundler keeps the LAST of the pair, and Chrome 148 does not support\n' +
      'the -webkit- spelling, so this order ships the surface with no blur at all\n' +
      '— invisibly, because Playwright runs the unminified dev server:\n' +
      violations.map((entry) => `  ${entry}`).join('\n')
  );
  process.exit(1);
}

console.log(`backdrop-filter order OK (${cssFiles.length} css files scanned)`);
