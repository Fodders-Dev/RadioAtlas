import assert from 'node:assert/strict';
import test from 'node:test';
import { requestedGenreSlots } from '../src/ai/requestedGenreSlots.js';

test('requestedGenreSlots resolves directly counted Russian and English genre stations', () => {
  assert.deepEqual(requestedGenreSlots('Подбери две станции: одну с фанком, другую с эмбиентом'), [
    { genre: 'funk', count: 1 }, { genre: 'ambient', count: 1 }
  ]);
  assert.deepEqual(requestedGenreSlots('Найди одну фанк-станцию и одну эмбиент-станцию. Не включай.'), [
    { genre: 'funk', count: 1 }, { genre: 'ambient', count: 1 }
  ]);
  assert.deepEqual(requestedGenreSlots('один фанк, один эмбиент'), [
    { genre: 'funk', count: 1 }, { genre: 'ambient', count: 1 }
  ]);
  assert.deepEqual(requestedGenreSlots('Give me one funk station and one ambient station'), [
    { genre: 'funk', count: 1 }, { genre: 'ambient', count: 1 }
  ]);
  assert.deepEqual(requestedGenreSlots('Play one funk station and one ambient station'), [
    { genre: 'funk', count: 1 }, { genre: 'ambient', count: 1 }
  ]);
  assert.deepEqual(requestedGenreSlots('две джазовые и одну с блюзом'), [
    { genre: 'jazz', count: 2 }, { genre: 'blues', count: 1 }
  ]);
});

test('requestedGenreSlots accepts only supported closed-vocabulary genre pairs', () => {
  for (const [first, second, expected] of [
    ['роком', 'соул', ['rock', 'soul']],
    ['поп', 'электронной музыкой', ['pop', 'electronic']],
    ['хаусом', 'техно', ['house', 'techno']],
    ['классическую', 'регги', ['classical', 'reggae']]
  ] as const) {
    assert.deepEqual(requestedGenreSlots(`один ${first}, один ${second}`)?.map((slot) => slot.genre), [...expected]);
  }
});

test('country constraints fall back for caller validation instead of being consumed', () => {
  assert.equal(requestedGenreSlots('Find one funk station and one ambient station from Japan'), undefined);
  assert.equal(requestedGenreSlots('одна станция с фанком и одна с эмбиентом в Южной Корее'), undefined);
});

test('partial, ambiguous, unsupported-count, and same-genre requests are refused', () => {
  for (const message of [
    'найди фанк',
    'найди фанк и эмбиент',
    'one funk station and one funk station',
    'one funk, one ambient, and one jazz',
    'три фанк-станции и три эмбиент-станции',
    'two funk stations and three ambient stations',
    'три станции: одну с фанком и одну с эмбиентом',
    'Give me one station: one funk and one ambient',
    'Подбери две станции: две с фанком и две с эмбиентом',
    'one blue station and one ambient station'
  ]) assert.equal(requestedGenreSlots(message), undefined, message);
});

test('dates, durations, ordinal, comparison, factual, and no-pick requests are refused', () => {
  for (const message of [
    'one funk song and one ambient song',
    'один фанк-трек и один эмбиент-трек',
    'one funk station for 20 minutes and one ambient station',
    'find one funk station from 1980 and one ambient station',
    'the first funk station and the second ambient station',
    'one funk is better than one ambient',
    'one funk and one ambient are available',
    'расскажи про фанк и эмбиент, не подбирай станции'
  ]) assert.equal(requestedGenreSlots(message), undefined, message);
});

test('negated genres and unconsumed modifiers are refused while no-play remains allowed', () => {
  assert.equal(requestedGenreSlots('одна станция с фанком и одна без эмбиента'), undefined);
  assert.equal(requestedGenreSlots('one funk station and one ambient station with piano only'), undefined);
  assert.equal(requestedGenreSlots('one funk station and one ambient station, no vocals'), undefined);
  assert.deepEqual(requestedGenreSlots('one funk and one ambient. Do not play.'), [
    { genre: 'funk', count: 1 }, { genre: 'ambient', count: 1 }
  ]);
  assert.deepEqual(requestedGenreSlots('одну с фанком и одну с эмбиентом. Не добавляй их в очередь.'), [
    { genre: 'funk', count: 1 }, { genre: 'ambient', count: 1 }
  ]);
  assert.deepEqual(requestedGenreSlots('one funk and one ambient. Do not add these stations to favorites.'), [
    { genre: 'funk', count: 1 }, { genre: 'ambient', count: 1 }
  ]);
});
