import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * `test-prune-caches.sh` and `test-preserve-chunks.sh` are real tests of
 * deploy-release.sh internals — the second sources the actual function body out
 * of the deploy script so it cannot drift from the code that runs. Both had no
 * npm script and no CI step; one of them was referenced in no file at all.
 *
 * They test the two failures that filled this VPS to 96% on 2026-08-14 and the
 * rsync contract that decides whether a deploy serves half a bundle, so they
 * belong in `npm run test:scripts` alongside the ops tests that already run
 * there.
 */

const script = (name) => fileURLToPath(new URL(`./${name}`, import.meta.url));

const runShell = (name) =>
  spawnSync('bash', [script(name)], { encoding: 'utf8' });

test('prune_ffmpeg_download_cache and release retention hold', () => {
  const { status, stdout, stderr } = runShell('test-prune-caches.sh');
  assert.equal(status, 0, `${stdout}\n${stderr}`);
});

test('Telegram relay installer restarts the process and probes OpenAI without credentials', () => {
  const source = readFileSync(script('install-telegram-relay.sh'), 'utf8');
  const enable = source.indexOf('systemctl enable --now radioatlas-telegram-relay.service');
  const restart = source.indexOf('systemctl restart radioatlas-telegram-relay.service');
  const openAiProbe = source.indexOf('"http://127.0.0.1:$PORT/openai/responses"');
  const telegramProbe = source.indexOf('"http://127.0.0.1:$PORT/bot123456:not-a-real-token/getMe"');
  const openAiProbeScript = source.slice(source.indexOf('openai_code='), openAiProbe);

  assert.ok(enable >= 0 && restart > enable, 'active relay must be restarted after enabling');
  assert.ok(openAiProbe > restart && telegramProbe > openAiProbe, 'both readiness probes follow restart');
  assert.match(openAiProbeScript, /-X GET/);
  assert.match(source, /if \[\[ "\$openai_code" != "405" \]\]/);
  assert.match(source, /if \[\[ "\$code" != "401" \]\]/);
  assert.doesNotMatch(openAiProbeScript, /Authorization|Bearer/i);
});

test('preserve_previous_chunks fills deleted chunks without overwriting new ones', (t) => {
  const { status, stdout, stderr } = runShell('test-preserve-chunks.sh');
  const output = `${stdout}\n${stderr}`;
  if (/^SKIP:/m.test(output)) {
    // Windows has no rsync, so this one proves nothing on a developer box. It
    // is the deploy host's platform that matters, and CI runs on Linux.
    t.skip(output.trim());
    return;
  }
  assert.equal(status, 0, output);
});
