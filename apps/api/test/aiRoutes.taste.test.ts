import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUserTasteContext } from '../src/aiRoutes.js';

test('parseUserTasteContext normalizes and caps Mini App taste payloads', () => {
  const taste = parseUserTasteContext({
    favoriteStationIds: [' a ', '', 'a', 'b'],
    recentStationIds: [' r1 ', 'r1', 'r2'],
    hiddenStationIds: [' h1 '],
    negativeStationIds: [' n1 '],
    lastRecommendedStationIds: [' old1 ', 'old2'],
    stationScores: {
      ' Station-A ': 12.34567,
      'Station-B': -99,
      nope: 'bad'
    },
    tagScores: {
      Jazz: 12.34567,
      ambient: -4,
      noise: 'bad',
      tiny: 0.001
    },
    countryScores: {
      Russia: 99,
      Germany: -99
    },
    languageScores: {
      English: 3
    }
  });

  assert.deepEqual(taste?.favoriteStationIds, ['a', 'b']);
  assert.deepEqual(taste?.recentStationIds, ['r1', 'r2']);
  assert.deepEqual(taste?.hiddenStationIds, ['h1']);
  assert.deepEqual(taste?.negativeStationIds, ['n1']);
  assert.deepEqual(taste?.lastRecommendedStationIds, ['old1', 'old2']);
  assert.equal(taste?.stationScores?.['Station-A'], 12.3457);
  assert.equal(taste?.stationScores?.['Station-B'], -40);
  assert.equal(taste?.stationScores?.nope, undefined);
  assert.equal(taste?.tagScores?.jazz, 12.3457);
  assert.equal(taste?.tagScores?.ambient, -4);
  assert.equal(taste?.tagScores?.noise, undefined);
  assert.equal(taste?.tagScores?.tiny, undefined);
  assert.equal(taste?.countryScores?.russia, 40);
  assert.equal(taste?.countryScores?.germany, -40);
  assert.equal(taste?.languageScores?.english, 3);
});

test('parseUserTasteContext drops empty or malformed payloads', () => {
  assert.equal(parseUserTasteContext(null), undefined);
  assert.equal(parseUserTasteContext([]), undefined);
  assert.equal(parseUserTasteContext({ tagScores: { jazz: 'nope' }, favoriteStationIds: [''] }), undefined);
});
