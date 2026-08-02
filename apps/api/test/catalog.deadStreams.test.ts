import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCatalogSummary, type CatalogStation } from '../src/catalog/service.js';
import { DEAD_STREAMS, DEAD_STREAM_IDS } from '../src/catalog/deadStreams.js';

// Probed from the production VPS 2026-08-02: five stations on our own shop
// window answered `lastcheckok = 1` while being stone dead, on an upstream check
// dated 2026-01-15. We decline to recommend them; the catalogue keeps them.

const DEAD_ID = DEAD_STREAMS[0]![0];

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

const everyStationOnTheShelves = (summary: ReturnType<typeof buildCatalogSummary>) => {
  const ids: string[] = [];
  const walk = (node: unknown): void => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node !== 'object') return;
    const row = node as { stationuuid?: unknown };
    if (typeof row.stationuuid === 'string') {
      ids.push(row.stationuuid);
      return;
    }
    Object.values(node as Record<string, unknown>).forEach(walk);
  };
  for (const [key, value] of Object.entries(summary)) {
    if (key === 'counts' || key === 'generatedAt') continue;
    walk(value);
  }
  return ids;
};

test('a verified-dead station is never recommended on any shelf', () => {
  // Give the dead one the strongest possible signals: without the filter it
  // would lead both Trending and Top voted.
  const stations = [
    mk(DEAD_ID, { votes: 100_000, clicktrend: 100_000 }),
    ...Array.from({ length: 40 }, (_, i) =>
      mk(`live-${i}`, { votes: 100 - i, clicktrend: 100 - i, country: `C${i}`, countrycode: `C${i}` })
    )
  ];

  const summary = buildCatalogSummary(stations, 1);
  const shown = everyStationOnTheShelves(summary);

  assert.ok(shown.length > 0, 'the shelves must not be empty, or this proves nothing');
  assert.ok(!shown.includes(DEAD_ID), 'a station we proved dead reached a shelf');
  for (const id of DEAD_STREAM_IDS) {
    assert.ok(!shown.includes(id), `${id} reached a shelf`);
  }
});

test('the catalogue still counts what it contains', () => {
  // We decline to RECOMMEND five stations; we do not pretend they are gone.
  // «Станций: N» is a claim about the catalogue.
  const stations = [
    mk(DEAD_ID, { votes: 10 }),
    ...Array.from({ length: 9 }, (_, i) => mk(`live-${i}`, { votes: 9 - i }))
  ];
  const summary = buildCatalogSummary(stations, 1);
  assert.equal(summary.counts.stations, 10, 'counts describe the catalogue, not the promotable subset');
});

test('nothing is filtered when the list is empty for a catalogue', () => {
  // A catalogue that happens to contain none of the dead ids must come through
  // completely untouched — the filter is not allowed to be lossy by accident.
  const stations = Array.from({ length: 30 }, (_, i) =>
    mk(`fresh-${i}`, { votes: 30 - i, country: `C${i}`, countrycode: `C${i}` })
  );
  const summary = buildCatalogSummary(stations, 3);
  assert.equal(summary.counts.stations, 30);
  assert.equal(summary.topVoted.length, 12);
});
