import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

/**
 * Production, 2026-08-15, ninety minutes after the metrics store was moved to a
 * path that survives deploys: pm2 restarted the API for exceeding
 * `max_memory_restart` (1114MB against a 896MB cap) while a listener was mid
 * conversation. The next boot logged
 *
 *   [Observability] failed to hydrate persisted state
 *   SyntaxError: Unexpected end of JSON input
 *
 * and then wrote its own near-empty state over everything that had accumulated:
 * `ai_chat_request` went from 6 back to 3.
 *
 * Two defects, both harmless while the store was disposable and both fatal once
 * it was not:
 *   1. `writeFile` is not atomic, and the backup rotation `rename`d the live
 *      file away BEFORE writing the new one — leaving a window with no store at
 *      all, several times a second under load.
 *   2. The rotated backups were written and never read. A corrupt live file
 *      meant starting from zero, with nothing consulted and nothing preserved.
 */

type StoreModule = typeof import('../src/observabilityStore.js');

let caseId = 0;

const withStore = async (
  run: (ctx: { dir: string; store: string; mod: StoreModule }) => Promise<void>,
  seed?: (ctx: { dir: string; store: string }) => void
) => {
  const dir = mkdtempSync(join(tmpdir(), 'radioatlas-store-'));
  const store = join(dir, 'metrics.json');
  seed?.({ dir, store });
  process.env.OBSERVABILITY_STORE_PATH = store;
  caseId += 1;
  // A fresh module instance per case: the store keeps its state in module
  // scope and reads `storePath` once, at import time. The query value stays a
  // bare number — a path ending in `.json` makes Node treat the import as JSON.
  const mod = (await import(`../src/observabilityStore.js?case=${caseId}`)) as StoreModule;
  try {
    await run({ dir, store, mod });
  } finally {
    delete process.env.OBSERVABILITY_STORE_PATH;
  }
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

test('a truncated store falls back to the rotated backup instead of starting empty', async () => {
  await withStore(
    async ({ mod }) => {
      await mod.hydrateObservabilityStore();
      const snapshot = mod.getObservabilitySnapshot();
      assert.equal(
        snapshot.counters.ai_chat_request,
        6,
        'the backup held the real history and must be used'
      );
    },
    ({ store }) => {
      // Exactly the production shape: a live file cut off mid-write, next to a
      // backup written moments earlier.
      writeFileSync(store, '{\n  "counters": {\n    "ai_chat_request": 6,\n    "ai_ag');
      writeFileSync(
        `${store}.1.bak`,
        JSON.stringify({ counters: { ai_chat_request: 6 }, gauges: {}, updatedAt: 1 })
      );
    }
  );
});

test('the unreadable file is preserved rather than silently replaced', async () => {
  await withStore(
    async ({ store, mod }) => {
      await mod.hydrateObservabilityStore();
      assert.equal(existsSync(`${store}.corrupt`), true, 'the evidence must survive');
    },
    ({ store }) => {
      writeFileSync(store, '{"counters": {"ai_chat_req');
    }
  );
});

test('a flush never leaves the store missing or half written', async () => {
  await withStore(async ({ store, dir, mod }) => {
    for (let index = 0; index < 40; index += 1) {
      mod.bumpCounter('durability_probe');
      // Read on every iteration: with rename-based writes the file is either
      // the whole previous state or the whole new one, never absent.
      if (existsSync(store)) {
        const raw = readFileSync(store, 'utf8');
        assert.doesNotThrow(() => JSON.parse(raw), `torn read on iteration ${index}`);
      }
    }
    await settle();
    const raw = JSON.parse(readFileSync(store, 'utf8'));
    assert.equal(raw.counters.durability_probe, 40);
    assert.deepEqual(
      readdirSync(dir).filter((name) => name.endsWith('.tmp')),
      [],
      'the temp file must not be left behind'
    );
  });
});

test('a missing store is an ordinary cold start, not a corruption', async () => {
  await withStore(async ({ store, mod }) => {
    await mod.hydrateObservabilityStore();
    assert.deepEqual(mod.getObservabilitySnapshot().counters, {});
    assert.equal(existsSync(`${store}.corrupt`), false, 'nothing was corrupt here');
  });
});
