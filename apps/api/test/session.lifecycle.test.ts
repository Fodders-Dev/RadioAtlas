import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const port = 35600 + Math.floor(Math.random() * 400);
const baseUrl = `http://127.0.0.1:${port}`;

let apiProcess: ChildProcessWithoutNullStreams | null = null;
let storeDir = '';

type SeedConflictPayload = {
  token: string;
  currentAccountId: string;
};

type MePayload = { profile: { id: string }; auditTrail: Array<{ type: string }> };
type SessionInspectPayload = { exists: boolean; expiresAt: number | null; accountId: string | null };
type IssueSessionPayload = { token: string };
type ExpireSessionPayload = { expired: boolean };
type RevokeSelfPayload = { ok: boolean; revoked: boolean };
type RevokeOthersPayload = { ok: boolean; revokedCount: number };

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
  storeDir = await mkdtemp(join(tmpdir(), 'radioatlas-session-test-'));
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
      ACCOUNT_STORE_PATH: join(storeDir, 'account-store.sqlite')
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

const inspectSession = async (token: string) => {
  const { body } = await postJson<SessionInspectPayload>('/test/auth/inspect-session', { token });
  return body;
};

const expireSession = async (token: string) => {
  const { body } = await postJson<ExpireSessionPayload>('/test/auth/expire-session', { token });
  return body.expired;
};

const issueSession = async (accountId: string) => {
  const { body } = await postJson<IssueSessionPayload>('/test/auth/issue-session', { accountId });
  return body.token;
};

const getMe = async (token: string) => {
  return fetch(`${baseUrl}/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
};

const revokeMine = async (token: string) => {
  const response = await fetch(`${baseUrl}/me/session`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  return { response, body: (await response.json()) as RevokeSelfPayload };
};

const revokeOthers = async (token: string) => {
  const response = await fetch(`${baseUrl}/me/sessions`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  return { response, body: (await response.json()) as RevokeOthersPayload };
};

test('seeded session gets a fresh expires_at roughly 30 days from now', async () => {
  const seed = await seedAccount();
  const info = await inspectSession(seed.token);
  assert.equal(info.exists, true);
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  assert.ok(info.expiresAt !== null);
  const drift = Math.abs((info.expiresAt ?? 0) - (Date.now() + thirtyDaysMs));
  assert.ok(drift < 10 * 60 * 1000, `expiresAt should be ~now+30d, drift ${drift}ms`);
});

test('GET /me with an expired token returns 401 and deletes the session row', async () => {
  const seed = await seedAccount();
  assert.ok(await expireSession(seed.token));

  const response = await getMe(seed.token);
  assert.equal(response.status, 401);

  const after = await inspectSession(seed.token);
  assert.equal(after.exists, false, 'expired session row should be gone after the 401');
});

test('a valid GET /me slides expires_at forward on each successful hit', async () => {
  const seed = await seedAccount();
  const before = await inspectSession(seed.token);
  assert.ok(before.expiresAt !== null);

  await delay(60);

  const meResponse = await getMe(seed.token);
  assert.equal(meResponse.status, 200);

  const after = await inspectSession(seed.token);
  assert.ok(after.expiresAt !== null);
  assert.ok(
    (after.expiresAt ?? 0) > (before.expiresAt ?? 0),
    'expiresAt should slide forward after a successful /me hit'
  );
});

test('DELETE /me/session revokes the current token immediately', async () => {
  const seed = await seedAccount();

  const { response: revoke, body: revokeBody } = await revokeMine(seed.token);
  assert.equal(revoke.status, 200);
  assert.equal(revokeBody.ok, true);
  assert.equal(revokeBody.revoked, true);

  const me = await getMe(seed.token);
  assert.equal(me.status, 401);

  const inspected = await inspectSession(seed.token);
  assert.equal(inspected.exists, false);
});

test('DELETE /me/sessions revokes all OTHER sessions but keeps the current one', async () => {
  const seed = await seedAccount();
  const secondToken = await issueSession(seed.currentAccountId);
  const thirdToken = await issueSession(seed.currentAccountId);
  assert.notEqual(secondToken, seed.token);
  assert.notEqual(thirdToken, seed.token);

  // sanity: every token works to start with
  const initial = await Promise.all([
    getMe(seed.token),
    getMe(secondToken),
    getMe(thirdToken)
  ]);
  for (const response of initial) {
    assert.equal(response.status, 200);
  }

  const { response: revokeResponse, body: revokeBody } = await revokeOthers(seed.token);
  assert.equal(revokeResponse.status, 200);
  assert.equal(revokeBody.ok, true);
  assert.equal(revokeBody.revokedCount, 2, 'should drop both extra sessions');

  const after = await Promise.all([
    getMe(seed.token),
    getMe(secondToken),
    getMe(thirdToken)
  ]);
  assert.equal(after[0].status, 200, 'current session survives');
  assert.equal(after[1].status, 401, 'other session is now invalid');
  assert.equal(after[2].status, 401, 'other session is now invalid');

  const auditBody = (await after[0].json()) as MePayload;
  const revokedOthersEvents = auditBody.auditTrail.filter(
    (event) => event.type === 'sessions_revoked_other'
  );
  assert.equal(
    revokedOthersEvents.length,
    1,
    'one audit event should record the bulk revocation'
  );
});
