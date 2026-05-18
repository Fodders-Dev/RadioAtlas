import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const port = 36100 + Math.floor(Math.random() * 400);
const baseUrl = `http://127.0.0.1:${port}`;
const allowedOrigin = 'https://radioatlas.duckdns.org';
const otherAllowedOrigin = 'https://web.telegram.org';

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
  storeDir = await mkdtemp(join(tmpdir(), 'radioatlas-cors-test-'));
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
      ALLOWED_ORIGINS: `${allowedOrigin},${otherAllowedOrigin}`
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

test('GET with no Origin header returns 200 without ACAO', async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('access-control-allow-origin'),
    null,
    'no Origin -> no ACAO'
  );
});

test('GET with an allow-listed Origin returns ACAO + ACAC + Vary: Origin', async () => {
  const response = await fetch(`${baseUrl}/health`, {
    headers: { Origin: allowedOrigin }
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), allowedOrigin);
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  const vary = response.headers.get('vary') || '';
  assert.ok(/(^|,\s*)Origin(\s*,|$)/i.test(vary), `Vary header should include Origin (got ${vary})`);
});

test('Origin match is case-insensitive on scheme+host', async () => {
  const response = await fetch(`${baseUrl}/health`, {
    headers: { Origin: allowedOrigin.toUpperCase() }
  });
  assert.equal(response.status, 200);
  // Reflect the exact origin string the client sent.
  assert.equal(
    response.headers.get('access-control-allow-origin'),
    allowedOrigin.toUpperCase()
  );
});

test('GET with a non-allow-listed Origin returns 200 but no ACAO', async () => {
  const response = await fetch(`${baseUrl}/health`, {
    headers: { Origin: 'https://evil.example.com' }
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  // Still emit Vary so caches do not serve this no-ACAO response back to a
  // request from an allow-listed origin.
  const vary = response.headers.get('vary') || '';
  assert.ok(
    /(^|,\s*)Origin(\s*,|$)/i.test(vary),
    `Vary should still include Origin even when the origin is rejected (got ${vary})`
  );
});

test('Origin: null (sandboxed iframe / file://) is treated as not allow-listed', async () => {
  const response = await fetch(`${baseUrl}/health`, {
    headers: { Origin: 'null' }
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('OPTIONS preflight from an allow-listed Origin returns 204 with full CORS headers', async () => {
  const response = await fetch(`${baseUrl}/me`, {
    method: 'OPTIONS',
    headers: {
      Origin: allowedOrigin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Authorization'
    }
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), allowedOrigin);
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  const allowHeaders = response.headers.get('access-control-allow-headers') || '';
  assert.match(allowHeaders, /Authorization/i);
  const allowMethods = response.headers.get('access-control-allow-methods') || '';
  assert.match(allowMethods, /GET/);
  assert.match(allowMethods, /DELETE/);
});

test('OPTIONS preflight from a non-allow-listed Origin returns 204 with no CORS headers', async () => {
  const response = await fetch(`${baseUrl}/me`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://attacker.example.com',
      'Access-Control-Request-Method': 'POST'
    }
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('NODE_ENV=production with an empty ALLOWED_ORIGINS exits non-zero on boot', async () => {
  const productionStoreDir = await mkdtemp(join(tmpdir(), 'radioatlas-cors-prod-'));
  const proc = spawn(process.execPath, ['--import', 'tsx/esm', './src/index.ts'], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(port + 1),
      NODE_ENV: 'production',
      ALLOWED_ORIGINS: '',
      ENABLE_TEST_AUTH_FIXTURES: '0',
      EXTRACTOR_URL: '',
      TELEGRAM_BOT_TOKEN: '',
      BOT_TOKEN: '',
      GOOGLE_CLIENT_ID: '',
      VK_CLIENT_ID: '',
      VK_CLIENT_SECRET: '',
      VK_REDIRECT_URI: '',
      WEBAPP_URL: 'https://radioatlas.test',
      ACCOUNT_STORE_PATH: join(productionStoreDir, 'account-store.sqlite'),
      INTERNAL_WEBHOOK_TOKEN: 'unused-in-this-test'
    }
  });
  let stderr = '';
  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const exitCode = await new Promise<number | null>((resolve) => {
    proc.on('exit', (code) => resolve(code));
  });
  assert.notEqual(exitCode, 0, 'production boot must exit non-zero when ALLOWED_ORIGINS is empty');
  assert.match(stderr, /ALLOWED_ORIGINS is required in production/);
});
