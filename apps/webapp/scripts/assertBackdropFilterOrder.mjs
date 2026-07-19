#!/usr/bin/env node
/**
 * Fails if any CSS rule declares the standard `backdrop-filter` without a
 * `-webkit-backdrop-filter` sibling BEFORE it.
 *
 * Why this exists: a CSS minifier keeps the LAST of two duplicate declarations,
 * and Chrome ignores the prefixed property when the standard one wins. Writing
 * them in the wrong order therefore silently removes all glass from the
 * production bundle — and nothing in the test suite can see it, because
 * Playwright runs `npm run dev` (unminified), where declaration order does not
 * matter. Every screenshot shows perfect glass and the bug ships green.
 *
 * This is the only mitigation that survives the next redesign.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(ROOT, 'src');

// Pre-existing violations, explicitly grandfathered rather than silently
// tolerated. Fixing them is out of scope for the Search rebuild; NEW code must
// not join this list.
//
// Keyed by file + exact declaration text (NOT line number) so unrelated edits
// above them cannot silently re-arm or disarm an entry. The count is asserted
// too, so a second copy of an already-allowed declaration is still caught.
//
// NOTE for a follow-up: ChatSheet.css writes the pair in the WRONG order
// (standard first, prefixed second) — that is a live instance of the bug this
// script exists to prevent, and its glass is very likely already dead in the
// production bundle. Worth its own change.
const ALLOWED = new Map([
  ['src/screens/discover.css|backdrop-filter: blur(8px);', 1],
  ['src/boot.css|backdrop-filter: blur(16px);', 1],
  ['src/boot.css|backdrop-filter: blur(20px);', 1],
  ['src/components/ChatSheet.css|backdrop-filter: blur(22px) saturate(150%);', 1],
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
      'The minifier keeps the last duplicate and Chrome ignores the prefixed one,\n' +
      'so this silently kills the glass in the production bundle:\n' +
      violations.map((entry) => `  ${entry}`).join('\n')
  );
  process.exit(1);
}

console.log(`backdrop-filter order OK (${cssFiles.length} css files scanned)`);
