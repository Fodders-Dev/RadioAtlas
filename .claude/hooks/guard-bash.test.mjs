import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * The lesson that produced this file: `assertBackdropFilterOrder.mjs` was a
 * correct guard wired to nothing, and by the time anyone ran it the defect it
 * existed to prevent had been live in production for months. A guard nobody
 * runs is not a guard, so this one is executed by `npm run test:scripts`, which
 * CI runs.
 *
 * Both directions matter equally. A hook that blocks too much gets switched off
 * within a week — the first version of this one refused to let anyone commit a
 * message that quoted the commands it blocks.
 */

const HOOK = fileURLToPath(new URL('./guard-bash.sh', import.meta.url));
const BLOCKED = 2;
const ALLOWED = 0;

const run = (command) => {
  const result = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8'
  });
  return { code: result.status, reason: (result.stderr || '').trim() };
};

const cases = [
  // Recursive force-deletes, in every spelling and behind every wrapper.
  [BLOCKED, 'rm -rf /opt/RadioAtlas'],
  [BLOCKED, 'rm -fr node_modules'],
  [BLOCKED, 'rm -r -f dist'],
  [BLOCKED, 'cd apps && rm -rf .tmp'],
  [BLOCKED, '"/c/Program Files/Git/usr/bin/ssh.exe" rodnya "rm -rf /opt/RadioAtlas/releases"'],
  [ALLOWED, 'rmdir empty'],
  [ALLOWED, 'rm /tmp/one-file.txt'],

  // Anything that throws away work that exists nowhere else.
  [BLOCKED, 'git reset --hard'],
  [BLOCKED, 'git reset --hard origin/master'],
  [BLOCKED, 'git clean -fd'],
  [BLOCKED, 'git checkout -- apps/webapp/src'],
  [BLOCKED, 'git stash drop'],
  [BLOCKED, 'git branch -D feature'],
  [ALLOWED, 'git restore --staged apps/api'],
  [ALLOWED, 'git checkout master'],

  // A force push rewrites the branch the VPS deploys from.
  [BLOCKED, 'git push --force origin master'],
  [BLOCKED, 'git push -f'],
  [BLOCKED, 'git push -f origin master'],
  [BLOCKED, 'git push --force-with-lease'],
  [ALLOWED, 'git push'],
  [ALLOWED, 'git push origin master'],
  [ALLOWED, 'git push -u origin feature'],

  // pm2 update hung on this shared box and took the neighbours down with us.
  [BLOCKED, 'pm2 update'],
  [BLOCKED, 'ssh rodnya "pm2 update"'],
  [BLOCKED, 'pm2 kill'],
  [ALLOWED, 'pm2 restart radioatlas-api'],
  [ALLOWED, 'pm2 jlist'],
  [ALLOWED, 'pm2 updateXyz'],

  // Env files are written by the owner, on the server, never from here.
  [BLOCKED, 'echo TOKEN=x > apps/api/.env'],
  [BLOCKED, 'cp local.env /opt/RadioAtlas/shared/env/api.env'],
  [ALLOWED, 'grep -c INTERNAL_WEBHOOK_TOKEN /opt/RadioAtlas/shared/env/api.env'],

  // A heredoc body is data — unless whatever receives it can execute it.
  [ALLOWED, 'git commit -F - <<EOF\nfix: explain why rm -rf and git push --force are blocked\nEOF'],
  [ALLOWED, 'cat > notes.md <<EOF\nwe never run pm2 update on this box\nEOF'],
  // Committing the hook itself: the path ends in `.sh`, which an earlier
  // version read as a pipe into a shell and blocked.
  [
    ALLOWED,
    'git add .claude/hooks/guard-bash.sh && git commit -F - <<EOF\nrefuses rm -rf and git push --force\nEOF'
  ],
  [BLOCKED, 'bash <<EOF\nrm -rf /opt/RadioAtlas\nEOF'],
  [BLOCKED, 'ssh rodnya <<EOF\npm2 update\nEOF'],
  [BLOCKED, 'node <<EOF\nrequire("child_process").execSync("rm -rf x")\nEOF'],

  // The commands this project actually runs all day.
  [ALLOWED, 'npm run build'],
  [ALLOWED, 'npm --workspace apps/webapp run test:unit'],
  [ALLOWED, 'git add -A && git commit -m "x"'],
  [ALLOWED, 'npm ci --force'],
  [ALLOWED, 'git status --porcelain']
];

for (const [expected, command] of cases) {
  const label = command.replace(/\n/g, ' ⏎ ');
  test(`${expected === BLOCKED ? 'blocks' : 'allows'}: ${label}`, () => {
    const { code, reason } = run(command);
    assert.equal(
      code,
      expected,
      expected === BLOCKED
        ? 'this must not get through the guard'
        : `the guard blocked an ordinary command: ${reason}`
    );
    if (expected === BLOCKED) {
      assert.match(reason, /^guard-bash: refusing to run this — ./, 'a block must explain itself');
    }
  });
}
