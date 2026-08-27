import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * `DELETE /me`. The privacy policy promises a person can have their data
 * removed, and Google Play requires an in-app path to it for any app with
 * accounts. Before this, the only things on offer were unlinking a provider and
 * logging out — neither of which deletes anything.
 *
 * The assertion that actually matters is the last one: signing back in with the
 * SAME provider identity must hand back an empty account. Everything else could
 * pass while the library quietly survived on the server, and "deleted" would be
 * a lie told by a 200.
 */

const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const port = 37200 + Math.floor(Math.random() * 300);
const baseUrl = `http://127.0.0.1:${port}`;

let apiProcess: ChildProcessWithoutNullStreams | null = null;
let storeDir = '';

type ProfilePayload = {
  id: string;
  linkedProviders: string[];
  library?: { favorites?: unknown[] };
};
type SessionEnvelope = { token: string; profile: ProfilePayload };
type DeletionPayload = {
  ok?: boolean;
  error?: string;
  removed?: { providers: number; sessions: number; auditEvents: number; purchases: number };
};

const encodeFixtureGoogleCredential = (identity: { sub: string; name?: string; email?: string }) =>
  `fixture-google:${Buffer.from(JSON.stringify(identity), 'utf8').toString('base64url')}`;

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
  storeDir = await mkdtemp(join(tmpdir(), 'radioatlas-account-delete-test-'));
  apiProcess = spawn(process.execPath, ['--import', 'tsx/esm', './src/index.ts'], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(port),
      ENABLE_TEST_AUTH_FIXTURES: '1',
      EXTRACTOR_URL: '',
      TELEGRAM_BOT_TOKEN: '',
      BOT_TOKEN: '',
      GOOGLE_CLIENT_ID: 'account-delete-test-google-client',
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
    if (code && code !== 0) console.error(stderr);
  });

  await waitForServer();
});

test.after(async () => {
  if (!apiProcess || apiProcess.killed) return;
  apiProcess.kill('SIGTERM');
  await delay(300);
  if (!apiProcess.killed) apiProcess.kill('SIGKILL');
});

const signIn = async (sub: string) => {
  const response = await fetch(`${baseUrl}/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      credential: encodeFixtureGoogleCredential({ sub, name: 'Delete Me', email: `${sub}@test.dev` })
    })
  });
  assert.equal(response.status, 200, 'sign-in should succeed');
  return (await response.json()) as SessionEnvelope;
};

const deleteMe = async (token: string | null, confirm: boolean) => {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}/me${confirm ? '?confirm=delete' : ''}`, {
    method: 'DELETE',
    headers
  });
  return { response, body: (await response.json()) as DeletionPayload };
};

const saveLibrary = async (token: string, favorites: unknown[]) => {
  const response = await fetch(`${baseUrl}/me/library`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ library: { favorites, collections: [], recent: [] } })
  });
  return response.status;
};

test('refuses to delete without a session', async () => {
  const { response } = await deleteMe(null, true);
  assert.equal(response.status, 401);
});

test('refuses to delete without the explicit confirmation', async () => {
  const session = await signIn('delete-needs-confirm');
  const { response, body } = await deleteMe(session.token, false);
  assert.equal(response.status, 400, 'an unconfirmed delete must not go through');
  assert.equal(body.error, 'confirmation required');

  // And the account is untouched — the guard must refuse, not half-delete.
  const me = await fetch(`${baseUrl}/me`, {
    headers: { Authorization: `Bearer ${session.token}` }
  });
  assert.equal(me.status, 200, 'the account should still be there after a refused delete');
});

test('deletes the account and reports what it removed', async () => {
  const session = await signIn('delete-reports-counts');
  const { response, body } = await deleteMe(session.token, true);

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  // Counted before the delete, so these describe what actually went.
  assert.ok(body.removed, 'the response should say what was removed');
  assert.equal(body.removed.providers, 1, 'the google provider should be counted');
  assert.ok(body.removed.sessions >= 1, 'at least the current session should be counted');
});

test('invalidates the session the delete was made with', async () => {
  const session = await signIn('delete-kills-session');
  await deleteMe(session.token, true);

  const me = await fetch(`${baseUrl}/me`, {
    headers: { Authorization: `Bearer ${session.token}` }
  });
  assert.equal(me.status, 401, 'the token of a deleted account must stop working');
});

test('the library is really gone: signing back in gives a NEW empty account', async () => {
  const sub = 'delete-erases-library';
  const first = await signIn(sub);
  assert.equal(await saveLibrary(first.token, [{ stationuuid: 'abc', name: 'Kept Station' }]), 200);

  const { response } = await deleteMe(first.token, true);
  assert.equal(response.status, 200);

  // Same provider identity, fresh sign-in. If anything survived on the server
  // this is where it would come back — and a 200 on the delete would have been
  // a lie.
  const second = await signIn(sub);
  assert.notEqual(second.profile.id, first.profile.id, 'a new account id should be issued');

  const me = await fetch(`${baseUrl}/me`, {
    headers: { Authorization: `Bearer ${second.token}` }
  });
  assert.equal(me.status, 200);
  const payload = (await me.json()) as { profile: ProfilePayload };
  assert.equal(
    payload.profile.library?.favorites?.length ?? 0,
    0,
    'the deleted library must not come back with the same provider'
  );
});
