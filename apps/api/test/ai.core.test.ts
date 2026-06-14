import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALL_MUSIC_SERVICES,
  buildServiceSearchLinks,
  parseMusicServices
} from '../src/ai/musicLinks.js';
import {
  TOOL_NAMES,
  extractJsonObject,
  parsePlannerDecision,
  runTool,
  toolSignature
} from '../src/ai/tools.js';
import {
  cleanText,
  collectVerifiedStations,
  isVoiceSafe
} from '../src/ai/antiHallucination.js';
import { createRollingVolumeCap } from '../src/ai/volumeCap.js';
import type { ToolObservation, ToolProvider, VerifiedStationRef } from '../src/ai/types.js';

const station = (over: Partial<VerifiedStationRef> = {}): VerifiedStationRef => ({
  stationuuid: 'uuid-1',
  name: 'Jazz FM',
  country: 'France',
  tags: ['jazz'],
  favicon: '',
  url_resolved: 'http://stream/1',
  ...over
});

// --- musicLinks ------------------------------------------------------------
test('buildServiceSearchLinks url-encodes the query for all six services', () => {
  const links = buildServiceSearchLinks('Boards of Canada & friends');
  assert.equal(links.length, 6);
  for (const link of links) {
    assert.ok(link.url.includes('Boards%20of%20Canada'));
    assert.ok(!link.url.includes(' & '));
    assert.equal(link.query, 'Boards of Canada & friends');
  }
  const spotify = links.find((l) => l.service === 'spotify');
  assert.ok(spotify?.url.startsWith('https://open.spotify.com/search/'));
});

test('buildServiceSearchLinks returns nothing for an empty query', () => {
  assert.deepEqual(buildServiceSearchLinks('   '), []);
});

test('parseMusicServices falls back to all six on empty/invalid, de-dupes valid', () => {
  assert.deepEqual(parseMusicServices(''), ALL_MUSIC_SERVICES);
  assert.deepEqual(parseMusicServices('nope,bogus'), ALL_MUSIC_SERVICES);
  assert.deepEqual(parseMusicServices('spotify, spotify ,youtube'), ['spotify', 'youtube']);
});

// --- planner JSON parsing --------------------------------------------------
test('extractJsonObject strips ```json fences and tolerates trailing prose', () => {
  assert.deepEqual(extractJsonObject('```json\n{"action":"final"}\n```'), { action: 'final' });
  assert.deepEqual(
    extractJsonObject('Sure: {"action":"use_tool","tool":"search_stations"} hope that helps'),
    { action: 'use_tool', tool: 'search_stations' }
  );
  assert.equal(extractJsonObject('no json here'), null);
});

test('parsePlannerDecision: parse-fail and unknown tool both collapse to final', () => {
  assert.equal(parsePlannerDecision('garbage').action, 'final');
  assert.equal(parsePlannerDecision('{"action":"use_tool","tool":"rm_rf"}').action, 'final');
  const ok = parsePlannerDecision('{"action":"use_tool","tool":"search_stations","args":{"query":"jazz"}}');
  assert.equal(ok.action, 'use_tool');
  assert.equal(ok.tool, 'search_stations');
  assert.deepEqual(ok.args, { query: 'jazz' });
});

test('toolSignature is order-independent over args', () => {
  assert.equal(
    toolSignature('search_stations', { query: 'jazz', limit: 5 }),
    toolSignature('search_stations', { limit: 5, query: 'jazz' })
  );
  assert.ok(TOOL_NAMES.includes('music_service_search'));
});

// --- runTool ---------------------------------------------------------------
const stubTools: ToolProvider = {
  searchStations: async () => [station()],
  getStation: async (id) => (id === 'uuid-1' ? station() : null),
  discoverTrending: async () => [{ id: 'mood-focus', label: 'Фокус', stations: [station({ stationuuid: 'uuid-2' })] }]
};

test('runTool: search/get/trending bind the provider; music_service_search is deterministic', async () => {
  const search = await runTool('search_stations', { query: 'jazz' }, { tools: stubTools, musicServices: ALL_MUSIC_SERVICES });
  assert.equal(search.found, true);
  assert.equal(search.stations?.[0]?.stationuuid, 'uuid-1');

  const miss = await runTool('get_station', { id: 'nope' }, { tools: stubTools, musicServices: ALL_MUSIC_SERVICES });
  assert.equal(miss.found, false);

  const links = await runTool('music_service_search', { query: 'Aphex Twin' }, { tools: stubTools, musicServices: ALL_MUSIC_SERVICES });
  assert.equal(links.serviceLinks?.length, 6);
});

test('runTool never throws — a provider that throws becomes a found:false observation', async () => {
  const boom: ToolProvider = {
    ...stubTools,
    searchStations: async () => {
      throw new Error('catalog down');
    }
  };
  const obs = await runTool('search_stations', { query: 'x' }, { tools: boom, musicServices: ALL_MUSIC_SERVICES });
  assert.equal(obs.found, false);
  assert.ok(obs.error);
});

// --- anti-hallucination ----------------------------------------------------
test('collectVerifiedStations: dedup by uuid, drop streamless, cap at 5', () => {
  const obs: ToolObservation[] = [
    { tool: 'search_stations', args: {}, found: true, stations: [station(), station(), station({ stationuuid: 'u2' }), station({ stationuuid: 'u3', url_resolved: '' })] }
  ];
  const out = collectVerifiedStations(obs);
  assert.deepEqual(out.map((s) => s.stationuuid), ['uuid-1', 'u2']); // u3 dropped (no stream), uuid-1 deduped
});

test('collectVerifiedStations returns nothing when there are no observations (fake-station guard)', () => {
  assert.deepEqual(collectVerifiedStations([]), []);
});

test('isVoiceSafe rejects bot/AI disclosure, bartender metaphor, and tech-speak', () => {
  assert.equal(isVoiceSafe('Под джаз обожаю вечер у окна.'), true);
  assert.equal(isVoiceSafe('Я ассистент и помогу тебе.'), false);
  assert.equal(isVoiceSafe('Я являюсь ботом.'), false); // noun form
  assert.equal(isVoiceSafe('Я языковая модель.'), false);
  assert.equal(isVoiceSafe('Сейчас налью тебе джаза, я твой бармен.'), false);
  assert.equal(isVoiceSafe('каталог станций'), false);
});

test('isVoiceSafe no longer false-flags legit music talk (regression)', () => {
  // The narrowed regexes must NOT reject ordinary music phrasing.
  assert.equal(isVoiceSafe('В каталоге Blue Note столько джаза'), true);
  assert.equal(isVoiceSafe('Песня наливается силой'), true);
});

test('cleanText: Telegram gets escaped HTML, Mini App gets plain text, both truncate', () => {
  const tg = cleanText('**Жаркий** джаз <3 и `код`', 'telegram');
  assert.ok(tg.includes('<b>Жаркий</b>'));
  assert.ok(tg.includes('&lt;3'));
  assert.ok(tg.includes('<code>код</code>'));

  const mini = cleanText('**Жаркий** джаз <3', 'miniapp');
  assert.ok(mini.includes('Жаркий'));
  assert.ok(!mini.includes('<b>'));
  assert.ok(mini.includes('<3')); // no HTML escaping for the Mini App

  const long = cleanText('а '.repeat(4000), 'miniapp');
  assert.ok(long.length <= 3500);
});

test('cleanText: truncating a >3500 bold span never emits an unbalanced <b>/<code> (Telegram 400 guard)', () => {
  // A single bold span longer than the cap. Truncating AFTER building <b> would
  // drop the closing </b> → Telegram 400. We truncate the plain text first, so
  // the interrupted ** simply never becomes a tag — counts stay balanced.
  const bold = cleanText(`**${'я '.repeat(3000)}**`, 'telegram');
  const open = (bold.match(/<b>/g) || []).length;
  const close = (bold.match(/<\/b>/g) || []).length;
  assert.equal(open, close);
  const codeRaw = cleanText(`\`${'к '.repeat(3000)}\``, 'telegram');
  assert.equal((codeRaw.match(/<code>/g) || []).length, (codeRaw.match(/<\/code>/g) || []).length);
  assert.ok(bold.length <= 3500);
});

test('createRollingVolumeCap: accepts up to max per window, then caps; resets next window', () => {
  let clock = 1000;
  const cap = createRollingVolumeCap({ windowMs: 1000, max: 3, now: () => clock });
  assert.equal(cap.exceeded(), false); // 1
  assert.equal(cap.exceeded(), false); // 2
  assert.equal(cap.exceeded(), false); // 3
  assert.equal(cap.exceeded(), true); // 4 → over
  assert.equal(cap.exceeded(), true); // still over within the window
  clock += 1000; // new window
  assert.equal(cap.exceeded(), false);
});
