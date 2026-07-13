import assert from 'node:assert/strict';
import test from 'node:test';
import { attachSearchIndex, buildSearchResponse, type CatalogStation } from '../src/catalog/service.js';

type Filters = Parameters<typeof buildSearchResponse>[1];

const station = (over: Partial<CatalogStation>): CatalogStation => ({
  stationuuid: 'id',
  name: '',
  url: '',
  url_resolved: '',
  homepage: '',
  favicon: '',
  tags: '',
  country: '',
  countrycode: '',
  state: '',
  language: '',
  codec: '',
  bitrate: 0,
  geo_lat: null,
  geo_long: null,
  ...over
});

const f = (over: Partial<Filters> = {}): Filters => ({
  q: '',
  country: '',
  language: '',
  tag: '',
  continent: '',
  limit: 100,
  cursor: 0,
  seed: 12345,
  ...over
});

// A deliberately varied fixture: multiple continents (via geo), normalized vs
// raw country strings (parens/whitespace), comma/space/mixed-case tags, empty
// fields, and q-matchable text spread across name/tags/state/language.
const fixture: CatalogStation[] = [
  station({ stationuuid: 'a', name: 'Jazz Paris', tags: 'Jazz, Smooth', country: 'France', state: 'Île-de-France', language: 'french', geo_lat: 48.85, geo_long: 2.35 }),
  station({ stationuuid: 'b', name: 'Berlin Beats', tags: 'electronic,techno', country: 'Germany', language: 'german', geo_lat: 52.52, geo_long: 13.4 }),
  station({ stationuuid: 'c', name: 'NYC Talk', tags: 'talk, news', country: 'United States (USA)', state: 'New York', language: 'english', geo_lat: 40.7, geo_long: -74.0 }),
  station({ stationuuid: 'd', name: 'LA Vibes', tags: 'pop,  Hip Hop ', country: 'United States', state: 'California', language: 'english', geo_lat: 34.05, geo_long: -118.24 }),
  station({ stationuuid: 'e', name: 'Tokyo FM', tags: 'jpop,city pop', country: 'Japan', language: 'japanese', geo_lat: 35.68, geo_long: 139.69 }),
  station({ stationuuid: 'f', name: 'Rio Samba', tags: 'samba,latin', country: 'Brazil', language: 'portuguese', geo_lat: -22.9, geo_long: -43.2 }),
  station({ stationuuid: 'g', name: 'Cape Jazz', tags: 'Jazz', country: 'South Africa', language: 'english', geo_lat: -33.92, geo_long: 18.42 }),
  station({ stationuuid: 'h', name: 'Sydney Surf', tags: 'rock,surf', country: 'Australia', language: 'english', geo_lat: -33.87, geo_long: 151.2 }),
  station({ stationuuid: 'i', name: 'No Geo Jazz', tags: 'jazz,lounge', country: 'France', language: 'french' }),
  station({ stationuuid: 'j', name: 'Empty Tags Talk', tags: '', country: 'Germany', language: 'german', geo_lat: 50.1, geo_long: 8.68 }),
  station({ stationuuid: 'k', name: 'Madrid Mix', tags: 'pop', country: 'Spain', language: 'spanish', geo_lat: 40.4, geo_long: -3.7 }),
  station({ stationuuid: 'l', name: 'Lyon Jazz Club', tags: 'jazz,club', country: 'France', state: 'Auvergne-Rhône-Alpes', language: 'french', geo_lat: 45.76, geo_long: 4.84 }),
  station({ stationuuid: 'm', name: 'Mumbai Beats', tags: 'bollywood,pop', country: 'India', language: 'hindi', geo_lat: 19.07, geo_long: 72.87 }),
  station({ stationuuid: 'n', name: 'Toronto Talk', tags: 'talk,news', country: 'Canada', state: 'Ontario', language: 'english', geo_lat: 43.65, geo_long: -79.38 })
];

const cases: Array<{ name: string; filters: Filters }> = [
  { name: 'no-q browse (all)', filters: f() },
  { name: 'q matches name', filters: f({ q: 'jazz' }) },
  { name: 'q matches tag/state/language', filters: f({ q: 'news' }) },
  { name: 'q no match', filters: f({ q: 'zzzznope' }) },
  { name: 'country filter (normalized parens)', filters: f({ country: 'United States' }) },
  { name: 'language filter', filters: f({ language: 'english' }) },
  { name: 'tag filter (substring)', filters: f({ tag: 'jazz' }) },
  { name: 'continent filter Europe', filters: f({ continent: 'Europe' }) },
  { name: 'continent filter Other (no geo)', filters: f({ continent: 'Other' }) },
  { name: 'combined q + language', filters: f({ q: 'jazz', language: 'french' }) },
  { name: 'pagination page 1', filters: f({ limit: 5, cursor: 0 }) },
  { name: 'pagination page 2', filters: f({ limit: 5, cursor: 5 }) },
  { name: 'pagination past end', filters: f({ limit: 5, cursor: 100 }) }
];

test('search precompute is equivalent to live compute across all filter modes', () => {
  const indexed = attachSearchIndex(fixture);
  for (const { name, filters } of cases) {
    const live = buildSearchResponse(fixture, filters);
    const precomputed = buildSearchResponse(indexed, filters);
    assert.deepEqual(
      precomputed,
      live,
      `precomputed search must equal live search for case: ${name}`
    );
  }
});

test('attachSearchIndex does not leak internal fields through toStationLite items', () => {
  const indexed = attachSearchIndex(fixture);
  const response = buildSearchResponse(indexed, f({ q: 'jazz' }));
  assert.ok(response.items.length > 0, 'expected matches');
  for (const item of response.items) {
    const keys = Object.keys(item);
    for (const leaked of ['searchHaystack', 'searchTags', 'searchTagText', 'searchCountry', 'searchLanguage', 'searchContinent']) {
      assert.ok(!keys.includes(leaked), `wire item must not include internal field "${leaked}"`);
    }
  }
});

test('precompute fields are present on the indexed catalog (server-internal)', () => {
  const indexed = attachSearchIndex(fixture);
  const first = indexed[0]!;
  assert.equal(typeof first.searchHaystack, 'string');
  assert.equal(first.searchHaystack, 'jazz paris jazz, smooth france île-de-france french');
  assert.deepEqual(first.searchTags, ['jazz', 'smooth']);
  assert.equal(first.searchContinent, 'Europe');
  // The raw fixture is untouched (attachSearchIndex returns new objects).
  assert.equal(fixture[0]!.searchHaystack, undefined);
});

test('country facets collapse case variants and country filtering stays case-insensitive', () => {
  const indexed = attachSearchIndex([
    station({ stationuuid: 'spain-title', name: 'Madrid One', country: 'Spain' }),
    station({ stationuuid: 'spain-lower', name: 'Madrid Two', country: 'spain' }),
    station({ stationuuid: 'france', name: 'Paris One', country: 'France' })
  ]);

  const browse = buildSearchResponse(indexed, f());
  const spainFacets = browse.facets.featuredCountries.filter(
    (bucket) => bucket.country.toLocaleLowerCase() === 'spain'
  );
  assert.equal(spainFacets.length, 1);
  assert.equal(spainFacets[0]?.country, 'Spain');
  assert.equal(spainFacets[0]?.count, 2);

  const filtered = buildSearchResponse(indexed, f({ country: 'SPAIN' }));
  assert.deepEqual(
    filtered.items.map((item) => item.stationuuid).sort(),
    ['spain-lower', 'spain-title']
  );
});
