import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCatalogSummary, type CatalogStation } from '../src/catalog/service.js';

// T2.21: the Trending / Top-voted / Around-the-world discovery rails are built
// server-side from Radio Browser popularity signals in buildCatalogSummary.

const mk = (id: string, over: Partial<CatalogStation> = {}): CatalogStation => ({
  stationuuid: id,
  name: id,
  url: '',
  url_resolved: `http://stream/${id}`,
  homepage: '',
  favicon: '',
  tags: 'pop',
  country: 'Atlantis',
  countrycode: 'AT',
  state: '',
  language: 'en',
  codec: 'MP3',
  bitrate: 128,
  geo_lat: null,
  geo_long: null,
  ...over
});

const ONE_DAY = 86_400_000;

test('Trending rail ranks by clicktrend desc; Top-voted by votes desc', () => {
  const stations = [
    mk('a', { clicktrend: 5, votes: 900 }),
    mk('b', { clicktrend: 500, votes: 10 }),
    mk('c', { clicktrend: 50, votes: 90 }),
    mk('d', { clicktrend: 0, votes: 0 }) // no positive signal → excluded from both
  ];

  const summary = buildCatalogSummary(stations, 1);

  assert.deepEqual(
    summary.trending.map((station) => station.stationuuid),
    ['b', 'c', 'a'],
    'trending is clicktrend desc, excluding non-positive'
  );
  assert.deepEqual(
    summary.topVoted.map((station) => station.stationuuid),
    ['a', 'c', 'b'],
    'top-voted is votes desc, excluding non-positive'
  );
});

test('Trending / Top-voted hide gracefully when the signal is absent', () => {
  // Artifact predating the columns: no clicktrend/votes anywhere.
  const stations = Array.from({ length: 6 }, (_, i) => mk(`s${i}`));
  const summary = buildCatalogSummary(stations, 1);
  assert.equal(summary.trending.length, 0);
  assert.equal(summary.topVoted.length, 0);
});

const allMoodStationIds = (summary: ReturnType<typeof buildCatalogSummary>) =>
  summary.moodRails.flatMap((rail) => rail.stations.map((station) => station.stationuuid));

const moodRail = (summary: ReturnType<typeof buildCatalogSummary>, id: string) =>
  summary.moodRails.find((rail) => rail.id === id);

test('Mood rails bucket by word-aware tags and reject substring matches', () => {
  const stations = [
    ...Array.from({ length: 8 }, (_, i) => mk(`rock-${i}`, { tags: 'rock', votes: 50 })),
    ...Array.from({ length: 8 }, (_, i) => mk(`ambient-${i}`, { tags: 'ambient', votes: 50 })),
    // "electrock" contains "rock" as a substring but is a distinct tag → no mood.
    mk('electrock-trap', { tags: 'electrock', votes: 999 })
  ];

  const summary = buildCatalogSummary(stations, 1);

  assert.ok(moodRail(summary, 'mood-driving'), 'rock stations form the Driving rail');
  assert.ok(moodRail(summary, 'mood-late-night'), 'ambient stations form the Late night rail');
  assert.ok(
    !allMoodStationIds(summary).includes('electrock-trap'),
    'a station tagged "electrock" never lands in a rail via substring "rock"'
  );
});

test('Mood rails enforce the >=6 station floor', () => {
  const five = Array.from({ length: 5 }, (_, i) => mk(`house-${i}`, { tags: 'house' }));
  assert.equal(moodRail(buildCatalogSummary(five, 1), 'mood-workout'), undefined, 'hidden at 5');

  const six = Array.from({ length: 6 }, (_, i) => mk(`house-${i}`, { tags: 'house' }));
  assert.ok(moodRail(buildCatalogSummary(six, 1), 'mood-workout'), 'present at 6');
});

test('Cross-mood assignment is deterministic per seed and single-homed', () => {
  // A station tagged for two moods (Driving via "rock", Late night via "ambient").
  const stations = [
    ...Array.from({ length: 8 }, (_, i) => mk(`rock-${i}`, { tags: 'rock' })),
    ...Array.from({ length: 8 }, (_, i) => mk(`ambient-${i}`, { tags: 'ambient' })),
    mk('dual', { tags: 'rock,ambient' })
  ];

  const a = buildCatalogSummary(stations, 7);
  const b = buildCatalogSummary(stations, 7);

  const homesOf = (summary: ReturnType<typeof buildCatalogSummary>) =>
    summary.moodRails.filter((rail) => rail.stations.some((s) => s.stationuuid === 'dual')).map((r) => r.id);

  // Same seed → identical assignment; the dual-tagged station lives in exactly one rail.
  assert.deepEqual(homesOf(a), homesOf(b));
  assert.equal(homesOf(a).length, 1, 'a multi-mood station is single-homed (cross-mood de-dup)');
});

test('Around-the-world rotates daily and never repeats the country-spotlight', () => {
  // Three eligible countries (≥4 stations each) so that after excluding the
  // country-spotlight pick, ≥2 remain for the daily rotation to choose between.
  const stations = [
    ...Array.from({ length: 5 }, (_, i) => mk(`alpha-${i}`, { country: 'Alpha', votes: 100 })),
    ...Array.from({ length: 5 }, (_, i) => mk(`bravo-${i}`, { country: 'Bravo', votes: 100 })),
    ...Array.from({ length: 5 }, (_, i) => mk(`charlie-${i}`, { country: 'Charlie', votes: 100 }))
  ];

  const day0 = 19_500 * ONE_DAY; // fixed reference day
  const a = buildCatalogSummary(stations, 1, day0);
  const b = buildCatalogSummary(stations, 1, day0);

  assert.ok(a.aroundTheWorld, 'around-the-world spotlight is present');
  // Same day → deterministic, identical pick.
  assert.equal(a.aroundTheWorld?.label, b.aroundTheWorld?.label);
  // Never the same country as the country-spotlight.
  assert.notEqual(a.aroundTheWorld?.label, a.countrySpotlight?.label);

  // A different day flips the rotation across the remaining countries.
  const labels = new Set<string>();
  for (let offset = 0; offset < 6; offset += 1) {
    const summary = buildCatalogSummary(stations, 1, day0 + offset * ONE_DAY);
    if (summary.aroundTheWorld) labels.add(summary.aroundTheWorld.label);
  }
  assert.ok(labels.size >= 2, 'rotates through more than one country across days');
});
