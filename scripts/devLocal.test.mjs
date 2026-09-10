import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, relative, isAbsolute } from 'node:path';
import { createDevConfig } from './devLocal.mjs';

test('local launcher overrides inherited stores and keeps each worktree isolated', () => {
  const root = resolve('example-worktree');
  const first = createDevConfig(root, {
    PORT: '3001', VITE_API_PROXY_PORT: '3001', API_BIND_HOST: '0.0.0.0',
    ACCOUNT_STORE_PATH: '/shared/accounts', OBSERVABILITY_STORE_PATH: '/shared/observability',
    STATION_INTEL_DB_PATH: '/shared/intel', SCENE_ARTWORK_DIR: '/shared/artwork', SCENE_ARTWORK_ENABLED: '1',
    CATALOG_DATA_DIR: '/shared/catalog', AI_ENABLED: '1', BILLING_RECONCILE_ENABLED: '1', ENABLE_TEST_AUTH_FIXTURES: '1'
  });
  for (const key of ['ACCOUNT_STORE_PATH', 'OBSERVABILITY_STORE_PATH', 'CATALOG_DATA_DIR', 'STATION_INTEL_DB_PATH', 'SCENE_ARTWORK_DIR']) {
    const rel = relative(root, first.apiEnv[key]);
    assert.ok(!rel.startsWith('..') && !isAbsolute(rel), key);
    assert.notEqual(first.apiEnv[key], createDevConfig(resolve('other-worktree'), {}).apiEnv[key]);
  }
  assert.equal(first.apiEnv.PORT, '4341');
  assert.equal(first.webEnv.VITE_API_PROXY_PORT, '4341');
  assert.equal(first.apiEnv.API_BIND_HOST, '127.0.0.1');
  assert.equal(first.apiEnv.CATALOG_ARTIFACT_ONLY, '1');
  for (const key of ['AI_ENABLED', 'BILLING_RECONCILE_ENABLED', 'ENABLE_TEST_AUTH_FIXTURES', 'SCENE_ARTWORK_ENABLED']) assert.equal(first.apiEnv[key], '0');
});

test('custom ports stay paired and invalid/colliding ports fail before starting anything', () => {
  const config = createDevConfig(resolve('.'), { RADIO_DEV_WEB_PORT: '5185', RADIO_DEV_API_PORT: '4342' });
  assert.equal(config.webPort, 5185);
  assert.equal(config.apiEnv.PORT, '4342');
  assert.equal(config.webEnv.VITE_API_PROXY_PORT, '4342');
  for (const value of ['oops', '-1', '0', '80', '1.2', '65536']) {
    assert.throws(() => createDevConfig(resolve('.'), { RADIO_DEV_API_PORT: value }));
  }
  assert.throws(() => createDevConfig(resolve('.'), { RADIO_DEV_API_PORT: '5184' }));
});
