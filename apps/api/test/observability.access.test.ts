import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import test from 'node:test';
import express from 'express';

// The observability store hydrates from a repo-local metrics file by default,
// so on any machine where the dev API has run, this suite used to inherit real
// counters and fail the "only known names become counter keys" assertion. CI
// passed purely because its checkout has no such file. Point the store at a
// throwaway path BEFORE it is imported, so the assertions describe this test
// run and nothing else.
process.env.OBSERVABILITY_STORE_PATH =
  process.env.OBSERVABILITY_STORE_PATH ||
  join(tmpdir(), `radioatlas-observability-access-${process.pid}.json`);

const { installObservability } = await import('../src/observability.js');

/**
 * `GET https://radioatlas.ru/api/observability` answered 200 to anyone. Verified
 * against live production before this change: the payload carried
 * `persistence.storePath` = the absolute release path on the box, plus every
 * counter, gauge, latency bucket and request sample — and the `clientEvents`
 * ring, which forwards error detail straight from browsers.
 *
 * `POST /observability/client-event` was worse in kind: it built a counter key
 * from the caller-supplied `name`, and counters are the one structure the
 * age-based prune never touches, so an unauthenticated caller could mint
 * unlimited metric keys in a process whose memory ceiling has already been
 * raised once.
 */
const TOKEN = 'test-internal-token';

const withServer = async (
  run: (base: string) => Promise<void>,
  options: { internalToken?: string | null } = { internalToken: TOKEN }
) => {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  installObservability(app, options);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

test('the snapshot is not readable without the internal token', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/observability`);
    assert.equal(response.status, 404);
    const body = await response.text();
    assert.doesNotMatch(body, /storePath/, 'a refusal must not leak the payload');
  });
});

test('a spoofed loopback header does not grant access', async () => {
  // `trust proxy 1` makes req.ip follow X-Forwarded-For, so an IP allowlist
  // would have been bypassable with one header. The gate is the token only.
  await withServer(async (base) => {
    const spoofs: Record<string, string>[] = [
      { 'x-forwarded-for': '127.0.0.1' },
      { 'x-forwarded-for': '127.0.0.1, 10.0.0.1' },
      { 'x-forwarded-for': '::1' },
      { 'x-internal-token': 'wrong' },
      { 'x-internal-token': '' }
    ];
    for (const headers of spoofs) {
      const response = await fetch(`${base}/observability`, { headers });
      assert.equal(response.status, 404, `granted access for ${JSON.stringify(headers)}`);
    }
  });
});

test('the snapshot is readable with the internal token', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/observability`, {
      headers: { 'x-internal-token': TOKEN }
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as Record<string, unknown>;
    assert.ok('counters' in body && 'gauges' in body);
  });
});

test('the prometheus endpoint is gated too', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/observability/prometheus`)).status, 404);
    const allowed = await fetch(`${base}/observability/prometheus`, {
      headers: { 'x-internal-token': TOKEN }
    });
    assert.equal(allowed.status, 200);
  });
});

test('an unconfigured token locks the routes rather than opening them', async () => {
  // Fail closed: a deployment that forgets INTERNAL_WEBHOOK_TOKEN must not end
  // up publishing its telemetry again.
  for (const internalToken of [null, undefined, '', '   ']) {
    await withServer(async (base) => {
      assert.equal((await fetch(`${base}/observability`)).status, 404);
      const withHeader = await fetch(`${base}/observability`, {
        headers: { 'x-internal-token': '' }
      });
      assert.equal(withHeader.status, 404);
    }, { internalToken });
  }
});

test('client events accept the known names and refuse invented ones', async () => {
  await withServer(async (base) => {
    const post = (name: string) =>
      fetch(`${base}/observability/client-event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name })
      });

    for (const known of [
      'client_error',
      'deeplink_enter',
      'deeplink_error',
      'deeplink_play',
      'hls_error',
      'share_story'
    ]) {
      assert.equal((await post(known)).status, 200, `${known} must be accepted`);
    }

    // Surrounding whitespace is trimmed before the check, so a padded known name
    // is the SAME event, not a new key.
    assert.equal((await post('  client_error  ')).status, 200);

    for (const invented of ['whatever', 'client_error.x', 'a'.repeat(300), '../../etc', '__proto__']) {
      assert.equal((await post(invented)).status, 400, `${invented} must be refused`);
    }

    const snapshot = (await (
      await fetch(`${base}/observability`, { headers: { 'x-internal-token': TOKEN } })
    ).json()) as { counters?: Record<string, number> };
    const keys = Object.keys(snapshot.counters || {}).filter((key) =>
      key.startsWith('client_event:')
    );
    assert.equal(keys.length, 6, `only known names may become counter keys, got ${keys.join(',')}`);
  });
});
