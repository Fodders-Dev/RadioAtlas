import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { access, readFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitIdentity, runVerification, spawnProcess } from './verifyProject.mjs';

const cleanIdentity = { branch: 'codex/test', head: 'abc123', dirty: false, status: [], fingerprint: 'clean' };
async function outputDir() { return mkdtemp(join(tmpdir(), 'radioatlas-verify-')); }
async function reportAt(dir) { return JSON.parse(await readFile(join(dir, 'report.json'), 'utf8')); }

test('dry run records plans and performs no child process execution', async () => {
  const dir = await outputDir();
  let calls = 0;
  const code = await runVerification(['--dry-run', '--profile', 'release', '--output', dir], {
    root: dir, env: { npm_execpath: 'C:/Node/npm-cli.js', API_SECRET_TEST_SENTINEL: 'must-not-appear' }, identity: async () => cleanIdentity,
    run: async () => { calls += 1; throw new Error('must not execute'); },
  });
  const report = await reportAt(dir);
  assert.equal(code, 0);
  assert.equal(calls, 0);
  assert.equal(report.result, 'planned');
  assert.ok(report.steps.every(step => step.status === 'PLANNED'));
  assert.ok(report.steps.some(step => step.name === 'functional-browser-tests' && step.envOverrides.PLAYWRIGHT_SKIP_PIXELS === '1'));
  assert.ok(report.steps.some(step => step.name === 'lira-offline-eval'));
  assert.deepEqual(report.steps.map(step => step.name), [
    'source-typecheck', 'test-typecheck', 'api-tests', 'bot-tests', 'script-tests',
    'webapp-unit-tests', 'lira-offline-eval', 'build', 'functional-browser-tests',
  ]);
  assert.ok(report.steps.every(step => step.argv[0] === process.execPath && step.argv[1] === 'C:/Node/npm-cli.js'));
  assert.ok(!JSON.stringify(report).includes('must-not-appear'));
});

test('first failed step returns nonzero and leaves later steps NOT_RUN', async () => {
  const dir = await outputDir();
  const calls = [];
  const code = await runVerification(['--profile', 'fast', '--output', dir], {
    root: dir, identity: async () => cleanIdentity,
    run: async (command, args, config) => {
      calls.push(args.join(' '));
      config.onStdout(Buffer.from('step output\n'));
      return { exitCode: calls.length === 3 ? 7 : 0 };
    },
  });
  const report = await reportAt(dir);
  assert.equal(code, 1);
  assert.equal(calls.length, 3);
  assert.equal(report.steps[2].status, 'FAILED');
  assert.equal(report.steps[2].exitCode, 7);
  assert.ok(report.steps.slice(3).every(step => step.status === 'NOT_RUN'));
  assert.match(await readFile(report.steps[0].logPath, 'utf8'), /step output/);
});

test('partial report is already persisted as RUNNING before a step executor starts', async () => {
  const dir = await outputDir();
  let observed;
  const code = await runVerification(['--output', dir], {
    root: dir, identity: async () => cleanIdentity,
    run: async () => {
      observed = JSON.parse(await readFile(join(dir, 'report.json'), 'utf8'));
      return { exitCode: 9 };
    },
  });
  assert.equal(code, 1);
  assert.equal(observed.result, 'running');
  assert.equal(observed.steps[0].status, 'RUNNING');
  assert.ok(observed.steps[0].startedAt);
  assert.ok(observed.steps.slice(1).every(step => step.status === 'NOT_RUN'));
  assert.match(await readFile(join(dir, 'report.md'), 'utf8'), /marked running is incomplete/);
});

test('signal during awaited pre-step report persistence prevents spawning the step', async () => {
  const dir = await outputDir();
  const signalSource = new EventEmitter();
  let calls = 0;
  const code = await runVerification(['--output', dir], {
    root: dir, identity: async () => cleanIdentity, signalSource, reraiseSignal: false,
    afterPersist: report => {
      if (report.steps[0].status === 'RUNNING') signalSource.emit('SIGTERM');
    },
    run: async () => { calls += 1; return { exitCode: 0 }; },
  });
  const report = await reportAt(dir);
  assert.equal(code, 1);
  assert.equal(calls, 0);
  assert.equal(report.result, 'interrupted');
  assert.equal(report.steps[0].status, 'NOT_RUN');
  assert.match(report.steps[0].error, /before starting SIGTERM/);
});

test('spawn errors are recorded as failure and stop the plan', async () => {
  const dir = await outputDir();
  let calls = 0;
  const code = await runVerification(['--output', dir], {
    root: dir, identity: async () => cleanIdentity,
    run: async () => { calls += 1; return { exitCode: null, error: 'spawn denied' }; },
  });
  const report = await reportAt(dir);
  assert.equal(code, 1);
  assert.equal(calls, 1);
  assert.equal(report.steps[0].error, 'spawn denied');
  assert.ok(report.steps.slice(1).every(step => step.status === 'NOT_RUN'));
});

test('thrown executor exceptions are reported and stop later steps', async () => {
  const dir = await outputDir();
  const code = await runVerification(['--output', dir], {
    root: dir, identity: async () => cleanIdentity,
    run: async () => { throw new Error('executor exploded'); },
  });
  const report = await reportAt(dir);
  assert.equal(code, 1);
  assert.equal(report.steps[0].error, 'executor exploded');
  assert.ok(report.steps.slice(1).every(step => step.status === 'NOT_RUN'));
  assert.match(await readFile(join(dir, 'report.md'), 'utf8'), /executor exploded/);
});

test('log IO errors fail the step while still writing machine and Markdown reports', async () => {
  const dir = await outputDir();
  await mkdir(join(dir, '01-source-typecheck.log'));
  const code = await runVerification(['--output', dir], {
    root: dir, identity: async () => cleanIdentity, run: async () => ({ exitCode: 0 }),
  });
  const report = await reportAt(dir);
  assert.equal(code, 1);
  assert.equal(report.steps[0].status, 'FAILED');
  assert.match(report.steps[0].error, /directory|EISDIR|log/i);
  assert.ok((await readFile(join(dir, 'report.md'), 'utf8')).includes('FAILED'));
});

test('initial and final checkout identity exposes dirty changes during verification', async () => {
  const dir = await outputDir();
  const identities = [cleanIdentity, { ...cleanIdentity, head: 'def456', dirty: true, status: [' M apps/api/test/x.test.ts'], fingerprint: 'changed' }];
  const code = await runVerification(['--output', dir], {
    root: dir, identity: async () => identities.shift(),
    run: async () => ({ exitCode: 0 }),
  });
  const report = await reportAt(dir);
  assert.equal(code, 1);
  assert.equal(report.checkout.initial.dirty, false);
  assert.equal(report.checkout.final.dirty, true);
  assert.equal(report.checkout.changed, true);
});

test('same dirty branch and HEAD with a changed diff fingerprint invalidates the receipt', async () => {
  const dir = await outputDir();
  const base = { branch: 'codex/test', head: 'abc123', dirty: true, status: [' M apps/api/test/x.test.ts'] };
  const identities = [{ ...base, trackedDiffSha256: 'before', fingerprint: 'one' }, { ...base, trackedDiffSha256: 'after', fingerprint: 'two' }];
  const code = await runVerification(['--output', dir], {
    root: dir, identity: async () => identities.shift(), run: async () => ({ exitCode: 0 }),
  });
  const report = await reportAt(dir);
  assert.equal(code, 1);
  assert.equal(report.steps.every(step => step.status === 'PASSED'), true);
  assert.equal(report.result, 'invalid');
  assert.equal(report.checkout.initial.branch, report.checkout.final.branch);
  assert.equal(report.checkout.initial.head, report.checkout.final.head);
  assert.equal(report.checkout.initial.dirty, true);
  assert.equal(report.checkout.changed, true);
});

test('git identity records porcelain paths and hashes raw tracked diff bytes in memory', async () => {
  const dir = await outputDir();
  await writeFile(join(dir, 'tracked.txt'), 'tracked');
  await writeFile(join(dir, 'new.txt'), 'new');
  const diff = Buffer.from([0x64, 0x69, 0x66, 0x66, 0xff]);
  const fakeGit = async (_command, args, config) => {
    const output = args[0] === 'branch' ? Buffer.from('feature\n')
      : args[0] === 'rev-parse' ? Buffer.from('abc123\n')
        : args[0] === 'status' ? Buffer.from(' M tracked.txt\0?? new.txt\0')
          : diff;
    config.onStdout(output);
    return { exitCode: 0 };
  };
  const identity = await gitIdentity(fakeGit, dir);
  assert.deepEqual(identity.status, [' M tracked.txt', '?? new.txt']);
  assert.equal(identity.dirty, true);
  assert.equal(identity.trackedDiffSha256, createHash('sha256').update(diff).digest('hex'));
  assert.ok(identity.untrackedFingerprint);
});

test('explicit output refuses to overwrite prior reports', async () => {
  const dir = await outputDir();
  const original = '{"evidence":"keep"}';
  await writeFile(join(dir, 'report.json'), original);
  let identities = 0;
  await assert.rejects(() => runVerification(['--output', dir], {
    identity: async () => { identities += 1; return cleanIdentity; },
  }), /Refusing to overwrite/);
  assert.equal(await readFile(join(dir, 'report.json'), 'utf8'), original);
  assert.equal(identities, 0);
});

test('invalid CLI arguments reject before running commands', async () => {
  for (const args of [['--mystery'], ['--profile', 'all'], ['--output']]) {
    await assert.rejects(() => runVerification(args, { run: async () => assert.fail('must not run') }));
  }
});

test('fast and release plans stay aligned with package scripts and the CI entry point', async () => {
  const [rootPackage, webPackage, workflow] = await Promise.all([
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../apps/webapp/package.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'),
  ]);
  assert.equal(rootPackage.scripts.verify, 'node scripts/verifyProject.mjs');
  assert.equal(rootPackage.scripts['typecheck:test'], 'npm run typecheck:test --workspaces');
  assert.equal(rootPackage.scripts['test:api'], 'npm --workspace apps/api run test');
  assert.equal(rootPackage.scripts['test:bot'], 'npm --workspace apps/bot run test');
  assert.equal(rootPackage.scripts['test:scripts'], 'node scripts/runScriptTests.mjs');
  assert.equal(rootPackage.scripts['eval:lira:offline'], 'npm --workspace apps/api run eval:lira:offline --');
  assert.equal(webPackage.scripts['test:unit'], 'vitest run');
  assert.equal(webPackage.scripts['test:e2e:ci'], 'playwright test --workers=1');
  assert.match(workflow, /npm run verify -- --profile fast --output \.tmp\/verification-ci/);
  assert.match(workflow, /path: \.tmp\/verification-ci\/\n\s+if-no-files-found: warn\n\s+include-hidden-files: true/);
});

test('real child exit status and split UTF-8 output are preserved', async () => {
  let stdout = '';
  const result = await spawnProcess(process.execPath, ['-e', "process.stdout.write(Buffer.from([0xd0])); setTimeout(() => { process.stdout.write(Buffer.from([0xb6])); process.exit(7); }, 10)"], {
    cwd: process.cwd(), env: process.env, onStdout: chunk => { stdout += chunk; }, onStderr: () => {},
  });
  assert.equal(result.exitCode, 7);
  assert.equal(stdout, 'ж');
});

test('simulated SIGTERM handler kills the active process tree, writes a report, and returns nonzero', async () => {
  const dir = await outputDir();
  const moduleUrl = new URL('./verifyProject.mjs', import.meta.url).href;
  const source = `
    import { runVerification, spawnProcess } from ${JSON.stringify(moduleUrl)};
    import { EventEmitter } from 'node:events';
    const identity = { branch: 'signal-test', head: 'abc', dirty: false, status: [], fingerprint: 'same' };
    const signalSource = new EventEmitter();
    setTimeout(() => signalSource.emit('SIGTERM'), 500);
    const result = await runVerification(['--output', ${JSON.stringify(dir)}], {
      identity: async () => identity,
      signalSource,
      reraiseSignal: false,
      run: async (_command, _args, config) => spawnProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], config),
    });
    process.exitCode = result;
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  const timeout = setTimeout(() => {
    if (process.platform === 'win32') {
      spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
  }, 4000);
  timeout.unref();
  const closed = await new Promise(resolve => child.on('close', (code, signal) => { clearTimeout(timeout); resolve({ code, signal }); }));
  const report = await reportAt(dir);
  assert.equal(closed.code, 1);
  assert.equal(closed.signal, null);
  assert.equal(report.result, 'interrupted');
  assert.equal(report.steps[0].status, 'FAILED');
  assert.equal(report.steps[0].error?.includes('SIGTERM'), true);
  assert.ok(report.steps.slice(1).every(step => step.status === 'NOT_RUN'));
});

test('active verification docs stay concise and point to real test files', async () => {
  const handoff = await readFile(new URL('../docs/WORKING-SETUP.md', import.meta.url), 'utf8');
  assert.ok(handoff.split(/\r?\n/).length - 1 <= 120);
  const quality = await readFile(new URL('../docs/DEVELOPMENT-QUALITY.md', import.meta.url), 'utf8');
  const refs = [...new Set(quality.match(/\bapps\/[A-Za-z0-9_./-]*\.(?:test|spec)\.[A-Za-z0-9_.-]+/g) ?? [])];
  assert.ok(refs.length > 0);
  await Promise.all(refs.map(path => access(new URL(`../${path}`, import.meta.url))));
});
