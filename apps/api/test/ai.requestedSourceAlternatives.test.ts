import assert from 'node:assert/strict';
import test from 'node:test';
import { requestedSourceAlternatives } from '../src/ai/requestedSourceAlternatives.js';

test('resolves conservative Russian and English recommendations from the current station', () => {
  const examples: Array<[string, 1 | 2]> = [
    ['найди похожее', 2],
    ['похожее, но другое', 2],
    ['подбери две похожие станции', 2],
    ['одну похожую на эту станцию', 1],
    ['похожее на неё', 2],
    ['Похожее на эту станцию', 2],
    ['в том же духе', 2],
    ['similar to this', 2],
    ['similar to this station', 2],
    ['find similar to the current station', 2],
    ['find two similar stations', 2],
    ['like this but different', 2]
  ];
  for (const [message, count] of examples) assert.deepEqual(requestedSourceAlternatives(message), { kind: 'near', count, foreign: false }, message);
});

test('uses only direct counts one through three and reports another-country intent', () => {
  assert.deepEqual(requestedSourceAlternatives('найди одну похожую на эту станцию'), { kind: 'near', count: 1, foreign: false });
  assert.deepEqual(requestedSourceAlternatives('find three similar stations'), { kind: 'near', count: 3, foreign: false });
  assert.deepEqual(requestedSourceAlternatives('Подбери две похожие станции из другой страны'), { kind: 'near', count: 2, foreign: true });
  assert.deepEqual(requestedSourceAlternatives('find two similar stations from another country'), { kind: 'near', count: 2, foreign: true });
  assert.deepEqual(requestedSourceAlternatives('найди похожее из другой страны'), { kind: 'near', count: 2, foreign: true });
});

test('preserves explicit playback and queue/favorite preferences', () => {
  assert.deepEqual(requestedSourceAlternatives('Play one similar station'), { kind: 'near', count: 1, foreign: false });
  assert.deepEqual(requestedSourceAlternatives('Включи похожее'), { kind: 'near', count: 2, foreign: false });
  assert.deepEqual(requestedSourceAlternatives('Поставь похожее, не включай автоматически'), { kind: 'near', count: 2, foreign: false });
  assert.deepEqual(requestedSourceAlternatives('найди похожее, не добавляй в очередь и не сохраняй в избранное'), { kind: 'near', count: 2, foreign: false });
  assert.deepEqual(requestedSourceAlternatives("find similar to this, don't play yet, don't add to queue"), { kind: 'near', count: 2, foreign: false });
});

test('clarifies explicit current-relative recommendations with unsupported modifiers', () => {
  for (const message of [
    'подбери похожее, но контрастнее',
    'подбери контрастную к этой станции',
    'дай спокойнее чем эта станция',
    'find something similar to this, but calmer',
    'find similar stations for sleeping',
    'найди похожее без вокала'
  ]) assert.deepEqual(requestedSourceAlternatives(message), { kind: 'clarify' }, message);
});

test('factual, negated, comparison, track/song, and external-anchor requests are not source alternatives', () => {
  for (const message of [
    'почему эти похожие',
    'эти станции похожие',
    'мне кажется они похожие',
    'не ищи похожее',
    'что означает похожее',
    'compare these',
    'расскажи о станции',
    'найди похожие песни',
    'find tracks similar to this station',
    'подбери похожее на radiohead',
    'подбери похожее на Radiohead',
    'find similar to burial',
    'find similar to Burial',
    'find stations similar to the beatles',
    'find similar to The Cure',
    'find stations similar to "Jazz FM"',
    '"find similar stations"'
  ]) assert.equal(requestedSourceAlternatives(message), undefined, message);
});

test('does not swallow excess counts, dates, named text, or arbitrary modifiers', () => {
  for (const message of [
    'find two similar stations from 1980',
    'найди похожее на 30 минут',
    'find similar stations with vocals',
    'найди похожее на эту станцию в Токио'
  ]) assert.deepEqual(requestedSourceAlternatives(message), { kind: 'clarify' }, message);
  for (const message of [
    'find four similar stations',
    'найди 8 похожих станций',
    'найди две похожие станции и одну',
    'найди две похожие станции 7',
    'find two similar stations and one more similar'
  ]) assert.deepEqual(requestedSourceAlternatives(message), { kind: 'clarify' }, message);
});

test('repeated calls leave input and regular-expression state independent', () => {
  const message = 'find two similar stations';
  assert.equal(Object.isFrozen(message), true);
  const first = requestedSourceAlternatives(message);
  const second = requestedSourceAlternatives(message);
  assert.deepEqual(first, { kind: 'near', count: 2, foreign: false });
  assert.deepEqual(second, first);
});
