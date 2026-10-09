import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_VERSION = 1;

function parseArgs(argv) {
  let profile = 'fast';
  let output;
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--profile') {
      const value = argv[++index];
      if (value !== 'fast' && value !== 'release') throw new Error(`Unknown profile: ${value ?? '(missing)'}`);
      profile = value;
    } else if (arg === '--output') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error('--output requires a directory');
      output = value;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return { profile, output, dryRun };
}

function npmInvocation(env) {
  // npm sets npm_execpath to its JS CLI when it launches package scripts.
  // Calling that file through the current Node avoids the Windows .cmd shim.
  const npmCli = env.npm_execpath;
  if (npmCli && npmCli.toLowerCase().endsWith('.js')) return { command: process.execPath, prefix: [npmCli] };
  if (process.platform === 'win32') {
    // The standard Node for Windows install keeps npm's JS CLI alongside node.
    // This executes the JS entry directly and never asks cmd.exe to parse args.
    const adjacentCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (existsSync(adjacentCli)) return { command: process.execPath, prefix: [adjacentCli] };
    throw new Error('Could not locate npm CLI safely; launch this runner with `npm run verify`.');
  }
  return { command: 'npm', prefix: [] };
}

function makePlan(profile, env) {
  const npm = npmInvocation(env);
  const npmArgs = (...args) => [npm.command, ...npm.prefix, ...args];
  const steps = [
    ['source-typecheck', npmArgs('run', 'typecheck')],
    ['test-typecheck', npmArgs('run', 'typecheck:test')],
    ['api-tests', npmArgs('run', 'test:api')],
    ['bot-tests', npmArgs('run', 'test:bot')],
    ['script-tests', npmArgs('run', 'test:scripts')],
    ['webapp-unit-tests', npmArgs('--workspace', 'apps/webapp', 'run', 'test:unit')],
  ];
  if (profile === 'release') {
    steps.push(
      ['lira-offline-eval', npmArgs('run', 'eval:lira:offline')],
      ['build', npmArgs('run', 'build')],
      ['functional-browser-tests', npmArgs('--workspace', 'apps/webapp', 'run', 'test:e2e:ci')],
    );
  }
  return steps.map(([name, argv]) => ({
    name,
    argv,
    envOverrides: name === 'functional-browser-tests' ? { PLAYWRIGHT_SKIP_PIXELS: '1' } : {},
  }));
}

export function spawnProcess(command, args, options) {
  return new Promise((resolveResult) => {
    let child;
    try {
      child = spawn(command, args, {
        ...options,
        windowsHide: true,
        shell: false,
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      resolveResult({ exitCode: null, error: error.message });
      return;
    }
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      resolveResult(result);
    };
    child.on('error', error => finish({ exitCode: null, error: error.message }));
    child.on('close', (code, signal) => finish({ exitCode: code, signal }));
    if (!options.rawStdout) child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', chunk => options.onStdout?.(chunk));
    child.stderr?.on('data', chunk => options.onStderr?.(chunk));
    options.onChild?.(child);
  });
}

function terminateProcessTree(child, signal) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    // Fixed executable and arguments; kill npm and every process it started.
    try {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true, shell: false, stdio: 'ignore',
      });
      killer.on('error', () => child.kill(signal));
      killer.on('close', code => { if (code !== 0) child.kill(signal); });
    } catch {
      child.kill(signal);
    }
  } else {
    try { process.kill(-child.pid, signal); } catch { child.kill(signal); }
  }
}

export async function gitIdentity(run, root) {
  const call = async (args, { onStdout = () => {}, keepOutput = true } = {}) => {
    const chunks = [];
    try {
      const result = await run('git', args, {
        cwd: root, env: process.env, windowsHide: true, rawStdout: true,
        onStdout: chunk => {
          const data = Buffer.from(chunk);
          if (keepOutput) chunks.push(data);
          onStdout(data);
        },
      });
      if (result.exitCode !== 0 || result.error) return null;
      return keepOutput ? Buffer.concat(chunks) : Buffer.alloc(0);
    } catch {
      return null;
    }
  };
  const diffHash = createHash('sha256');
  const [branchBytes, headBytes, statusBytes, diffBytes] = await Promise.all([
    call(['branch', '--show-current']),
    call(['rev-parse', 'HEAD']),
    call(['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    call(['diff', 'HEAD', '--no-ext-diff', '--no-textconv', '--binary', '--', '.', ':(exclude)**/.env', ':(exclude)**/.env.*', ':(exclude)apps/api/data/**', ':(exclude)artifacts/catalog*'], { onStdout: chunk => diffHash.update(chunk), keepOutput: false }),
  ]);
  if (!branchBytes || !headBytes || !statusBytes || !diffBytes) return null;
  const statusEntries = statusBytes.toString('utf8').split('\0').filter(Boolean);
  const changedPaths = [];
  const untracked = [];
  for (let index = 0; index < statusEntries.length; index += 1) {
    const entry = statusEntries[index];
    if (entry.startsWith('?? ')) {
      const path = entry.slice(3);
      changedPaths.push(path);
      untracked.push(path);
    } else if (/^[ MADRCU?!]{2} /.test(entry)) {
      changedPaths.push(entry.slice(3));
      if (/[RC]/.test(entry.slice(0, 2)) && statusEntries[index + 1]) changedPaths.push(statusEntries[++index]);
    }
  }
  const fileStats = await Promise.all(changedPaths.map(async path => {
    try {
      const value = await lstat(resolve(root, path));
      return [path, value.size, value.mtimeMs, value.mode];
    } catch {
      return [path, null, null, null];
    }
  }));
  const trackedDiffSha256 = diffHash.digest('hex');
  const untrackedStats = fileStats.filter(([path]) => untracked.includes(path));
  const untrackedFingerprint = createHash('sha256').update(JSON.stringify(untrackedStats)).digest('hex');
  const workingFileMetadataFingerprint = createHash('sha256').update(JSON.stringify(fileStats)).digest('hex');
  const branch = branchBytes.toString('utf8').trim();
  const head = headBytes.toString('utf8').trim();
  return {
    branch,
    head,
    dirty: statusEntries.length > 0,
    status: statusEntries,
    trackedDiffSha256,
    untrackedFingerprint,
    workingFileMetadataFingerprint,
    fingerprint: createHash('sha256').update(JSON.stringify([branch, head, statusEntries, trackedDiffSha256, untrackedFingerprint, workingFileMetadataFingerprint])).digest('hex'),
  };
}

function markdownReport(report) {
  const rows = report.steps.map(step => [
    `| ${step.name} | ${step.status} | ${step.exitCode ?? '—'} | ${step.durationMs ?? '—'} ms |`,
    `| Command | \`${JSON.stringify(step.argv)}\` | Env overrides | \`${JSON.stringify(step.envOverrides)}\` |`,
    `| Error | ${step.error ? `\`${step.error.replaceAll('`', '\\`')}\`` : '—'} | Log | ${step.logPath ?? '—'} |`,
  ].join('\n')).join('\n');
  const identity = value => value ? `${value.branch ?? 'unknown'} @ ${value.head ?? 'unknown'}; dirty=${value.dirty ?? 'unknown'}${value.dirty ? `; porcelain=${JSON.stringify(value.status)}` : ''}` : 'unknown';
  return [
    '# Developer verification report', '',
    `**Profile:** ${report.profile}  `,
    `**Result:** ${report.result}  `,
    `**Error:** ${report.error ?? '—'}  `,
    `**Started:** ${report.startedAt}  `,
    `**Ended:** ${report.endedAt ?? 'in progress'}  `,
    `**Duration:** ${report.durationMs ?? '—'} ms`, '',
    `Initial checkout: ${identity(report.checkout.initial)}`,
    `Final checkout: ${identity(report.checkout.final)}`,
    `Checkout changed: ${report.checkout.changed ?? 'unknown'}`, '',
    '| Step | Status | Exit code | Duration |', '|---|---|---:|---:|', rows || '| — | — | — | — |', '',
    'This report is a developer verification aid, not production approval. Automated checks do not verify real audio on a device or judge the visual design. A dry run records planned commands only; it does not mean checks passed. A report marked running is incomplete and cannot imply checks passed.',
    '',
  ].join('\n');
}

async function writeReports(report, outputDir, state) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: state.json ? 'w' : 'wx' });
  state.json = true;
  await writeFile(join(outputDir, 'report.md'), markdownReport(report), { encoding: 'utf8', flag: state.markdown ? 'w' : 'wx' });
  state.markdown = true;
}

export async function runVerification(argv, options = {}) {
  const { profile, output, dryRun } = parseArgs(argv);
  const root = options.root ?? REPO_ROOT;
  const env = options.env ?? process.env;
  const run = options.run ?? ((command, args, config) => spawnProcess(command, args, config));
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const plan = makePlan(profile, env);
  const timestamp = startedAt.replaceAll(/[-:.]/g, '');
  let outputDir = output ? resolve(root, output) : resolve(root, '.tmp', 'verifyProject', `${timestamp}-${process.pid}`);
  if (!output) {
    const base = outputDir;
    let suffix = 0;
    while (existsSync(outputDir)) outputDir = `${base}-${++suffix}`;
  }
  await mkdir(outputDir, { recursive: true });
  const reportFiles = ['report.json', 'report.md'].map(name => join(outputDir, name));
  if (output && reportFiles.some(path => existsSync(path))) {
    throw new Error(`Refusing to overwrite an existing verification report in ${outputDir}`);
  }
  const report = {
    schemaVersion: SCHEMA_VERSION,
    profile,
    result: 'running',
    startedAt,
    endedAt: null,
    durationMs: null,
    error: null,
    checkout: { initial: null, final: null, changed: null },
    steps: plan.map(step => ({ ...step, status: dryRun ? 'PLANNED' : 'NOT_RUN', startedAt: null, endedAt: null, durationMs: null, exitCode: null, error: null, logPath: null })),
  };
  let interrupted = null;
  let activeChild = null;
  const signalSource = options.signalSource ?? process;
  const stopTree = options.terminateTree ?? terminateProcessTree;
  const handleSignal = signal => {
    interrupted = signal;
    stopTree(activeChild, signal);
  };
  const signalHandlers = ['SIGINT', 'SIGTERM'].map(signal => {
    const handler = () => handleSignal(signal);
    signalSource.on(signal, handler);
    return [signal, handler];
  });
  const identityReader = options.identity ?? gitIdentity;
  const reportFilesState = { json: false, markdown: false };
  const persistReport = async () => {
    await writeReports(report, outputDir, reportFilesState);
    await options.afterPersist?.(report);
  };
  let resultCode = 1;
  try {
    await persistReport();
    try { report.checkout.initial = await identityReader(run, root); } catch { report.checkout.initial = null; }
    if (!report.checkout.initial) report.error = 'Initial git identity could not be captured';
    await persistReport();
    if (!dryRun && !report.error) {
      for (let index = 0; index < plan.length; index += 1) {
        const step = report.steps[index];
        if (interrupted) { step.error = `Not run after ${interrupted}`; break; }
        step.status = 'RUNNING';
        step.startedAt = new Date().toISOString();
        const stepStart = Date.now();
        await persistReport();
        if (interrupted) {
          step.status = 'NOT_RUN';
          step.error = `Interrupted before starting ${interrupted}`;
          step.startedAt = null;
          await persistReport();
          break;
        }
        const logFile = join(outputDir, `${String(index + 1).padStart(2, '0')}-${step.name}.log`);
        step.logPath = logFile;
        let log;
        let logError = null;
        let logFinished = Promise.resolve();
        try {
          log = createWriteStream(logFile, { encoding: 'utf8', flags: 'wx' });
          log.on('error', error => { logError = error; });
          logFinished = Promise.race([
            once(log, 'finish'),
            once(log, 'error').then(([error]) => { throw error; }),
          ]).catch(error => { logError = error; });
        } catch (error) {
          step.error = `Could not create step log: ${error.message}`;
        }
        let childResult = null;
        if (!step.error) {
          const writeChunk = (chunk, stream) => {
            const value = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
            try { log.write(value); } catch (error) { logError = error; }
            try { (options.console ?? process)[stream]?.write(value); } catch (error) { logError ??= error; }
          };
          try {
            childResult = await run(step.argv[0], step.argv.slice(1), {
              cwd: root, env: { ...env, ...step.envOverrides }, windowsHide: true,
              onStdout: data => writeChunk(data, 'stdout'),
              onStderr: data => writeChunk(data, 'stderr'),
              onChild: child => {
                activeChild = child;
                if (interrupted) stopTree(child, interrupted);
              },
            });
          } catch (error) {
            childResult = { exitCode: null, error: error.message };
          } finally {
            activeChild = null;
          }
        }
        if (log) {
          log.end();
          await logFinished;
        }
        childResult ??= { exitCode: null, error: step.error };
        step.exitCode = childResult.exitCode;
        step.error = childResult.error ?? (childResult.signal ? `Terminated by ${childResult.signal}` : null) ?? logError?.message ?? (interrupted ? `Interrupted by ${interrupted}` : null);
        step.status = step.error || childResult.signal || childResult.exitCode !== 0 ? 'FAILED' : 'PASSED';
        step.endedAt = new Date().toISOString();
        step.durationMs = Date.now() - stepStart;
        await persistReport();
        if (step.status === 'FAILED') break;
      }
    }
    if (interrupted) {
      const next = report.steps.find(step => step.status === 'NOT_RUN');
      if (next) next.error ??= `Not run after ${interrupted}`;
    }
    try { report.checkout.final = await identityReader(run, root); } catch { report.checkout.final = null; }
    report.checkout.changed = !report.checkout.initial || !report.checkout.final
      || report.checkout.initial.fingerprint !== report.checkout.final.fingerprint;
    if (!report.checkout.final) report.error ??= 'Final git identity could not be captured';
    if (report.checkout.changed && !report.error) report.error = 'Checkout changed during verification; this report is not valid for the final checkout.';
    const invalidCheckout = report.checkout.changed;
    report.endedAt = new Date().toISOString();
    report.durationMs = Date.now() - startMs;
    report.result = invalidCheckout ? 'invalid' : interrupted ? 'interrupted' : report.error || report.steps.some(step => step.status === 'FAILED') ? 'failed' : dryRun ? 'planned' : 'passed';
    resultCode = report.result === 'passed' || report.result === 'planned' ? 0 : 1;
  } catch (error) {
    report.error = error.message;
    report.result = 'failed';
    report.endedAt = new Date().toISOString();
    report.durationMs = Date.now() - startMs;
    resultCode = 1;
  } finally {
    try { await persistReport(); } catch (error) {
      report.error = [report.error, `Could not write report: ${error.message}`].filter(Boolean).join('; ');
      resultCode = 1;
    }
    for (const [signal, handler] of signalHandlers) signalSource.off(signal, handler);
  }
  if (interrupted && options.reraiseSignal !== false) process.kill(process.pid, interrupted);
  return resultCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runVerification(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
