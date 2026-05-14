import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const port = 37100 + Math.floor(Math.random() * 400);
const baseUrl = `http://127.0.0.1:${port}`;

let apiProcess: ChildProcessWithoutNullStreams | null = null;
let storeDir = '';

const waitForServer = async () => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // not ready yet
    }
    await delay(200);
  }
  throw new Error('API server did not start in time');
};

test.before(async () => {
  storeDir = await mkdtemp(join(tmpdir(), 'radioatlas-catalog-deleted-'));
  apiProcess = spawn(process.execPath, ['--import', 'tsx/esm', './src/index.ts'], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(port),
      ENABLE_TEST_AUTH_FIXTURES: '1',
      EXTRACTOR_URL: '',
      TELEGRAM_BOT_TOKEN: '',
      BOT_TOKEN: '',
      GOOGLE_CLIENT_ID: '',
      VK_CLIENT_ID: '',
      VK_CLIENT_SECRET: '',
      VK_REDIRECT_URI: '',
      WEBAPP_URL: 'https://radioatlas.test',
      ACCOUNT_STORE_PATH: join(storeDir, 'account-store.sqlite'),
      ALLOWED_ORIGINS: 'http://127.0.0.1,http://localhost'
    }
  });

  let stderr = '';
  apiProcess.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  apiProcess.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(stderr);
    }
  });

  await waitForServer();
});

test.after(async () => {
  if (!apiProcess || apiProcess.killed) return;
  apiProcess.kill('SIGTERM');
  await delay(300);
  if (!apiProcess.killed) {
    apiProcess.kill('SIGKILL');
  }
});

test('GET /catalog is removed and responds 404', async () => {
  const response = await fetch(`${baseUrl}/catalog`);
  assert.equal(response.status, 404, 'bare /catalog must 404 after T0.6');
  const fastModeAttempt = await fetch(`${baseUrl}/catalog?mode=fast`);
  assert.equal(
    fastModeAttempt.status,
    404,
    '?mode=fast must not unlock a back-door to the deleted handler'
  );
});

test('/catalog removal does not stall the event loop for /health', async () => {
  // Fire ten concurrent requests at the gone route. Each should bounce
  // off Express's default 404 path in microseconds; if anything in the
  // old handler chain (catalog parse, JSON.stringify of ~32 MB) had
  // been left wired by mistake, /health latency would balloon after.
  const fanout = await Promise.all(
    Array.from({ length: 10 }, () => fetch(`${baseUrl}/catalog`))
  );
  for (const response of fanout) {
    assert.equal(response.status, 404);
  }

  const samples: number[] = [];
  for (let index = 0; index < 20; index += 1) {
    const start = performance.now();
    const response = await fetch(`${baseUrl}/health`);
    samples.push(performance.now() - start);
    assert.equal(response.status, 200);
  }
  samples.sort((a, b) => a - b);
  const p95Index = Math.max(0, Math.ceil(samples.length * 0.95) - 1);
  const p95 = samples[p95Index] ?? samples[samples.length - 1] ?? 0;
  assert.ok(
    p95 < 100,
    `/health p95 after 10 concurrent /catalog 404s should be <100ms, got ${p95.toFixed(2)}ms`
  );
});
