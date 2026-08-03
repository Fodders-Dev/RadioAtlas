import { describe, expect, it } from 'vitest';
import { ruDictionary as ru } from './ru';
import { enDictionary as en } from './en';

/**
 * The two dictionaries are kept parallel BY HAND, and nothing enforced it.
 *
 * A key present in `ru` but missing from `en` does not fall back — the lookup
 * returns the literal key path, so an English listener reads «dock.myNewKey» on
 * screen. Worse, `en` is code-split and loaded on idle, so they first see the
 * RUSSIAN value and then watch it flip to the raw key. A key missing from `ru`
 * shows its raw path permanently, since `ru` is the default.
 *
 * This test exists because a single change added 89 keys to both files; getting
 * one wrong is a silent, user-visible defect that no type, lint rule or existing
 * test would catch.
 */
type Tree = Record<string, unknown>;

const paths = (tree: Tree, prefix = ''): string[] =>
  Object.entries(tree).flatMap(([key, value]) => {
    const here = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? paths(value as Tree, here)
      : [here];
  });

// Placeholders are substituted with /\{(\w+)\}/g, and \w does not match
// Cyrillic — a token like {станций} would render literally.
const TOKENS = /\{([^}]+)\}/g;
const tokensOf = (value: unknown): string[] =>
  typeof value === 'string' ? [...value.matchAll(TOKENS)].map((m) => m[1]).sort() : [];

const at = (tree: Tree, path: string): unknown =>
  path.split('.').reduce<unknown>((node, key) => (node as Tree | undefined)?.[key], tree);

describe('locale dictionaries', () => {
  const ruPaths = paths(ru as Tree);
  const enPaths = paths(en as Tree);

  it('have exactly the same key paths', () => {
    expect([...enPaths].sort()).toEqual([...ruPaths].sort());
  });

  it('agree on the placeholder tokens in every string', () => {
    const mismatched = ruPaths
      .map((path) => ({ path, ru: tokensOf(at(ru as Tree, path)), en: tokensOf(at(en as Tree, path)) }))
      .filter((entry) => entry.ru.join('|') !== entry.en.join('|'));
    expect(mismatched).toEqual([]);
  });

  it('use only ASCII placeholder tokens', () => {
    const nonAscii = ruPaths
      .flatMap((path) => tokensOf(at(ru as Tree, path)).map((token) => ({ path, token })))
      .filter((entry) => !/^\w+$/.test(entry.token));
    expect(nonAscii).toEqual([]);
  });

  it('leave no value empty in either language', () => {
    const empty = ruPaths.filter((path) => {
      const r = at(ru as Tree, path);
      const e = at(en as Tree, path);
      return (typeof r === 'string' && !r.trim()) || (typeof e === 'string' && !e.trim());
    });
    expect(empty).toEqual([]);
  });
});
