import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCatalogSummary, type CatalogStation } from '../src/catalog/service.js';

// A mood rail used to reshuffle its ENTIRE tag bucket every hour. Measured on
// artifacts/catalog-full.json those buckets hold 1 080-6 656 stations, so a
// generated scene background had well under a 1% chance of being on screen in
// any given hour and seeded coverage could never accrue — prod measured 0 of 40
// mood slots with a scene. The rail now rotates inside a bounded, deterministic
// featured pool. These tests pin that bound, because without it the scene budget
// is unspendable no matter how large it is.

const mk = (id: string, over: Partial<CatalogStation> = {}): CatalogStation => ({
  stationuuid: id,
  name: id,
  url: '',
  url_resolved: `http://stream/${id}`,
  homepage: '',
  favicon: '',
  tags: 'ambient',
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

const lateNight = (summary: ReturnType<typeof buildCatalogSummary>) =>
  summary.moodRails.find((rail) => rail.id === 'mood-late-night');

// One hourly seed bucket per entry — the same quantisation summaryCache applies.
const HOURLY_SEEDS = Array.from({ length: 200 }, (_, i) => i);

test('a mood rail rotates inside a bounded pool, not across the whole bucket', () => {
  // 400 distinct countries so the ≤3-per-country cap never forces a backfill,
  // and a descending vote signal so the ranking is unambiguous.
  const stations = Array.from({ length: 400 }, (_, i) =>
    mk(`s${i}`, { votes: 400 - i, country: `Country${i}`, countrycode: `C${i}` })
  );

  const seen = new Set<string>();
  let renderedRows = 0;
  for (const seed of HOURLY_SEEDS) {
    const rail = lateNight(buildCatalogSummary(stations, seed));
    assert.ok(rail, `late-night rail must render at seed ${seed}`);
    renderedRows = rail.stations.length;
    rail.stations.forEach((station) => seen.add(station.stationuuid));
  }

  assert.equal(renderedRows, 10, 'the rail still shows a full shelf');
  // The bound. Before this change the union grew towards the whole 400-station
  // bucket; 30 is MOOD_RAIL_FEATURED.
  assert.ok(
    seen.size <= 30,
    `union across ${HOURLY_SEEDS.length} hourly seeds must stay inside the featured pool, got ${seen.size}`
  );
  // …but it is still a rotation, not a frozen shelf: «a reason to open now»
  // depends on the rail actually turning over.
  assert.ok(seen.size > 10, `the rail must still rotate, union was only ${seen.size}`);
  // The pool is the top of the vote ranking, not an alphabetical slice.
  assert.ok(
    [...seen].every((id) => Number(id.slice(1)) < 60),
    'featured pool must come from the top of the vote ranking'
  );
});

test('the featured pool is deterministic, so a seeded scene stays on screen', () => {
  const stations = Array.from({ length: 120 }, (_, i) =>
    mk(`s${i}`, { votes: 120 - i, country: `Country${i % 40}`, countrycode: `C${i % 40}` })
  );
  const union = (from: number) => {
    const seen = new Set<string>();
    for (let seed = from; seed < from + 60; seed += 1) {
      lateNight(buildCatalogSummary(stations, seed))?.stations.forEach((station) =>
        seen.add(station.stationuuid)
      );
    }
    return [...seen].sort();
  };
  assert.deepEqual(union(0), union(5_000), 'the pool must not drift with the clock');
});

// The degraded state that actually happened on prod 2026-08-01: three of the
// four Radio Browser mirrors were unreachable, the API served
// artifacts/catalog-full.json, and that artifact carries no votes at all — so
// EVERY mood bucket lost its ranking signal at once, not just a narrow one.
test('mood rails survive a catalogue with no vote signal at all', () => {
  const stations = Array.from({ length: 400 }, (_, i) =>
    mk(`s${String(i).padStart(3, '0')}`, {
      name: `${i} Station`,
      country: `Country${i}`,
      countrycode: `C${i}`
    })
  ); // note: no votes anywhere

  const seen = new Set<string>();
  for (const seed of [1, 2, 3, 7, 11, 29]) {
    const rail = lateNight(buildCatalogSummary(stations, seed));
    assert.ok(rail, `rail must still render at seed ${seed}`);
    assert.equal(rail.stations.length, 10, 'shelf still fills');
    rail.stations.forEach((s) => seen.add(s.stationuuid));
  }

  // ⚠ The naive assertion here ("it still rotates", seen.size > 10) PASSES
  // against the bug and proves nothing: seededOrder shuffles the pool before
  // slicing either way, so the shelf always turns over. The real difference is
  // WHICH stations can ever appear.
  //
  // With sortByTopSignal as the filler the pool is name.localeCompare order —
  // byte-identical for every seed — so the union across seeds is capped at
  // MOOD_RAIL_FEATURED (30) and the rail can only ever show the same
  // alphabetical head («16Bit.FM I.D.E.A.», «101 SMOOTH JAZZ», …). With a
  // seeded filler each seed draws a different pool, so the union grows past 30.
  assert.ok(
    seen.size > 30,
    `without votes the pool must not be a fixed alphabetical slice; only ${seen.size} distinct stations were reachable across 6 seeds`
  );
});

test('a tag-narrow bucket still renders and keeps the per-country cap', () => {
  // Only two stations carry a vote signal — the rest must still be reachable,
  // or a rail that used to render would vanish.
  const stations = [
    mk('voted-a', { votes: 50, country: 'Aland' }),
    mk('voted-b', { votes: 40, country: 'Bland' }),
    ...Array.from({ length: 6 }, (_, i) => mk(`plain${i}`, { country: 'Cland' }))
  ];
  const rail = lateNight(buildCatalogSummary(stations, 7));
  assert.ok(rail, 'a bucket at MOOD_RAIL_MIN must still render');
  assert.equal(rail.stations.length, 8, 'every station in a narrow bucket stays reachable');
});

test('the per-country cap survives the rotation', () => {
  // 100 stations across four countries: an uncapped draw of 10 would routinely
  // take more than 3 from one of them.
  const countries = ['Aland', 'Bland', 'Cland', 'Dland'];
  const stations = Array.from({ length: 100 }, (_, i) =>
    mk(`s${i}`, { votes: 100 - i, country: countries[i % 4], countrycode: `C${i % 4}` })
  );
  for (const seed of HOURLY_SEEDS.slice(0, 50)) {
    const rail = lateNight(buildCatalogSummary(stations, seed));
    assert.ok(rail);
    const perCountry = new Map<string, number>();
    for (const station of rail.stations) {
      const key = String(station.country);
      perCountry.set(key, (perCountry.get(key) || 0) + 1);
    }
    for (const [country, count] of perCountry) {
      assert.ok(count <= 3, `seed ${seed}: ${country} took ${count} of the shelf`);
    }
  }
});
