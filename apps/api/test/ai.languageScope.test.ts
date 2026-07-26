import assert from 'node:assert/strict';
import test from 'node:test';
import { runTool } from '../src/ai/tools.js';
import type { SearchStationsArgs, ToolProvider } from '../src/ai/types.js';

/**
 * The listener asked for something like Жасмин — a Russian artist — and got pop
 * stations from France, Switzerland, Türkiye, an Arabic-pop channel and the USA.
 * The catalogue CAN filter by language; nothing ever set it, because the planner
 * writes a bare English genre («pop») and has no idea the subject was Russian.
 *
 * The scope is computed deterministically before the model runs, and applied
 * here only when the planner left both language and country empty — an explicit
 * «бразильское радио» must never be overridden into Russian.
 */
const captureProvider = (seen: SearchStationsArgs[]): ToolProvider => ({
  searchStations: async (args) => {
    seen.push(args);
    return [];
  },
  getStation: async () => null,
  discoverTrending: async () => []
});

test('a language scope fills an empty language filter', async () => {
  const seen: SearchStationsArgs[] = [];
  await runTool('search_stations', { query: 'pop' }, {
    tools: captureProvider(seen),
    musicServices: [],
    languageScope: 'russian'
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.language, 'russian', 'the scope must reach the catalogue');
});

test('an explicit language from the planner always wins', async () => {
  const seen: SearchStationsArgs[] = [];
  await runTool('search_stations', { query: 'pop', language: 'french' }, {
    tools: captureProvider(seen),
    musicServices: [],
    languageScope: 'russian'
  });
  assert.equal(seen[0]!.language, 'french');
});

test('an explicit country also suppresses the scope', async () => {
  // «что-то бразильское» resolves to a country; narrowing that to Russian would
  // return nothing and look like a broken search.
  const seen: SearchStationsArgs[] = [];
  await runTool('search_stations', { query: 'samba', country: 'Brazil' }, {
    tools: captureProvider(seen),
    musicServices: [],
    languageScope: 'russian'
  });
  assert.equal(seen[0]!.country, 'Brazil');
  assert.equal(seen[0]!.language, undefined, 'must not smuggle russian in beside a country');
});

test('no scope means no filter', async () => {
  const seen: SearchStationsArgs[] = [];
  await runTool('search_stations', { query: 'jazz' }, {
    tools: captureProvider(seen),
    musicServices: []
  });
  assert.equal(seen[0]!.language, undefined);
});

/**
 * The first wiring attempt reached production applying the scope to exactly ONE
 * of the ten runTool call sites — the planner loop — while six OTHER
 * search_stations calls bypass that loop entirely. «посоветуй что-нибудь как
 * Жасмин» went through one of those and still returned Swiss and French pop.
 *
 * This asserts against the SOURCE: every search_stations invocation must carry
 * the scope, because a missed one fails silently and looks exactly like a
 * scoping rule that does not work.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

test('every search_stations call site passes the language scope', () => {
  const brainPath = resolve(dirname(fileURLToPath(import.meta.url)), '../src/ai/brain.ts');
  const source = readFileSync(brainPath, 'utf8');
  const lines = source.split('\n');

  const missing: string[] = [];
  lines.forEach((line, index) => {
    if (!line.includes("runTool('search_stations'")) return;
    const ctx = lines.slice(index, index + 8).join('\n');
    // The planner loop receives it as a function parameter and forwards it.
    if (!ctx.includes('languageScope')) missing.push(`line ${index + 1}`);
  });

  assert.deepEqual(
    missing,
    [],
    `these search_stations calls would silently ignore the language scope: ${missing.join(', ')}`
  );
});
