import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchUrlCandidates,
  noteHttpsUpgradeFailure,
  resetHttpsUpgradeMemory,
  HTTPS_UPGRADE_MEMORY_MS,
  SPECULATIVE_HTTPS_TIMEOUT_MS,
  raceWithDeadline} from '../src/media/shared.js';

test('an http target still tries https FIRST — the upgrade is worth keeping', () => {
  resetHttpsUpgradeMemory();
  const candidates = fetchUrlCandidates(new URL('http://example.test:8004/mount'));
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0]?.url.protocol, 'https:');
  assert.equal(candidates[0]?.speculative, true);
  assert.equal(candidates[1]?.url.protocol, 'http:');
  assert.equal(candidates[1]?.speculative, false);
});

test('the speculative upgrade carries a SHORT deadline, the real target does not', () => {
  // Measured: an https attempt against a TLS-less Icecast hangs ~15s, while the
  // same mount over http answers in 0.18s. Charging the upgrade the full
  // upstream timeout is what made a station take «минуту» to start.
  resetHttpsUpgradeMemory();
  const [speculative, real] = fetchUrlCandidates(new URL('http://example.test:8004/mount'));
  assert.equal(speculative?.timeoutMs, SPECULATIVE_HTTPS_TIMEOUT_MS);
  assert.ok(SPECULATIVE_HTTPS_TIMEOUT_MS < 3000, 'the probe must be cheap');
  assert.equal(real?.timeoutMs, undefined, 'the real target keeps the full timeout');
});

test('a host that failed the upgrade is not probed again — the next play is instant', () => {
  resetHttpsUpgradeMemory();
  const target = new URL('http://79.120.39.202:8004/eurodance');
  noteHttpsUpgradeFailure(target, 1_000);
  const candidates = fetchUrlCandidates(target, 1_000 + 60_000);
  assert.equal(candidates.length, 1, 'only the real target remains');
  assert.equal(candidates[0]?.url.protocol, 'http:');
  // A sibling station on the SAME server benefits too — that is the point.
  const sibling = fetchUrlCandidates(new URL('http://79.120.39.202:8004/thrashmetal'), 1_000 + 60_000);
  assert.equal(sibling.length, 1);
});

test('the memory expires, so a host that later adds TLS is picked up again', () => {
  resetHttpsUpgradeMemory();
  const target = new URL('http://example.test:8004/mount');
  noteHttpsUpgradeFailure(target, 1_000);
  const after = fetchUrlCandidates(target, 1_000 + HTTPS_UPGRADE_MEMORY_MS + 1);
  assert.equal(after.length, 2, 'the upgrade is retried once the memory lapses');
  assert.equal(after[0]?.url.protocol, 'https:');
});

test('an https target is never given a speculative sibling', () => {
  resetHttpsUpgradeMemory();
  const candidates = fetchUrlCandidates(new URL('https://secure.test/mount'));
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.speculative, false);
});

test('a speculative probe stops WAITING at its deadline even when nothing aborts it', async () => {
  // This is the production failure #210 missed: with `dispatcher: buildPinnedAgent(...)`
  // the AbortController does not interrupt a stuck TLS connect, so the fetch
  // promise simply does not settle. Model that with a promise that never settles.
  let timedOut = false;
  const neverSettles = new Promise<string>(() => {});
  const started = Date.now();
  await assert.rejects(
    raceWithDeadline(neverSettles, 40, () => {
      timedOut = true;
    }),
    /timed out/
  );
  assert.equal(timedOut, true, 'onTimeout must fire so the host is remembered as failing');
  assert.ok(Date.now() - started < 1000, 'must return at the deadline, not hang');
});

test('a probe that answers in time wins the race untouched', async () => {
  let timedOut = false;
  const value = await raceWithDeadline(Promise.resolve('ok'), 1000, () => {
    timedOut = true;
  });
  assert.equal(value, 'ok');
  assert.equal(timedOut, false);
});

test('a losing probe that fails later does not crash the process', async () => {
  // Without the catch in raceWithDeadline this rejection lands after we have
  // moved on, i.e. as an unhandled rejection that takes the API down.
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const late = new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error('socket died late')), 20).unref?.();
    });
    await assert.rejects(raceWithDeadline(late, 5, () => {}), /timed out/);
    await new Promise((resolve) => setTimeout(resolve, 60));
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.deepEqual(unhandled, []);
});
