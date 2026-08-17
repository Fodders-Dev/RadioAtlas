import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// GET /auth/telegram/callback — the data-auth-url redirect flow that replaces
// the third-party-cookie-dependent data-onauth widget mode (broken on every
// iOS browser + Huawei). The payload uses the Login Widget hash scheme:
// secret = sha256(botToken), signature = hmac-sha256(dataCheckString).

const apiRoot = fileURLToPath(new URL('../', import.meta.url));
// 38500+, not 37200+: 37200-37599 overlapped catalog.deleted (37100-37499) and
// the first fixtures.production-guard block (37500-37699). Same `test:api` run,
// so the collision is a flake that reproduces once in a few hundred runs and
// never when you look for it.
const port = 38500 + Math.floor(Math.random() * 200);
const baseUrl = `http://127.0.0.1:${port}`;
const BOT_TOKEN = 'callback-test-bot-token';
const WEBAPP_URL = 'https://radioatlas.test';

let apiProcess: ChildProcessWithoutNullStreams | null = null;
let storeDir = '';

const signWidgetPayload = (fields: Record<string, string>) => {
  const dataCheckString = Object.entries(fields)
    .filter(([key, value]) => key !== 'hash' && String(value).trim())
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHash('sha256').update(BOT_TOKEN).digest();
  return createHmac('sha256', secret).update(dataCheckString).digest('hex');
};

const callbackUrl = (fields: Record<string, string>) => {
  const url = new URL(`${baseUrl}/auth/telegram/callback`);
  Object.entries(fields).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
};

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
  storeDir = await mkdtemp(join(tmpdir(), 'radioatlas-tg-callback-test-'));
  apiProcess = spawn(process.execPath, ['--import', 'tsx/esm', './src/index.ts'], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(port),
      EXTRACTOR_URL: '',
      TELEGRAM_BOT_TOKEN: BOT_TOKEN,
      BOT_TOKEN: '',
      GOOGLE_CLIENT_ID: '',
      VK_CLIENT_ID: '',
      VK_CLIENT_SECRET: '',
      VK_REDIRECT_URI: '',
      WEBAPP_URL,
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

test('valid signed payload redirects to the webapp with a session token', async () => {
  const fields: Record<string, string> = {
    id: '7700001',
    first_name: 'Callback',
    username: 'callback_user',
    auth_date: String(Math.floor(Date.now() / 1000))
  };
  fields.hash = signWidgetPayload(fields);

  const response = await fetch(callbackUrl(fields), { redirect: 'manual' });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location') || '');
  assert.equal(location.origin, WEBAPP_URL);
  assert.equal(location.searchParams.get('auth_provider'), 'telegram');
  assert.equal(location.searchParams.get('auth_result'), 'success');
  const token = location.searchParams.get('token') || '';
  assert.ok(token.length > 0, 'redirect carries a session token');

  // The token is a real bearer session.
  const me = await fetch(`${baseUrl}/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(me.status, 200);
  const payload = (await me.json()) as {
    profile: { providers: Array<{ kind: string; externalId: string }> };
  };
  assert.ok(
    payload.profile.providers.some(
      (provider) => provider.kind === 'telegram' && provider.externalId === '7700001'
    ),
    'session belongs to the telegram identity'
  );
});

test('tampered hash redirects with auth_result=error', async () => {
  const fields: Record<string, string> = {
    id: '7700002',
    first_name: 'Tampered',
    auth_date: String(Math.floor(Date.now() / 1000))
  };
  fields.hash = signWidgetPayload({ ...fields, first_name: 'Forged' });

  const response = await fetch(callbackUrl(fields), { redirect: 'manual' });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location') || '');
  assert.equal(location.searchParams.get('auth_provider'), 'telegram');
  assert.equal(location.searchParams.get('auth_result'), 'error');
  assert.equal(location.searchParams.get('token'), null);
  assert.match(location.searchParams.get('message') || '', /hash/i);
});

test('expired auth_date redirects with auth_result=error', async () => {
  const fields: Record<string, string> = {
    id: '7700003',
    first_name: 'Stale',
    // Two days old — past the 86400s default window.
    auth_date: String(Math.floor(Date.now() / 1000) - 2 * 86400)
  };
  fields.hash = signWidgetPayload(fields);

  const response = await fetch(callbackUrl(fields), { redirect: 'manual' });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location') || '');
  assert.equal(location.searchParams.get('auth_result'), 'error');
  assert.equal(location.searchParams.get('token'), null);
  assert.match(location.searchParams.get('message') || '', /expired/i);
});
