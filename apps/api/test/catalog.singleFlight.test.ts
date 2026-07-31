import assert from 'node:assert/strict';
import test from 'node:test';
import { createCatalogSingleFlight } from '../src/catalog/singleFlight.js';

test('coalesces concurrent loads per catalog mode', async () => {
  const resolveFlight = createCatalogSingleFlight<string[]>();
  let fullCalls = 0;
  let fastCalls = 0;
  let releaseFull!: () => void;
  const fullGate = new Promise<void>((resolve) => {
    releaseFull = resolve;
  });

  const loadFull = async () => {
    fullCalls += 1;
    await fullGate;
    return ['full'];
  };
  const loadFast = async () => {
    fastCalls += 1;
    return ['fast'];
  };

  const first = resolveFlight('full', loadFull);
  const second = resolveFlight('full', loadFull);
  const fast = resolveFlight('fast', loadFast);

  assert.strictEqual(second, first, 'same-mode callers share the exact in-flight promise');
  assert.notStrictEqual(fast, first, 'fast and full loads remain independent');
  releaseFull();

  assert.deepEqual(await first, ['full']);
  assert.deepEqual(await second, ['full']);
  assert.deepEqual(await fast, ['fast']);
  assert.equal(fullCalls, 1);
  assert.equal(fastCalls, 1);
});

test('clears a rejected flight so the next request can retry', async () => {
  const resolveFlight = createCatalogSingleFlight<string[]>();
  let calls = 0;
  const load = async () => {
    calls += 1;
    if (calls === 1) throw new Error('catalog unavailable');
    return ['recovered'];
  };

  const first = resolveFlight('full', load);
  const second = resolveFlight('full', load);
  assert.strictEqual(second, first);
  await assert.rejects(first, /catalog unavailable/);

  assert.deepEqual(await resolveFlight('full', load), ['recovered']);
  assert.equal(calls, 2);
});
