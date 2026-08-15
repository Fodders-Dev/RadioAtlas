import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * `POST /observability/client-event` builds a counter key from the caller's
 * `name`, so the allow-list has to stay closed — that part was right. It also
 * has to be complete, and it was not: the list held six infrastructure names
 * while the web app emitted a whole product, playback and session vocabulary
 * through the same endpoint.
 *
 * Observed against production on 2026-08-15, before the fix:
 *   app_opened              -> 400 {"error":"unknown event name"}
 *   session_state           -> 400 {"error":"unknown event name"}
 *   home_station_impression -> 400 {"error":"unknown event name"}
 *   play_attempt            -> 400 {"error":"unknown event name"}
 *   client_error            -> 200 {"ok":true}
 *
 * Every rejected event was also a console error in the listener's browser. The
 * old code carried a comment saying the list was "kept in sync with
 * reportClientEvent() call sites in the web app". It was not, and a comment
 * cannot be. This test is that promise, executed.
 */
process.env.OBSERVABILITY_STORE_PATH =
  process.env.OBSERVABILITY_STORE_PATH ||
  join(tmpdir(), `radioatlas-observability-clientevents-${process.pid}.json`);

const { allowedClientEvents } = await import('../src/observability.js');

const webappSrc = fileURLToPath(new URL('../../webapp/src/', import.meta.url));

const readAllSources = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...readAllSources(full));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      out.push(readFileSync(full, 'utf8'));
    }
  }
  return out;
};

/**
 * Two sources, because the web app has two ways of naming an event: literal
 * call sites, and the typed `ProductAnalyticsEventName` union that the product
 * wrapper forwards (those call sites pass the name on a continuation line, so
 * scanning call sites alone silently misses most of them).
 */
const emittedEventNames = (): Set<string> => {
  const names = new Set<string>();
  const sources = readAllSources(webappSrc);
  const callSite = /report(?:Client|Product|Session|Playback)Event\(\s*'([a-z0-9_]+)'/g;
  for (const source of sources) {
    for (const match of source.matchAll(callSite)) {
      if (match[1]) names.add(match[1]);
    }
  }
  const analytics = readFileSync(join(webappSrc, 'lib/productAnalytics.ts'), 'utf8');
  const union = /export type ProductAnalyticsEventName =([\s\S]*?);/.exec(analytics);
  assert.ok(union, 'ProductAnalyticsEventName must still be a named union in the web app');
  for (const match of (union?.[1] || '').matchAll(/'([a-z0-9_]+)'/g)) {
    if (match[1]) names.add(match[1]);
  }
  return names;
};

test('every event the web app emits is accepted by the API', () => {
  const emitted = emittedEventNames();
  assert.ok(emitted.size > 30, `expected the full vocabulary, found ${emitted.size}`);
  const allowed = new Set(allowedClientEvents());
  const rejected = Array.from(emitted)
    .filter((name) => !allowed.has(name))
    .sort();
  assert.deepEqual(
    rejected,
    [],
    `these names would be answered 400 and dropped: ${rejected.join(', ')}`
  );
});

test('the allow-list carries nothing the web app has stopped emitting', () => {
  // Not a correctness bug, but a stale name is a counter key nobody can explain
  // and an invitation for the list to drift back out of sync in the other
  // direction.
  const emitted = emittedEventNames();
  const stale = allowedClientEvents()
    .filter((name) => !emitted.has(name))
    .sort();
  assert.deepEqual(stale, [], `no longer emitted by the web app: ${stale.join(', ')}`);
});

test('the list stays closed', () => {
  // The reason it exists: the counter key is caller-supplied, and counters are
  // the one structure the age-based prune never touches.
  const allowed = allowedClientEvents();
  assert.equal(allowed.length, new Set(allowed).size, 'no duplicates');
  for (const name of allowed) {
    assert.match(name, /^[a-z][a-z0-9_]*$/, `unsafe counter key fragment: ${name}`);
  }
});
