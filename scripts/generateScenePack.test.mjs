import assert from 'node:assert/strict';
import test from 'node:test';
import { RANKED_SURFACES, collectStations, selectRankedStationIds } from './generateScenePack.mjs';

// The scene budget is 60 images/day against a ~61k catalogue, so WHERE it is
// spent is the entire design. This pins the one property that matters: the
// random pools must never receive a paid image.

const station = (id) => ({ stationuuid: id, name: id });

// Key order deliberately mirrors the real /catalog/summary payload, where
// `catalogPool` comes FIRST — that ordering is what used to eat the budget.
const summary = () => ({
  generatedAt: 1,
  counts: { stations: 61470 },
  catalogPool: Array.from({ length: 48 }, (_, i) => station(`pool-${i}`)),
  freshSignals: Array.from({ length: 8 }, (_, i) => station(`fresh-${i}`)),
  searchLaunch: Array.from({ length: 8 }, (_, i) => station(`launch-${i}`)),
  sponsored: [station('sponsored-0')],
  countrySpotlight: { label: 'Japan', stations: [station('country-0')] },
  genreSpotlight: { label: 'jazz', stations: [station('genre-0')] },
  trending: [station('trending-0'), station('trending-1')],
  topVoted: [station('voted-0')],
  aroundTheWorld: { label: 'Peru', stations: [station('world-0')] },
  moodRails: [
    { id: 'mood-late-night', stations: [station('mood-0')] },
    { id: 'mood-driving', stations: [station('mood-1')] }
  ]
});

test('the random pools never receive a paid image', () => {
  const { stationIds, ignored } = selectRankedStationIds(summary());
  for (const id of stationIds) {
    assert.ok(
      !/^(pool|fresh|launch)-/.test(id),
      `${id} comes from a pool re-drawn hourly over the whole catalogue`
    );
  }
  assert.deepEqual(ignored.sort(), ['catalogPool', 'freshSignals', 'searchLaunch']);
});

test('ranked shelves are ordered most-durable first', () => {
  const { stationIds } = selectRankedStationIds(summary());
  assert.deepEqual(stationIds, [
    'sponsored-0',
    'trending-0',
    'trending-1',
    'voted-0',
    'mood-0',
    'mood-1',
    'country-0',
    'genre-0',
    'world-0'
  ]);
});

test('explicit priority ids lead, and duplicates collapse', () => {
  const { stationIds } = selectRankedStationIds(summary(), ['pinned-0', 'trending-1']);
  assert.equal(stationIds[0], 'pinned-0');
  assert.equal(stationIds[1], 'trending-1', 'a pinned id keeps its leading position');
  assert.equal(
    stationIds.filter((id) => id === 'trending-1').length,
    1,
    'a station must not consume two slots of the batch'
  );
});

test('a surface the API stops sending is not an error', () => {
  const partial = { trending: [station('trending-0')] };
  const { stationIds, perSurface } = selectRankedStationIds(partial);
  assert.deepEqual(stationIds, ['trending-0']);
  assert.equal(perSurface.moodRails, 0);
  assert.equal(RANKED_SURFACES.length, Object.keys(perSurface).length);
});

test('collectStations reaches nested shelves and ignores non-stations', () => {
  assert.deepEqual(collectStations({ a: { stations: [station('x')] }, b: 'label', c: null }), ['x']);
  assert.deepEqual(collectStations({ stationuuid: '   ' }), [], 'a blank id is not a station');
});
