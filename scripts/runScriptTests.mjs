import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
if (process.platform === 'win32') {
  // Windows' bash.exe can be a WSL shim without a Linux installation.
  // Select Git Bash only for this test process; leave the user's PATH intact.
  const gitPaths = spawnSync('where.exe', ['git.exe'], { encoding: 'utf8', windowsHide: true });
  const candidates = (gitPaths.stdout || '').trim().split(/\r?\n/).filter(Boolean)
    .map(path => resolve(dirname(path), '../usr/bin'));
  for (const base of [env.ProgramFiles, env.ProgramW6432]) {
    if (base) candidates.push(join(base, 'Git/usr/bin'));
  }
  const bashDir = candidates.find(path => existsSync(join(path, 'bash.exe')));
  if (!bashDir) {
    console.error('Script tests need Git for Windows (including Git Bash). Install it and retry.');
    process.exit(1);
  }
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
  env[pathKey] = `${bashDir};${env[pathKey] || ''}`;
}

const result = spawnSync(process.execPath, ['--test',
  'scripts/devLocal.test.mjs',
  'scripts/generateScenePack.test.mjs',
  'scripts/updateCatalog.test.mjs',
  'deploy/server/s3put.test.mjs',
  'deploy/server/deployScripts.test.mjs',
  '.claude/hooks/guard-bash.test.mjs',
  '.claude/hooks/guard-paths.test.mjs'
], { cwd: root, env, stdio: 'inherit', windowsHide: true });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
