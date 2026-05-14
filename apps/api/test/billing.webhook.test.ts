import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const port = 35100 + Math.floor(Math.random() * 500);
const baseUrl = `http://127.0.0.1:${port}`;
const internalToken = 'billing-webhook-test-token';

let apiProcess: ChildProcessWithoutNullStreams | null = null;
let storeDir = '';

type SeedConflictPayload = {
  token: string;
  currentAccountId: string;
};

type AuditEvent = { id: string; type: string; payload?: { purchaseId?: string } };
type MePayload = {
  profile: { id: string; isPremium: boolean; entitlements: string[]; premiumStatus: string };
  auditTrail: AuditEvent[];
};

type SeedPurchasePayload = { purchaseId: string };
type WebhookSuccessPayload = MePayload;
type WebhookErrorPayload = { error: string };

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
  storeDir = await mkdtemp(join(tmpdir(), 'radioatlas-billing-test-'));
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
      INTERNAL_WEBHOOK_TOKEN: internalToken,
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

const postJson = async <T,>(path: string, body: unknown, headers: Record<string, string> = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  const payload = (await response.json()) as T;
  return { response, body: payload };
};

const seedAccount = async () => {
  const { body } = await postJson<SeedConflictPayload>('/test/auth/seed-conflict', {
    mergeStrategy: 'combine'
  });
  return body;
};

const seedPurchase = async (accountId: string, productId = 'premium-month') => {
  const { body } = await postJson<SeedPurchasePayload>('/test/billing/seed-purchase', {
    accountId,
    productId
  });
  return body.purchaseId;
};

const fetchMe = async (token: string) => {
  const response = await fetch(`${baseUrl}/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return (await response.json()) as MePayload;
};

test('webhook rejects 401 when X-Internal-Token header is missing', async () => {
  const { response, body } = await postJson<WebhookErrorPayload>(
    '/billing/telegram/webhook',
    { purchaseId: 'doesnt-matter' }
  );
  assert.equal(response.status, 401);
  assert.equal(body.error, 'unauthorized webhook');
});

test('webhook rejects 401 when X-Internal-Token header is wrong', async () => {
  const { response, body } = await postJson<WebhookErrorPayload>(
    '/billing/telegram/webhook',
    { purchaseId: 'doesnt-matter' },
    { 'X-Internal-Token': 'definitely-not-the-shared-secret' }
  );
  assert.equal(response.status, 401);
  assert.equal(body.error, 'unauthorized webhook');
});

test('webhook returns 404 for an unknown purchaseId with the correct header', async () => {
  const { response, body } = await postJson<WebhookErrorPayload>(
    '/billing/telegram/webhook',
    { purchaseId: 'no-such-purchase-id' },
    { 'X-Internal-Token': internalToken }
  );
  assert.equal(response.status, 404);
  assert.equal(body.error, 'purchase not found');
});

test('webhook flips a pending purchase to paid and grants entitlements once', async () => {
  const seed = await seedAccount();
  const purchaseId = await seedPurchase(seed.currentAccountId, 'premium-month');

  const before = await fetchMe(seed.token);
  assert.notEqual(
    before.profile.premiumStatus,
    'premium',
    'baseline supporter (is_premium=true on the Telegram identity) is not yet promoted to premium'
  );

  const { response: firstResponse, body: first } = await postJson<WebhookSuccessPayload>(
    '/billing/telegram/webhook',
    { purchaseId, telegramChargeId: 'first-charge' },
    { 'X-Internal-Token': internalToken }
  );
  assert.equal(firstResponse.status, 200);
  assert.equal(first.profile.premiumStatus, 'premium');

  const confirmedFirst = first.auditTrail.filter(
    (event) => event.type === 'billing_purchase_confirmed' && event.payload?.purchaseId === purchaseId
  );
  assert.equal(confirmedFirst.length, 1, 'first webhook lands exactly one audit event');

  const { response: secondResponse, body: second } = await postJson<WebhookSuccessPayload>(
    '/billing/telegram/webhook',
    { purchaseId, telegramChargeId: 'second-charge' },
    { 'X-Internal-Token': internalToken }
  );
  assert.equal(secondResponse.status, 200);
  assert.equal(second.profile.premiumStatus, 'premium');

  const confirmedAfterSecond = second.auditTrail.filter(
    (event) => event.type === 'billing_purchase_confirmed' && event.payload?.purchaseId === purchaseId
  );
  assert.equal(
    confirmedAfterSecond.length,
    1,
    'idempotent retry must NOT append a second confirmed audit event'
  );
  assert.deepEqual(
    second.profile.entitlements.slice().sort(),
    first.profile.entitlements.slice().sort(),
    'idempotent retry must not duplicate entitlements'
  );
});

test('two concurrent webhook calls land a single paid flip', async () => {
  const seed = await seedAccount();
  const purchaseId = await seedPurchase(seed.currentAccountId, 'premium-month');

  const [a, b] = await Promise.all([
    postJson<WebhookSuccessPayload | WebhookErrorPayload>(
      '/billing/telegram/webhook',
      { purchaseId, telegramChargeId: 'race-A' },
      { 'X-Internal-Token': internalToken }
    ),
    postJson<WebhookSuccessPayload | WebhookErrorPayload>(
      '/billing/telegram/webhook',
      { purchaseId, telegramChargeId: 'race-B' },
      { 'X-Internal-Token': internalToken }
    )
  ]);

  assert.equal(a.response.status, 200, 'race winner returns 200');
  assert.equal(b.response.status, 200, 'race loser returns 200 (idempotent)');

  const me = await fetchMe(seed.token);
  assert.equal(me.profile.premiumStatus, 'premium');
  const confirmedEvents = me.auditTrail.filter(
    (event) => event.type === 'billing_purchase_confirmed' && event.payload?.purchaseId === purchaseId
  );
  assert.equal(
    confirmedEvents.length,
    1,
    'concurrent webhook race must produce exactly one billing_purchase_confirmed event'
  );
});
