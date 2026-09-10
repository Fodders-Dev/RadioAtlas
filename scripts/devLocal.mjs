import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function createDevConfig(root, env = process.env) {
  const port = (value, fallback) => {
    const result = Number(value || fallback);
    if (!Number.isInteger(result) || result < 1024 || result > 65535) {
      throw new Error('Development ports must be integers between 1024 and 65535.');
    }
    return result;
  };
  const webPort = port(env.RADIO_DEV_WEB_PORT, 5184);
  const apiPort = port(env.RADIO_DEV_API_PORT, 4341);
  if (webPort === apiPort) throw new Error('Web and API need different ports.');
  const dataDir = join(resolve(root), '.tmp', 'dev-local');
  return {
    webPort, apiPort, dataDir,
    apiEnv: {
      ...env, NODE_ENV: 'development', PORT: String(apiPort), API_BIND_HOST: '127.0.0.1',
      ACCOUNT_STORE_PATH: join(dataDir, 'accounts.sqlite'),
      OBSERVABILITY_STORE_PATH: join(dataDir, 'observability.json'),
      STATION_INTEL_DB_PATH: join(dataDir, 'station-intel.sqlite'),
      SCENE_ARTWORK_DIR: join(dataDir, 'artwork'), SCENE_ARTWORK_ENABLED: '0',
      CATALOG_DATA_DIR: join(dataDir, 'catalog'), CATALOG_ARTIFACT_ONLY: '1',
      AI_ENABLED: '0', BILLING_RECONCILE_ENABLED: '0', ENABLE_TEST_AUTH_FIXTURES: '0'
    },
    webEnv: { ...env, NODE_ENV: 'development', VITE_API_PROXY_PORT: String(apiPort) }
  };
}

async function checkPort(port) {
  await new Promise((yes, no) => {
    const server = createServer();
    server.once('error', () => no(new Error(`127.0.0.1:${port} is busy. Stop your own dev session or set RADIO_DEV_WEB_PORT / RADIO_DEV_API_PORT.`)));
    server.listen(port, '127.0.0.1', () => server.close(yes));
  });
}

async function main() {
  const config = createDevConfig(repoRoot);
  const requireAPI = createRequire(join(repoRoot, 'apps/api/package.json'));
  const requireWeb = createRequire(join(repoRoot, 'apps/webapp/package.json'));
  requireAPI.resolve('tsx');
  const vite = join(dirname(requireWeb.resolve('vite/package.json')), 'bin/vite.js');
  await checkPort(config.apiPort);
  await checkPort(config.webPort);
  console.log(`App: http://127.0.0.1:${config.webPort}`);
  console.log(`Existing AirBlock experiment: http://127.0.0.1:${config.webPort}/?air2=1`);
  console.log(`Local data: ${config.dataDir}`);
  console.log('Local catalog snapshot; AI and billing disabled. No production credentials required.');
  if (process.argv.includes('--check')) return;
  await mkdir(join(config.dataDir, 'catalog'), { recursive: true });

  const children = [];
  let stopping = false;
  const stop = async (code) => {
    if (stopping) return;
    stopping = true;
    await Promise.all(children.filter(child => child.exitCode === null && child.pid).map(child => new Promise(done => {
      if (process.platform === 'win32') {
        // Only this launcher's child trees. Never kill unrelated Node processes.
        const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
        killer.once('exit', done);
        killer.once('error', () => { child.kill(); done(); });
      } else {
        child.once('exit', done);
        child.kill('SIGTERM');
        setTimeout(() => { child.kill('SIGKILL'); done(); }, 3000).unref();
      }
    })));
    process.exit(code);
  };
  const start = (args, cwd, env) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit', windowsHide: true });
    children.push(child);
    child.once('error', error => { console.error(error.message); void stop(1); });
    child.once('exit', code => { if (!stopping) void stop(code || 1); });
  };
  process.once('SIGINT', () => void stop(0));
  process.once('SIGTERM', () => void stop(0));
  // API intentionally has no watcher: frontend edits cannot restart the shared stream.
  start(['--import', 'tsx', 'src/index.ts'], join(repoRoot, 'apps/api'), config.apiEnv);
  start([vite, '--host', '127.0.0.1', '--port', String(config.webPort), '--strictPort'], join(repoRoot, 'apps/webapp'), config.webEnv);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
