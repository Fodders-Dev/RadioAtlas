import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deserializeLibrary,
  mergeLibraries,
  sanitizeLibrary,
  serializeLibrary
} from '../src/account/core/helpers.js';

/**
 * Saved means saved — the server's half, which 0.1b.0 shipped without.
 *
 * The lane removed the 200-find cap from three places on the client and one on
 * the server's merge, and a sweep reported it done. It was not: `sanitizeLibrary`
 * held a fourth, and it is the one that decided everything.
 *
 * Two reasons it survived a sweep and a review:
 *
 * 1. The `.slice(0, 200)` sits FOUR LINES below the word `trackHistory`, so a
 *    grep for the two on one line finds nothing. The other three caps were all
 *    on the same line as the field.
 * 2. Nothing in `apps/api/test` mentioned `trackHistory` at all. The whole cap
 *    removal had zero server coverage, so the suite could not disagree.
 *
 * And the consequence was worse than one missed cap. `sanitizeLibrary` is the
 * ingest of every PUT, the parse of every read, the serialiser of every write
 * AND the input to both arms of `mergeLibraries` — so the uncapped merge was
 * INERT. It could not see 300 finds because neither side ever arrived holding
 * more than 200.
 *
 * Hence the shape of the tests below: every one of them goes through the real
 * entry points. A merge test built from hand-written objects passes against the
 * broken build, which is exactly the false green that let this ship.
 */

type Find = { id: string; stationId: string; stationName: string; track: string; timestamp: number };

const find = (index: number): Find => ({
  id: `id-${index}`,
  stationId: `station-${index}`,
  stationName: `Station ${index}`,
  track: `Artist ${index} - Title ${index}`,
  timestamp: 1_756_000_000_000 + index * 60_000
});

const finds = (count: number, offset = 0) =>
  Array.from({ length: count }, (_, index) => find(index + offset));

test('the ingest of a PUT keeps every find, past the old 200', () => {
  const library = sanitizeLibrary({ trackHistory: finds(1000) });
  assert.equal(library.trackHistory.length, 1000);
});

test('the oldest find survives the ingest, because it is what a cap takes first', () => {
  // `uniqueTrackHistory` sorts newest-first, so `.slice(0, 200)` deleted from
  // the OLD end: the first thing the person ever saved was the first to go.
  const library = sanitizeLibrary({ trackHistory: finds(400) });
  assert.ok(library.trackHistory.some((item) => item.id === 'id-0'));
});

test('a stored library larger than the old cap reads back whole', () => {
  // ⚠ The read path, and the nastier half of the defect: with the cap in place
  // a library that somehow held 400 finds was truncated on the way OUT too, so
  // the loss did not need a new write to happen.
  const stored = serializeLibrary(sanitizeLibrary({ trackHistory: finds(400) }));
  assert.equal(deserializeLibrary(stored).trackHistory.length, 400);
});

test('two devices merge into the union — through the real parse, not hand-built objects', () => {
  // The owner's scenario: 150 finds on a phone, 150 on a tablet, no overlap.
  // ⚠ Both sides go through `deserializeLibrary` on purpose. Feeding
  // `mergeLibraries` two literals passes even with the cap present, which is
  // how a fix that changed nothing was reported as done.
  //
  // ⚠⚠ And this test STILL passes against the broken build — verified by
  // putting the cap back: 5 of the 7 here go red and this is one of the two
  // that do not, because 150 is under 200 and neither side is ever truncated.
  // The scenario everyone repeats is not the one that catches the defect. The
  // over-sized halves below are. Keep both: this one pins the union, that one
  // pins the ceiling.
  const phone = deserializeLibrary(serializeLibrary(sanitizeLibrary({ trackHistory: finds(150) })));
  const tablet = deserializeLibrary(
    serializeLibrary(sanitizeLibrary({ trackHistory: finds(150, 150) }))
  );
  const merged = mergeLibraries(phone, tablet, 'combine');
  assert.equal(merged.trackHistory.length, 300);
});

test('a merge of two over-sized halves keeps both halves', () => {
  const phone = deserializeLibrary(serializeLibrary(sanitizeLibrary({ trackHistory: finds(250) })));
  const tablet = deserializeLibrary(
    serializeLibrary(sanitizeLibrary({ trackHistory: finds(250, 250) }))
  );
  const merged = mergeLibraries(phone, tablet, 'combine');
  assert.equal(merged.trackHistory.length, 500);
  assert.ok(merged.trackHistory.some((item) => item.id === 'id-0'));
  assert.ok(merged.trackHistory.some((item) => item.id === 'id-499'));
});

test('overlapping histories dedupe to the union rather than to a cut', () => {
  const phone = deserializeLibrary(serializeLibrary(sanitizeLibrary({ trackHistory: finds(200) })));
  const tablet = deserializeLibrary(
    serializeLibrary(sanitizeLibrary({ trackHistory: finds(200, 100) }))
  );
  const merged = mergeLibraries(phone, tablet, 'combine');
  assert.equal(merged.trackHistory.length, 300);
  const keys = new Set(merged.trackHistory.map((item) => `${item.stationId}:${item.track}`));
  assert.equal(keys.size, 300);
});

test('the caps that deliberately stayed are still there', () => {
  // Not an endorsement — favourites break the same promise and are recorded as
  // their own defect. Pinned so that removing one is a decision somebody makes
  // on purpose, and so this file says which caps 0.1b.0 did NOT address.
  const library = sanitizeLibrary({
    favorites: Array.from({ length: 260 }, (_, index) => ({
      stationuuid: `fav-${index}`,
      name: `Favourite ${index}`,
      url_resolved: `https://example.com/${index}`
    })),
    trackHistory: finds(260)
  });
  assert.equal(library.favorites.length, 200);
  assert.equal(library.trackHistory.length, 260);
});
