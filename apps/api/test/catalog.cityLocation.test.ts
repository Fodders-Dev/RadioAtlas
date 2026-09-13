import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCityLocation } from '../src/catalog/cityLocation.js';
import { buildPointsResponse, type CatalogStation } from '../src/catalog/service.js';

test('city lookup is country-scoped, bilingual and rejects regions and ambiguity', () => {
  for (const state of ['Москва', 'Moscow', 'г. Москва', 'Moscow (Russia)', 'The Russian Federation,Moscow']) {
    assert.equal(resolveCityLocation({ countrycode: 'RU', state })?.geonameId, 524901);
  }
  assert.equal(resolveCityLocation({ country: 'The Russian Federation', state: 'Saint-Petersburg' })?.geonameId, 498817);
  assert.equal(resolveCityLocation({ countrycode: 'RU', state: 'Chelyabinsk' })?.geonameId, 1508291);
  for (const state of ['', 'Московская область', 'Perm region', 'Russia', 'Web', 'Киров', 'Radio Moscow', 'Moscow (Idaho)', 'Moscow, US', 'Volga']) {
    assert.equal(resolveCityLocation({ countrycode: 'RU', state }), null, state);
  }
  assert.equal(resolveCityLocation({ countrycode: 'US', state: 'Moscow' }), null);
});

test('points expose city precision separately and preserve explicit coordinates and missing locations', () => {
  const station = (id: string, extra: Partial<CatalogStation> = {}): CatalogStation => ({
    stationuuid: id, name: 'Moscow Radio', country: 'Russia', countrycode: 'RU', state: 'Moscow',
    geo_lat: null, geo_long: null, tags: 'jazz', url: '', url_resolved: '', homepage: '', favicon: '',
    language: '', codec: '', bitrate: 0, ...extra
  });
  const input = [station('city'), station('exact', { geo_lat: 55.8, geo_long: 37.6 }), station('unknown', { state: '' })];
  const before = structuredClone(input);
  const response = buildPointsResponse(input);
  assert.equal(response.mappedStations, 1);
  assert.equal(response.totalStations, 3);
  const [city, exact, unknown] = response.items;
  assert.equal(city?.lat, undefined);
  assert.equal(city?.cityLocation?.geonameId, 524901);
  assert.equal(exact?.cityLocation, undefined);
  assert.equal(exact?.lat, 55.8);
  assert.equal(unknown?.cityLocation, undefined);
  assert.equal(unknown?.lat, undefined);
  assert.deepEqual(input, before);
});
