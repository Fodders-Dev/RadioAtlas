import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const port = 36600 + Math.floor(Math.random() * 400);
const baseUrl = `http://127.0.0.1:${port}`;

let apiProcess: ChildProcessWithoutNullStreams | null = null;
let storeDir = '';

type ProfilePayload = {
  id: string;
  linkedProviders: string[];
  providers: Array<{ kind: string; externalId: string }>;
};
type AuditEvent = {
  type: string;
  providerKind?: string | null;
  providerExternalId?: string | null;
};
type SessionEnvelope = {
  token: string;
  profile: ProfilePayload;
  auditTrail: AuditEvent[];
};
type ErrorPayload = { error: string };
type LinkRequestPayload = { code: string };
type MePayload = { profile: ProfilePayload; auditTrail: AuditEvent[] };

const encodeFixtureGoogleCredential = (identity: {
  sub: string;
  name?: string;
  email?: string;
}) => `fixture-google:${Buffer.from(JSON.stringify(identity), 'utf8').toString('base64url')}`;

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
  storeDir = await mkdtemp(join(tmpdir(), 'radioatlas-auth-link-test-'));
  apiProcess = spawn(process.execPath, ['--import', 'tsx/esm', './src/index.ts'], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(port),
      ENABLE_TEST_AUTH_FIXTURES: '1',
      EXTRACTOR_URL: '',
      TELEGRAM_BOT_TOKEN: '',
      BOT_TOKEN: '',
      GOOGLE_CLIENT_ID: 'auth-link-test-google-client',
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

const postJson = async <T,>(path: string, body: unknown, headers: Record<string, string> = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  const payload = (await response.json()) as T;
  return { response, body: payload };
};

const signInWithGoogle = async (
  credential: string,
  options: { token?: string; linkCode?: string } = {}
) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const body: Record<string, unknown> = { credential };
  if (options.linkCode) body.linkCode = options.linkCode;
  return postJson<SessionEnvelope | ErrorPayload>('/auth/google', body, headers);
};

const mintLinkCode = async (token: string) => {
  const { body } = await postJson<LinkRequestPayload>(
    '/me/link-request',
    { mergeStrategy: 'combine' },
    { Authorization: `Bearer ${token}` }
  );
  return body.code;
};

const getMe = async (token: string) => {
  const response = await fetch(`${baseUrl}/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return { response, body: (await response.json()) as MePayload };
};

const freshIdentity = (label: string) => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${label}`;
  return {
    sub: `fixture-sub-${stamp}`,
    name: `Fixture ${label}`,
    email: `${label}-${stamp}@example.test`
  };
};

const createAccountViaGoogle = async (label: string) => {
  const identity = freshIdentity(label);
  const credential = encodeFixtureGoogleCredential(identity);
  const { response, body } = await signInWithGoogle(credential);
  assert.equal(response.status, 200);
  assert.ok('token' in body, 'sign-in must return a session envelope');
  return { credential, identity, envelope: body };
};

test('(a) unauthenticated OAuth callback with an unknown identity creates a new account', async () => {
  const { envelope } = await createAccountViaGoogle('case-a');
  assert.ok(envelope.token);
  assert.ok(envelope.profile.id);
  assert.deepEqual(envelope.profile.linkedProviders, ['google']);
});

test('(b) authenticated caller + unknown identity + no linkCode -> brand-new account, A untouched', async () => {
  const accountA = await createAccountViaGoogle('case-b-A');
  const beforeMe = await getMe(accountA.envelope.token);
  assert.equal(beforeMe.body.profile.providers.length, 1);

  const otherIdentity = freshIdentity('case-b-other');
  const otherCredential = encodeFixtureGoogleCredential(otherIdentity);
  const { response, body } = await signInWithGoogle(otherCredential, {
    token: accountA.envelope.token
  });
  assert.equal(response.status, 200);
  assert.ok('profile' in body);
  // The brand-new account that the OAuth identity landed in is not A.
  assert.notEqual(body.profile.id, accountA.envelope.profile.id);

  // A is exactly as it was: still has one provider, that provider is A's
  // original google sub.
  const afterMe = await getMe(accountA.envelope.token);
  assert.equal(afterMe.body.profile.providers.length, 1);
  assert.equal(
    afterMe.body.profile.providers[0]?.externalId,
    accountA.identity.sub,
    'A must still own only its original google identity'
  );
});

test('(c) authenticated caller + known identity (account B) + no linkCode -> returns B session, A untouched', async () => {
  const accountA = await createAccountViaGoogle('case-c-A');
  const accountB = await createAccountViaGoogle('case-c-B');

  const { response, body } = await signInWithGoogle(accountB.credential, {
    token: accountA.envelope.token
  });
  assert.equal(response.status, 200);
  assert.ok('profile' in body);
  assert.equal(body.profile.id, accountB.envelope.profile.id, 'response is B login');
  assert.notEqual(body.token, accountA.envelope.token, 'fresh session, not A token');

  const afterAme = await getMe(accountA.envelope.token);
  assert.equal(afterAme.body.profile.id, accountA.envelope.profile.id);
  assert.equal(
    afterAme.body.profile.providers[0]?.externalId,
    accountA.identity.sub,
    'A must still own only its original google identity'
  );
});

test('(d) authenticated caller + unknown identity + valid linkCode -> identity attaches to A, code is gone', async () => {
  const accountA = await createAccountViaGoogle('case-d-A');
  const linkCode = await mintLinkCode(accountA.envelope.token);
  assert.ok(linkCode, 'mint produced a code');

  const otherIdentity = freshIdentity('case-d-other');
  const otherCredential = encodeFixtureGoogleCredential(otherIdentity);
  const { response, body } = await signInWithGoogle(otherCredential, {
    token: accountA.envelope.token,
    linkCode
  });
  assert.equal(response.status, 200);
  assert.ok('profile' in body);
  assert.equal(body.profile.id, accountA.envelope.profile.id, 'response is still A');

  const afterMe = await getMe(accountA.envelope.token);
  const externalIds = afterMe.body.profile.providers.map((provider) => provider.externalId).sort();
  assert.deepEqual(
    externalIds,
    [accountA.identity.sub, otherIdentity.sub].sort(),
    'both google identities are now linked to A'
  );

  // linkCode burnt on first use.
  const replay = await signInWithGoogle(otherCredential, {
    token: accountA.envelope.token,
    linkCode
  });
  assert.equal(replay.response.status, 409, 'spent linkCode replay returns 409');
});

test('(e) authenticated caller + wrong / expired linkCode -> 409, A untouched', async () => {
  const accountA = await createAccountViaGoogle('case-e-A');

  const otherIdentity = freshIdentity('case-e-other');
  const otherCredential = encodeFixtureGoogleCredential(otherIdentity);
  const { response, body } = await signInWithGoogle(otherCredential, {
    token: accountA.envelope.token,
    linkCode: 'definitely-not-a-real-linkcode'
  });
  assert.equal(response.status, 409);
  assert.equal((body as ErrorPayload).error, 'link request expired or unknown');

  const afterMe = await getMe(accountA.envelope.token);
  assert.equal(afterMe.body.profile.providers.length, 1, 'A still has just one identity');
  assert.equal(
    afterMe.body.profile.providers[0]?.externalId,
    accountA.identity.sub,
    'A still owns only its own identity'
  );
});

test('(f) two concurrent callbacks with the same linkCode -> one wins, one 409', async () => {
  const accountA = await createAccountViaGoogle('case-f-A');
  const linkCode = await mintLinkCode(accountA.envelope.token);

  const winnerIdentity = freshIdentity('case-f-winner');
  const loserIdentity = freshIdentity('case-f-loser');
  const winnerCredential = encodeFixtureGoogleCredential(winnerIdentity);
  const loserCredential = encodeFixtureGoogleCredential(loserIdentity);

  const [first, second] = await Promise.all([
    signInWithGoogle(winnerCredential, { token: accountA.envelope.token, linkCode }),
    signInWithGoogle(loserCredential, { token: accountA.envelope.token, linkCode })
  ]);

  const statuses = [first.response.status, second.response.status].sort();
  assert.deepEqual(statuses, [200, 409], 'exactly one race winner, one race loser');

  const afterMe = await getMe(accountA.envelope.token);
  const linkedSubs = afterMe.body.profile.providers.map((provider) => provider.externalId);
  const attachedExtraSubs = linkedSubs.filter(
    (sub) => sub === winnerIdentity.sub || sub === loserIdentity.sub
  );
  assert.equal(
    attachedExtraSubs.length,
    1,
    'only the race-winner identity is linked to A; the loser identity is in its own brand-new account'
  );

  const providerLinkedAttachments = afterMe.body.auditTrail.filter(
    (event) =>
      event.type === 'provider_linked' &&
      (event.providerExternalId === winnerIdentity.sub ||
        event.providerExternalId === loserIdentity.sub)
  );
  assert.equal(
    providerLinkedAttachments.length,
    1,
    'audit trail records exactly one provider_linked event for the race'
  );
});
