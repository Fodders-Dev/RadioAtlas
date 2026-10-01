import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesRequestedCountry, requestedCountry } from '../src/ai/requestedCountry.js';

test('requestedCountry resolves explicit Russian and English station locations', () => {
  assert.equal(requestedCountry('Найди станции из Японии'), 'Japan');
  assert.equal(requestedCountry('радио в Японии'), 'Japan');
  assert.equal(requestedCountry('станции по Германии'), 'Germany');
  assert.equal(requestedCountry('Stations in the Netherlands'), 'Netherlands');
  assert.equal(requestedCountry('Find stations FROM japan!'), 'Japan');
  assert.equal(requestedCountry('radio in the United States'), 'United States');
  assert.equal(requestedCountry('станции из Великобритании'), 'United Kingdom');
  assert.equal(requestedCountry('радио из США'), 'United States');
  assert.equal(requestedCountry('Станции из Канады'), 'Canada');
  assert.equal(requestedCountry('Станции из Италии'), 'Italy');
  assert.equal(requestedCountry('Станции из Швеции'), 'Sweden');
  assert.equal(requestedCountry('Станции из Китая'), 'China');
  assert.equal(requestedCountry('Станции из Мексики'), 'Mexico');
  assert.equal(requestedCountry('Станции из Дании'), 'Denmark');
  assert.equal(requestedCountry('Станции из Таиланда'), 'Thailand');
  assert.equal(requestedCountry('Станции в Южной Корее'), 'South Korea');
  assert.equal(requestedCountry('Stations from Czech Republic'), 'Czechia');
  assert.equal(requestedCountry('Stations in the United Kingdom of Great Britain and Northern Ireland'), 'United Kingdom');
});

test('music language and names alone do not imply a country', () => {
  assert.equal(requestedCountry('японский джаз'), undefined);
  assert.equal(requestedCountry('русский рок'), undefined);
  assert.equal(requestedCountry('французский шансон'), undefined);
  assert.equal(requestedCountry('в стиле Japan'), undefined);
  assert.equal(requestedCountry('Japan FM'), undefined);
  assert.equal(requestedCountry('from another country'), undefined);
  assert.equal(requestedCountry('из другой страны'), undefined);
});

test('negation and ambiguous country lists do not create a scope', () => {
  assert.equal(requestedCountry('не из Японии'), undefined);
  assert.equal(requestedCountry('кроме Японии'), undefined);
  assert.equal(requestedCountry('Find radio not in the United States'), undefined);
  assert.equal(requestedCountry('без станций из Японии'), undefined);
  assert.equal(requestedCountry('from Japan and France'), undefined);
  assert.equal(requestedCountry('станции из Японии и Франции'), undefined);
  assert.equal(requestedCountry('from Japan, from France'), undefined);
  assert.equal(requestedCountry('in Japan or in France'), undefined);
  assert.equal(requestedCountry('не из Японии, а из Франции'), 'France');
  assert.equal(requestedCountry('не from Japan, from France'), 'France');
});

test('the latest corrected explicit country wins and aliases compare canonically', () => {
  assert.equal(requestedCountry('Сначала станции из Японии. А теперь из Франции'), 'France');
  assert.equal(requestedCountry('Stations from Japan, previous request. Stations from France'), 'France');
  assert.equal(requestedCountry('from Japan; actually, stations in France'), 'France');
  assert.equal(matchesRequestedCountry('United States of America', 'USA'), true);
  assert.equal(matchesRequestedCountry('The Netherlands', 'Netherlands'), true);
  assert.equal(matchesRequestedCountry('Russian Federation', 'Russia'), true);
  assert.equal(matchesRequestedCountry('United Kingdom of Great Britain and Northern Ireland', 'United Kingdom'), true);
  assert.equal(matchesRequestedCountry('France', 'Japan'), false);
  assert.equal(matchesRequestedCountry('', 'Japan'), false);
});
