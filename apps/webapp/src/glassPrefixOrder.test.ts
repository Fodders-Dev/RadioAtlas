import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `scripts/assertBackdropFilterOrder.mjs` existed for months and ran nowhere: no
 * npm script, no workflow, no test — its only mention in the whole tree was a
 * CSS comment claiming it "enforces this mechanically". By the time anyone ran
 * it, it had fourteen findings, twelve of them the exact defect it was written
 * to prevent, live in the production bundle.
 *
 * So the guard is invoked from here. This suite is the one CI runs for the
 * webapp, which makes a wrongly ordered glass pair a red build instead of a
 * comment nobody executes.
 */

// Under jsdom `import.meta.url` is not a file: URL, so it cannot be converted
// to a path; `import.meta.dirname` is what Vite leaves usable here.
const WEBAPP_ROOT = dirname(import.meta.dirname);

describe('backdrop-filter prefix order', () => {
  it('holds across every stylesheet in src/', () => {
    try {
      execFileSync(process.execPath, [join('scripts', 'assertBackdropFilterOrder.mjs')], {
        cwd: WEBAPP_ROOT,
        encoding: 'utf8',
        stdio: 'pipe'
      });
    } catch (error) {
      // The script names the offending file and line on stderr; surfacing it is
      // the whole point, so re-throw with that text rather than an exit code.
      const details = (error as { stderr?: string }).stderr ?? String(error);
      expect.fail(details.trim());
    }
  });
});
