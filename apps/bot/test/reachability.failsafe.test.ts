import assert from 'node:assert/strict';
import test from 'node:test';
import { recordReachability, type ReachabilityDeps } from '../src/botReachability.js';

// R1 (PR-A): the /start handler calls recordReachability fire-and-forget AFTER
// replying. These tests prove it can NEVER break onboarding — it must resolve
// (never reject/throw) on every failure mode — and that on success it posts the
// right shape to the internal endpoint.

const baseDeps = (over: Partial<ReachabilityDeps> = {}): ReachabilityDeps & { logs: string[] } => {
  const logs: string[] = [];
  return {
    fetch: (async () => ({ ok: true, status: 200 })) as unknown as typeof fetch,
    apiUrl: 'http://api.test',
    internalWebhookToken: 'secret-token',
    ...over,
    log: (line: string) => logs.push(line),
    logs
  };
};

test('FAIL-SAFE: a thrown fetch never rejects (onboarding unaffected)', async () => {
  const deps = baseDeps({
    fetch: (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch
  });
  const result = await recordReachability(deps, 12345);
  assert.equal(result, false);
  assert.ok(deps.logs.some((l) => l.includes('reachability fetch failed')));
});

test('FAIL-SAFE: a non-2xx response never rejects', async () => {
  const deps = baseDeps({
    fetch: (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch
  });
  const result = await recordReachability(deps, 12345);
  assert.equal(result, false);
  assert.ok(deps.logs.some((l) => l.includes('non-2xx')));
});

test('skips (no throw) when API_URL or token is missing', async () => {
  await assert.doesNotReject(recordReachability(baseDeps({ apiUrl: '' }), 1));
  await assert.doesNotReject(recordReachability(baseDeps({ internalWebhookToken: '' }), 1));
});

test('skips (no fetch) on a blank telegram id', async () => {
  let called = 0;
  const deps = baseDeps({
    fetch: (async () => {
      called += 1;
      return { ok: true, status: 200 };
    }) as unknown as typeof fetch
  });
  assert.equal(await recordReachability(deps, undefined), false);
  assert.equal(await recordReachability(deps, ''), false);
  assert.equal(called, 0);
});

test('on success: POSTs telegramId to the internal endpoint with X-Internal-Token', async () => {
  let captured: { url: string; init: RequestInit } | null = null;
  const deps = baseDeps({
    fetch: (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return { ok: true, status: 200 };
    }) as unknown as typeof fetch
  });
  const result = await recordReachability(deps, 777);
  assert.equal(result, true);
  assert.equal(captured!.url, 'http://api.test/internal/bot/reachable');
  assert.equal(captured!.init.method, 'POST');
  assert.equal(
    (captured!.init.headers as Record<string, string>)['X-Internal-Token'],
    'secret-token'
  );
  assert.deepEqual(JSON.parse(String(captured!.init.body)), { telegramId: '777' });
});
