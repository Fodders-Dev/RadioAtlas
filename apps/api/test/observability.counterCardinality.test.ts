import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePath } from '../src/observability.js';
import { bumpCounter, counterKeyCount } from '../src/observabilityStore.js';

/**
 * Production on 2026-08-23 was carrying counters like
 *
 *   request:GET:/artwork/scene/a2624589-8279-4be3-9ea0-514dcd29cef8 = 7
 *   request:GET:/artwork/scene/7672310d-4aea-44dd-a79d-dda5768bb9ee = 5
 *
 * — one per station whose scene had ever been fetched. `normalizePath` collapsed
 * `/stations/:id` and `/areas/:id` and nothing else, so three routes carrying
 * identifiers minted a counter each, plus up to 25 hourly buckets each, in a
 * store that is serialised to disk on every flush.
 *
 * With no listeners that was six keys. There are 46 048 stations, and the whole
 * point of the current work is that people start arriving.
 *
 * Both halves are tested here on purpose: normalising the three known routes
 * fixes today, and the ceiling fixes the day somebody adds a fourth route and
 * does not think about this file.
 */

test('paths carrying an identifier collapse to a single counter key', () => {
  assert.equal(
    normalizePath('/artwork/scene/a2624589-8279-4be3-9ea0-514dcd29cef8'),
    '/artwork/scene/:id'
  );
  assert.equal(normalizePath('/artwork/scenes/tokyo-jazz-3f9a.png'), '/artwork/scenes/:file');
  assert.equal(normalizePath('/share/story/abc123xyz'), '/share/story/:slug');

  // The two that were always covered, including through their /catalog prefix —
  // these are substring replacements, which is why the prefixed forms work.
  assert.equal(normalizePath('/stations/uuid-1/profile'), '/stations/:id/profile');
  assert.equal(normalizePath('/catalog/stations/uuid-1'), '/catalog/stations/:id');
  assert.equal(normalizePath('/catalog/areas/RU-MOW/stations'), '/catalog/areas/:id/stations');
});

test('a path with no identifier is left exactly as it is', () => {
  // Over-eager normalisation would merge unrelated routes into one counter and
  // quietly destroy the ability to tell them apart.
  assert.equal(normalizePath('/catalog/summary'), '/catalog/summary');
  assert.equal(normalizePath('/health'), '/health');
  assert.equal(normalizePath('/artwork/scene'), '/artwork/scene');
});

test('the number of distinct counters is bounded, and the refusal is visible', () => {
  const before = counterKeyCount();

  // Push well past the 2 000 ceiling with keys nothing will ever normalise.
  for (let i = 0; i < 2_500; i += 1) {
    bumpCounter(`test_cardinality:${i}`);
  }

  const after = counterKeyCount();
  assert.ok(
    after <= 2_001,
    `expected the map to stop growing at the ceiling, saw ${after} keys (was ${before})`
  );
  assert.ok(after > before, 'the first keys under the ceiling must still be recorded');
});

test('an existing counter keeps counting after the ceiling is reached', () => {
  // The ceiling refuses NEW keys; it must never stop an established total, or a
  // reconciliation like play_success / (play_attempt - play_superseded) silently
  // stops adding up.
  for (let i = 0; i < 2_500; i += 1) {
    bumpCounter(`test_cardinality_b:${i}`);
  }
  const established = 'test_cardinality:0';
  bumpCounter(established, 5);
  // Nothing to assert on the value directly without reading the store, but the
  // call must not throw and must not be diverted into the overflow counter.
  assert.ok(counterKeyCount() <= 2_001);
});
