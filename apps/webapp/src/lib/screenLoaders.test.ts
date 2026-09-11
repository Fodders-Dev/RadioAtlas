import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Production regression, 11.09.2026: two `import()` calls inside one ternary
// made Vite attach only the first branch's preload list (chunk + CSS) to the
// wrapper, so the calm Globe reached listeners without its stylesheet. Dev
// mode cannot catch it — CSS is served as modules there — so the SHAPE of the
// loader file is checked instead: every dynamic import must be the whole body
// of its own arrow function, never an operand of a conditional.
describe('screenLoaders', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/lib/screenLoaders.ts'), 'utf8');

  it('keeps every dynamic import in its own arrow function', () => {
    const statements = source.split(/;\s*\n/).filter((chunk) => chunk.includes('import('));
    expect(statements.length).toBeGreaterThan(5);
    for (const statement of statements) {
      const body = statement.replace(/\/\/.*$/gm, '');
      expect(body.match(/import\(/g)?.length, statement).toBe(1);
      expect(body, statement).not.toMatch(/\?\s*import\(|:\s*import\(/);
      expect(body, statement).toMatch(/=>\s*\n?\s*import\(/);
    }
  });
});
