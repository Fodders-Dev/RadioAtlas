#!/usr/bin/env node
/**
 * Fails if the glass policy blocks in `styles.css` cannot actually win the
 * cascade against the blur declarations they exist to override.
 *
 * This guards a failure mode that has already produced a confident wrong answer
 * in this project, and produced it SILENTLY.
 *
 * `?glass=off` is the switch that answers "what do the backdrop-filters cost".
 * It was written as `:root[data-glass='off'] *`, which weighs (0,2,0) — exactly
 * what `.screen-home-next .home-action-btn` weighs. That one is `!important`
 * and lives in `homeReference.css`, which ships in the lazy Home chunk and
 * therefore loads LATER, so the tie went to the blur. Measured against
 * production on 2026-08-29: with the switch on, 71 of 141 backdrop-filters were
 * still live and the compositor still promoted 48 layers for BackdropFilter.
 *
 * Nothing failed. The page loaded, the app worked, the switch reported nothing
 * unusual, and the measurement taken through it said blur was not the problem —
 * so blur was ruled out and hours went elsewhere. It was in fact the dominant
 * cost: -64% on the GPU compositor thread once the switch really worked.
 *
 * A screenshot test cannot catch this (the flattened look is not what is being
 * asserted) and a runtime test would only catch it on whichever screen it
 * happened to render. Specificity is a static property of the stylesheets, so
 * it is checked statically, over all of them.
 *
 * The rule enforced: an override must weigh STRICTLY MORE than every blur
 * declaration it claims to beat. Strictly, not "at least" — equal weight is
 * decided by document order, and the blurs are in later chunks.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(ROOT, 'src');

const cssFiles = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out;
};

const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * CSS specificity as [ids, classes, types]. Good enough for this codebase's
 * selectors, and deliberately conservative: anything it cannot parse counts as
 * a class, which can only make an override look WEAKER than it is. A guard that
 * errs toward failing is the right way round here.
 */
export const specificity = (selector) => {
  let s = selector.trim();
  // Pseudo-element and pseudo-class arguments: :is()/:where()/:not() take the
  // weight of their heaviest argument (:where() takes none). Flatten by
  // replacing the functional form with its contents, except :where().
  s = s.replace(/:where\([^()]*\)/g, ' ');
  s = s.replace(/:(?:is|not|has)\(([^()]*)\)/g, ' $1 ');

  const ids = (s.match(/#[\w-]+/g) || []).length;
  const pseudoElements = (s.match(/::[\w-]+/g) || []).length;
  const withoutPseudoElements = s.replace(/::[\w-]+/g, ' ');
  const classes = (withoutPseudoElements.match(/\.[\w-]+/g) || []).length;
  const attributes = (withoutPseudoElements.match(/\[[^\]]*\]/g) || []).length;
  const pseudoClasses = (withoutPseudoElements.match(/(?<!:):[\w-]+/g) || []).length;
  const types = (
    withoutPseudoElements
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/[.#][\w-]+/g, ' ')
      .replace(/:[\w-]+/g, ' ')
      .match(/(?:^|[\s>+~])([a-zA-Z][\w-]*)/g) || []
  ).length;

  return [ids, classes + attributes + pseudoClasses, types + pseudoElements];
};

const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const show = (t) => `(${t[0]},${t[1]},${t[2]})`;

/** Innermost `selector { declarations }` blocks, media queries included. */
const blocks = (text) => {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = re.exec(text))) {
    const selector = match[1].trim();
    if (selector.startsWith('@')) continue;
    out.push({ selector, body: match[2] });
  }
  return out;
};

const declaresActiveBlur = (body) =>
  /(?:^|;|\s)(?:-webkit-)?backdrop-filter\s*:\s*(?!none)[^;]+/i.test(body);

const isOverrideBlock = (selector) => /\[data-glass=['"](?:off|lite)['"]\]/.test(selector);

const run = () => {
  const files = cssFiles(SRC);

  /** Every rule that turns a blur ON, with the heaviest selector in its list. */
  const blurRules = [];
  /** The policy blocks, by tier. */
  const overrides = { off: [], lite: [] };

  for (const file of files) {
    const text = stripComments(readFileSync(file, 'utf8'));
    for (const { selector, body } of blocks(text)) {
      const selectors = selector.split(',').map((part) => part.trim()).filter(Boolean);
      if (isOverrideBlock(selector)) {
        const tier = /data-glass=['"]off['"]/.test(selector) ? 'off' : 'lite';
        for (const one of selectors) {
          overrides[tier].push({ file: relative(ROOT, file), selector: one, spec: specificity(one) });
        }
        continue;
      }
      if (!declaresActiveBlur(body)) continue;
      for (const one of selectors) {
        blurRules.push({ file: relative(ROOT, file), selector: one, spec: specificity(one) });
      }
    }
  }

  const failures = [];

  if (!blurRules.length) failures.push('found no backdrop-filter rules at all — the parser is broken, not the CSS');
  if (!overrides.off.length) failures.push("found no `[data-glass='off']` block — the diagnostic switch is gone");
  if (!overrides.lite.length) failures.push("found no `[data-glass='lite']` block — the low-power tier is gone");

  // --- the OFF diagnostic must beat every blur rule in the app ---------------
  const offSpec = overrides.off.reduce(
    (weakest, rule) => (weakest === null || compare(rule.spec, weakest) < 0 ? rule.spec : weakest),
    null
  );
  if (offSpec) {
    for (const rule of blurRules) {
      if (compare(offSpec, rule.spec) <= 0) {
        failures.push(
          `?glass=off weighs ${show(offSpec)} but ${rule.file} "${rule.selector}" weighs ` +
            `${show(rule.spec)} — the switch cannot turn that blur off`
        );
      }
    }
  }

  // --- each LITE target must beat the blur rules that mention it -------------
  // The tier only claims the selectors it lists, so it is only held to those.
  for (const override of overrides.lite) {
    const target = (override.selector.match(/\.[\w-]+(?![\w-])/g) || []).pop();
    if (!target) continue;
    for (const rule of blurRules) {
      if (!rule.selector.includes(target)) continue;
      if (compare(override.spec, rule.spec) <= 0) {
        failures.push(
          `lite rule "${override.selector}" weighs ${show(override.spec)} but ${rule.file} ` +
            `"${rule.selector}" weighs ${show(rule.spec)} — the flat fill loses`
        );
      }
    }
  }

  return { failures, blurRuleCount: blurRules.length, offSpec, liteCount: overrides.lite.length };
};

export const assertGlassOverrideWins = run;

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('assertGlassOverrideWins.mjs')) {
  const { failures, blurRuleCount, offSpec } = run();
  if (failures.length) {
    console.error('glass override cascade check FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(
    `glass override cascade OK: ?glass=off weighs ${show(offSpec)} and beats all ${blurRuleCount} blur declarations`
  );
}
