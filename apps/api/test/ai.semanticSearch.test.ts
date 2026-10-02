import assert from 'node:assert/strict';
import test from 'node:test';
import { registerCatalogueTagEvidence } from '../src/ai/catalogueTagEvidence.js';
import { balancedSemanticStations, matchesSemanticTag, parseSemanticSearch } from '../src/ai/semanticSearch.js';
import type { VerifiedStationRef } from '../src/ai/types.js';

const station = (id: string, tags: string[] = [], name = id): VerifiedStationRef => ({
  stationuuid: id,
  name,
  country: 'Canada',
  tags,
  favicon: '',
  url_resolved: `https://audio.example/${id}`
});

test('parseSemanticSearch accepts future genres and normalizes safe labels and known aliases', () => {
  assert.deepEqual(parseSemanticSearch({ kind: 'genre', tags: ['  Future   Garage ', 'Breakcore'] }), {
    kind: 'genre', tags: ['future garage', 'breakcore']
  });
  assert.deepEqual(parseSemanticSearch({ kind: 'hypothesis', tags: ['DnB', 'deep house'] }), {
    kind: 'hypothesis', tags: ['drum and bass', 'deep house']
  });
  assert.deepEqual(parseSemanticSearch({ kind: 'genre', tags: ['DnB', 'drum and bass'] }), {
    kind: 'genre', tags: ['drum and bass']
  });
  assert.deepEqual(parseSemanticSearch({ kind: 'genre', tags: ['Hip-Hop', 'Lo-Fi'] }), {
    kind: 'genre', tags: ['hip hop', 'lo fi']
  });
  assert.deepEqual(parseSemanticSearch({ kind: 'hypothesis', tags: ['Drum & Bass', "Drum 'n' Bass"] }), {
    kind: 'hypothesis', tags: ['drum and bass']
  });
});

test('parseSemanticSearch rejects malformed or unsafe input all-or-nothing', () => {
  for (const value of [
    null,
    [],
    { kind: 'genre', tags: ['future garage'], extra: true },
    { kind: 'genre', tags: ['future garage'], extra: undefined },
    { kind: 'intent', tags: ['jazz'] },
    { kind: 'genre', tags: [] },
    { kind: 'genre', tags: ['jazz', 'house', 'breakcore'] },
    { kind: 'genre', tags: ['jazz', 'Not safe!'] },
    { kind: 'genre', tags: ['jazz,house'] },
    { kind: 'genre', tags: ['https://example.com'] },
    { kind: 'genre', tags: ['<jazz>'] },
    { kind: 'genre', tags: ['jazz\nhouse'] },
    { kind: 'genre', tags: ['джаз'] },
    { kind: 'genre', tags: ['a'] },
    { kind: 'genre', tags: ['x'.repeat(41)] },
    { kind: 'genre', tags: [7] }
  ]) assert.equal(parseSemanticSearch(value), undefined, JSON.stringify(value));
});

test('matchesSemanticTag uses full own catalogue evidence and exact normalized labels', () => {
  const fullEvidenceRow = station('full', ['jazz', 'soul']);
  // The public card projection can omit later tags; in-process catalogue
  // evidence remains authoritative for semantic filtering.
  registerCatalogueTagEvidence(fullEvidenceRow, ['jazz', 'rock', 'pop', 'ambient', 'funk', 'future garage']);
  assert.equal(matchesSemanticTag(fullEvidenceRow, 'future garage'), true);

  assert.equal(matchesSemanticTag(station('alias', ['DnB']), 'drum and bass'), true);
  assert.equal(matchesSemanticTag(station('hip-hop', ['hip hop']), 'Hip-Hop'), true);
  assert.equal(matchesSemanticTag(station('lo-fi', ['lo-fi']), 'lo fi'), true);
  assert.equal(matchesSemanticTag(station('dnb-alias', ['Drum & Bass']), "Drum 'n' Bass"), true);
  assert.equal(matchesSemanticTag(station('deep', ['deep house']), 'deep house'), true);
  assert.equal(matchesSemanticTag(station('compact-deep', ['deephouse']), 'deep house'), true);
  assert.equal(matchesSemanticTag(station('compact-lofi', ['lofi']), 'lo-fi'), true);
  assert.equal(matchesSemanticTag(station('compact-trip', ['triphop']), 'trip-hop'), true);
  assert.equal(matchesSemanticTag(station('jungle', ['jungle']), 'drum and bass'), false);
  assert.equal(matchesSemanticTag(station('name-only', ['ambient'], 'Breakcore Radio'), 'breakcore'), false);
  assert.equal(matchesSemanticTag(station('coarse', ['jungle']), 'electronic'), false);
  assert.equal(matchesSemanticTag(station('not-full-tag', ['future garage mix']), 'future garage'), false);
  assert.equal(matchesSemanticTag(station('unrelated', ['jazz']), 'rawsingletag'), false);
  assert.equal(matchesSemanticTag(station('broken', ['jazz']), 'jazz/house'), false);
  assert.equal(matchesSemanticTag(station('null', ['jazz']), null as never), false);
});

test('balancedSemanticStations transposes groups and reuses canonical station deduplication', () => {
  const first = [station('a1'), station('a2'), station('a3')];
  const second = [station('b1'), station('b2'), station('b3')];
  assert.deepEqual(balancedSemanticStations([first, second]).map(row => row.stationuuid), [
    'a1', 'b1', 'a2', 'b2', 'a3'
  ]);

  const mirrored = station('mirror', [], 'Same Station');
  const original = station('original', [], 'Same Station');
  assert.deepEqual(balancedSemanticStations([[original], [mirrored]]).map(row => row.stationuuid), ['original']);
  assert.deepEqual(balancedSemanticStations([[station('same')], [station('same')]]).map(row => row.stationuuid), ['same']);
});
