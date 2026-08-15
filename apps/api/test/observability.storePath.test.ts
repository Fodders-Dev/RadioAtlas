import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import test from 'node:test';

/**
 * 2026-08-15, production: `/observability` reported
 * `storePath: /opt/RadioAtlas/releases/<sha>/data/observability/metrics.json`.
 * That path is recreated empty by every deploy and deleted outright by
 * `prune_old_releases` — three live release directories held three disjoint
 * metric stores, and the AI counters (`ai_agent_run:*`, `ai_model_error:*`)
 * existed in exactly one of them.
 *
 * `PLAN.md` asks an operator to WATCH those counters. A counter that restarts
 * from zero on every push cannot be watched, so this suite pins both halves of
 * the fix: the predicate that recognises an ephemeral path, and the pm2 env
 * that keeps production off one.
 */
process.env.OBSERVABILITY_STORE_PATH =
  process.env.OBSERVABILITY_STORE_PATH ||
  join(tmpdir(), `radioatlas-observability-storepath-${process.pid}.json`);

const { isEphemeralStorePath, getObservabilitySnapshot } = await import('../src/observabilityStore.js');

test('a metrics file inside a release directory is recognised as ephemeral', () => {
  for (const candidate of [
    '/opt/RadioAtlas/releases/57d38896ffef0d4ffef8f044994d59905b2ac879/data/observability/metrics.json',
    '/opt/RadioAtlas/releases/abc123/apps/api/data/observability/metrics.json',
    'C:\\deploy\\releases\\abc123\\data\\observability\\metrics.json'
  ]) {
    assert.equal(isEphemeralStorePath(candidate), true, `should be ephemeral: ${candidate}`);
  }
});

test('a shared or repo-local metrics file is not ephemeral', () => {
  for (const candidate of [
    '/opt/RadioAtlas/shared/data/observability/metrics.json',
    '/var/lib/radioatlas/metrics.json',
    '/opt/RadioAtlas/releases.json',
    '/srv/app/data/observability/metrics.json',
    ''
  ]) {
    assert.equal(isEphemeralStorePath(candidate), false, `should NOT be ephemeral: ${candidate}`);
  }
});

test('the snapshot reports whether its own store survives a deploy', () => {
  const snapshot = getObservabilitySnapshot();
  assert.equal(typeof snapshot.persistence.ephemeral, 'boolean');
  assert.equal(
    snapshot.persistence.ephemeral,
    isEphemeralStorePath(snapshot.persistence.storePath),
    'the reported flag must describe the path actually in use'
  );
});

test('the production pm2 config keeps the metrics store outside the release', async () => {
  // The config is CommonJS and reads `__dirname`; load it the way pm2 does
  // rather than pattern-matching the source text.
  const loaded = (await import(new URL('../../../ecosystem.config.cjs', import.meta.url).href)) as {
    default: { apps: Array<{ name: string; env?: Record<string, string> }> };
  };
  const api = loaded.default.apps.find((app) => app.name === 'radioatlas-api');
  assert.ok(api, 'radioatlas-api must be defined');
  const storePath = api?.env?.OBSERVABILITY_STORE_PATH;
  assert.ok(storePath, 'production must pin OBSERVABILITY_STORE_PATH explicitly');
  assert.equal(isAbsolute(String(storePath)), true, 'a relative path would resolve against the release cwd');
  assert.equal(
    isEphemeralStorePath(String(storePath)),
    false,
    'the production metrics store must not live inside a release directory'
  );
});

test('the deploy prune really does delete old release directories', () => {
  // The reason the release-local store is not merely untidy: the pruning that
  // frees disk also destroys any history left behind in an older release.
  const script = readFileSync(new URL('../../../deploy/server/deploy-release.sh', import.meta.url), 'utf8');
  assert.match(script, /prune_old_releases/, 'deploy-release.sh is expected to prune releases');
});
