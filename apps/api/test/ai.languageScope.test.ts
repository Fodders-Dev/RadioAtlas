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
