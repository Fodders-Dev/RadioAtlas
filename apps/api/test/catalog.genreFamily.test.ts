import assert from 'node:assert/strict';
import test from 'node:test';
import { GENRE_FAMILIES, normalizeGenreTag, stationGenreFamily } from '../src/catalog/genreFamily.js';

// The calm Globe colours its dots by a coarse family decided here from the raw
// tags. The rule must be stable (first recognised tag wins, in the
// broadcaster's order) and honest (an unknown tag yields nothing, never a
// guess), because a listener reads the colour as a claim about the station.

test('the first recognised tag decides the family, in the broadcaster order', () => {
  assert.equal(stationGenreFamily('jazz,public radio'), 'jazz');
  assert.equal(stationGenreFamily('commercial,local radio,rock,pop'), 'rock');
  assert.equal(stationGenreFamily('pop,rock'), 'pop');
  assert.equal(stationGenreFamily('Hip-Hop, RnB'), 'hiphop');
});

test('decoration around a tag is ignored but nothing is guessed', () => {
  assert.equal(stationGenreFamily('Jazz Radio'), 'jazz');
  assert.equal(stationGenreFamily('the blues'), 'jazz');
  assert.equal(stationGenreFamily("80's"), 'pop');
  assert.equal(stationGenreFamily('full service,iheart,commercial'), null);
  assert.equal(stationGenreFamily(''), null);
  assert.equal(stationGenreFamily(undefined), null);
  assert.equal(stationGenreFamily('🎧'), null);
});

test('every family is reachable and the normaliser collapses punctuation', () => {
  const samples: Record<string, string> = {
    pop: 'top 40', rock: 'metal', electronic: 'techno', jazz: 'soul', classical: 'piano',
    chill: 'lounge', hiphop: 'reggae', world: 'cumbia', talk: 'news talk'
  };
  for (const family of GENRE_FAMILIES) assert.equal(stationGenreFamily(samples[family]), family, family);
  assert.equal(normalizeGenreTag('  HIP--Hop / Rap '), "hip hop rap");
});
