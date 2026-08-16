import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * The write-side guard. Same rule as `guard-bash.test.mjs`: a hook that blocks
 * too much is a hook someone switches off, so the allowed cases are pinned as
 * carefully as the blocked ones. Both entries under "templates" are here
 * because the first version refused to let anyone edit `.env.example`, a
 * tracked file that holds no value at all and documents the ones that do.
 */

const HOOK = fileURLToPath(new URL('./guard-paths.sh', import.meta.url));
const BLOCKED = 2;
const ALLOWED = 0;

const run = (filePath, toolName = 'Write') => {
  const result = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ tool_name: toolName, tool_input: { file_path: filePath } }),
    encoding: 'utf8'
  });
  return { code: result.status, reason: (result.stderr || '').trim() };
};

const cases = [
  // Secrets.
  [BLOCKED, 'C:/repo/apps/api/.env'],
  [BLOCKED, 'C:/repo/.env.production'],
  [BLOCKED, '/opt/RadioAtlas/shared/env/api.env'],
  // Templates: the file you are meant to edit.
  [ALLOWED, 'C:/repo/apps/api/.env.example'],
  [ALLOWED, 'C:/repo/apps/bot/.env.sample'],

  // The developer's local stores. A test overwrote the 70MB snapshot here once.
  [BLOCKED, 'C:/repo/apps/api/data/catalog-full.json'],
  [BLOCKED, "C:/Fodder's/repo/apps/api/data/account-store.sqlite"],
  // Generated output.
  [BLOCKED, 'C:/repo/artifacts/catalog-fast.json'],
  [BLOCKED, 'C:/repo/apps/webapp/dist/assets/index-abc.css'],
  [BLOCKED, 'C:/repo/node_modules/left-pad/index.js'],
  [BLOCKED, 'C:/repo/apps/webapp/playwright-report/index.html'],

  // Ordinary sources and docs.
  [ALLOWED, 'C:/repo/apps/api/src/index.ts'],
  [ALLOWED, 'C:/repo/apps/webapp/src/components/ChatSheet.css'],
  [ALLOWED, 'C:/repo/RUNBOOK.md'],
  [ALLOWED, 'C:/repo/scripts/updateCatalog.mjs'],
  // A source file that merely mentions data/ in its path segment is fine.
  [ALLOWED, 'C:/repo/apps/api/src/dataShapes.ts']
];

for (const [expected, filePath] of cases) {
  test(`${expected === BLOCKED ? 'blocks' : 'allows'}: ${filePath}`, () => {
    const { code, reason } = run(filePath);
    assert.equal(
      code,
      expected,
      expected === BLOCKED ? 'this write must not get through' : `blocked an ordinary write: ${reason}`
    );
    if (expected === BLOCKED) {
      assert.match(reason, /^guard-paths: refusing to write .+ — ./, 'a block must explain itself');
    }
  });
}

test('a NotebookEdit payload is read from notebook_path', () => {
  const result = spawnSync('bash', [HOOK], {
    input: JSON.stringify({
      tool_name: 'NotebookEdit',
      tool_input: { notebook_path: 'C:/repo/apps/api/data/scratch.ipynb' }
    }),
    encoding: 'utf8'
  });
  assert.equal(result.status, BLOCKED);
});

test('an unrecognised payload shape falls through to the permission layer', () => {
  const result = spawnSync('bash', [HOOK], { input: '{"tool_input":{}}', encoding: 'utf8' });
  assert.equal(result.status, ALLOWED);
});
