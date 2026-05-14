import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const apiRoot = fileURLToPath(new URL('../', import.meta.url));

type SpawnResult = {
  exitCode: number | null;
  stderr: string;
  stdout: string;
};

const spawnApiProcess = async (
  port: number,
  envOverrides: Record<string, string>,
  storeDir: string
): Promise<SpawnResult> => {
  return new Promise<SpawnResult>((resolve) => {
    const child: ChildProcessWithoutNullStreams = spawn(
      process.execPath,
      ['--import', 'tsx/esm', './src/index.ts'],
      {
        cwd: apiRoot,
        env: {
          ...process.env,
          PORT: String(port),
          EXTRACTOR_URL: '',
          TELEGRAM_BOT_TOKEN: '',
          BOT_TOKEN: '',
          GOOGLE_CLIENT_ID: '',
          VK_CLIENT_ID: '',
          VK_CLIENT_SECRET: '',
          VK_REDIRECT_URI: '',
          WEBAPP_URL: 'https://radioatlas.test',
          ACCOUNT_STORE_PATH: join(storeDir, 'account-store.sqlite'),
          INTERNAL_WEBHOOK_TOKEN: 'production-guard-test-token',
          ...envOverrides
        }
      }
    );
    let stderr = '';
    let stdout = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.on('exit', (code) => {
      resolve({ exitCode: code, stderr, stdout });
    });
  });
};

const waitForHealth = async (port: number) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return true;
    } catch {
      // not ready yet
    }
    await delay(150);
  }
  return false;
};

test('NODE_ENV=production + ENABLE_TEST_AUTH_FIXTURES=1 exits non-zero on boot', async () => {
  const storeDir = await mkdtemp(join(tmpdir(), 'radioatlas-fixture-guard-'));
  const port = 37500 + Math.floor(Math.random() * 200);
  const result = await spawnApiProcess(
    port,
    {
      NODE_ENV: 'production',
      ENABLE_TEST_AUTH_FIXTURES: '1',
      // Pre-satisfy the T0.4 ALLOWED_ORIGINS production check so we are
      // *certain* the boot exits because of T0.7, not the earlier guard.
      ALLOWED_ORIGINS: 'https://radioatlas.duckdns.org'
    },
    storeDir
  );
  assert.notEqual(
    result.exitCode,
    0,
    'production boot with ENABLE_TEST_AUTH_FIXTURES=1 must exit non-zero'
  );
  assert.match(
    result.stderr,
    /ENABLE_TEST_AUTH_FIXTURES must not be set in production/,
    'fatal stderr message must call out the misconfiguration'
  );
});

test('NODE_ENV=production with fixtures disabled boots normally', async () => {
  const storeDir = await mkdtemp(join(tmpdir(), 'radioatlas-fixture-guard-ok-'));
  const port = 37700 + Math.floor(Math.random() * 200);
  let child: ChildProcessWithoutNullStreams | null = null;
  let stderr = '';
  try {
    child = spawn(process.execPath, ['--import', 'tsx/esm', './src/index.ts'], {
      cwd: apiRoot,
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'production',
        ENABLE_TEST_AUTH_FIXTURES: '0',
        ALLOWED_ORIGINS: 'https://radioatlas.duckdns.org',
        EXTRACTOR_URL: '',
        TELEGRAM_BOT_TOKEN: '',
        BOT_TOKEN: '',
        GOOGLE_CLIENT_ID: '',
        VK_CLIENT_ID: '',
        VK_CLIENT_SECRET: '',
        VK_REDIRECT_URI: '',
        WEBAPP_URL: 'https://radioatlas.test',
        ACCOUNT_STORE_PATH: join(storeDir, 'account-store.sqlite'),
        INTERNAL_WEBHOOK_TOKEN: 'production-guard-test-token'
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    const healthy = await waitForHealth(port);
    assert.ok(
      healthy,
      `production boot without ENABLE_TEST_AUTH_FIXTURES should reach /health (stderr: ${stderr.slice(0, 400)})`
    );
  } finally {
    if (child && !child.killed) {
      child.kill('SIGTERM');
      await delay(300);
      if (!child.killed) child.kill('SIGKILL');
    }
  }
});
