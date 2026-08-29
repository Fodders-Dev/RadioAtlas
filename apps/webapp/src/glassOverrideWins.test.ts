import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Runs `scripts/assertGlassOverrideWins.mjs` from the suite CI actually
 * executes, for the same reason its sibling does: a guard nobody runs is a
 * comment, and this repo has already shipped one of those for months.
 *
 * What it protects is a silent failure, which is why it is worth a suite at
 * all. `?glass=off` is how the cost of every backdrop-filter gets measured, and
 * it was written one class-weight too light, so half the blurs stayed on and
 * the measurement taken through it said blur was innocent. Nothing errored,
 * nothing looked wrong, and the wrong answer was acted on. The `lite` tier that
 * now flattens the small controls on low-power phones sits on the same
 * cascade, so if it ever loses its weight the phone quietly gets hot again and
 * every test still passes.
 */
const WEBAPP_ROOT = dirname(import.meta.dirname);

describe('glass override cascade', () => {
  it('the ?glass=off switch and the lite tier outweigh every blur they override', () => {
    try {
      execFileSync(process.execPath, [join('scripts', 'assertGlassOverrideWins.mjs')], {
        cwd: WEBAPP_ROOT,
        encoding: 'utf8',
        stdio: 'pipe'
      });
    } catch (error) {
      const details = (error as { stderr?: string }).stderr ?? String(error);
      expect.fail(details.trim());
    }
  });
});
