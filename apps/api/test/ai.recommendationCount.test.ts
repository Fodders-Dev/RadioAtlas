import assert from 'node:assert/strict';
import test from 'node:test';
import { requestedStationCount } from '../src/ai/recommendationCount.js';

test('detects explicit station and recommendation quantities in Russian and English', () => {
  const cases: Array<[string, number]> = [
    ['Дай один необычный эфир. Не включай.', 1],
    ['Ещё два варианта', 2],
    ['Дай ещё одну.',1],
    ['Теперь ещё две. Не включай.',2],
    ['А теперь одну из Франции, с теми же жанрами. Не включай.',1],
    ['Посоветуй две станции', 2],
    ['Only one station, please', 1],
    ['Покажи 2 радио', 2],
    ['только одну', 1],
    ['Покажи только одну', 1],
    ['Дай один вариант', 1],
    ['Give me three recommendations', 3],
    ['Подбери пять хороших станций', 5]
  ];

  for (const [message, expected] of cases) {
    assert.equal(requestedStationCount(message), expected, message);
  }
});

test('caps explicit quantities at five', () => {
  for (const message of ['Дай 8 станций', 'Give me 12 stations']) {
    assert.equal(requestedStationCount(message), 5, message);
  }
});

test('does not infer a station count from durations, dates, ordinals, or a bare number', () => {
  for (const message of [
    'Включи радио на два часа',
    'Подбери эфир на 2 часа',
    'Посоветуй станцию к 3 мая',
    'Дай первую станцию',
    'Дай 1-ю станцию',
    'Подбери эфир на два часа',
    'один',
    'I have two hours'
  ]) {
    assert.equal(requestedStationCount(message), undefined, message);
  }
});

test('keeps elliptical station counts separate from track, song, and duration quantities', () => {
  const cases: Array<[string, number | undefined]> = [
    ['Дай два трека и одно радио', 1],
    ['только одну песню', undefined],
    ['Дай два трека', undefined],
    ['дай одну на три часа', 1],
    ['только два часа', undefined]
  ];

  for (const [message, expected] of cases) {
    assert.equal(requestedStationCount(message), expected, message);
  }
});

test('keeps counts within punctuation-delimited clauses and uses the latest correction', () => {
  assert.equal(requestedStationCount('Дай два трека. Подбери радио'), undefined);
  assert.equal(requestedStationCount('Дай 2 станции. Нет, три варианта'), 3);
});
