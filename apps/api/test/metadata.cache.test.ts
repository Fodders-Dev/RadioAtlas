import assert from 'node:assert/strict';
import test from 'node:test';

import { writeMetadataCacheEntry } from '../src/media/metadataService.js';
import type { MetadataLookupResult } from '../src/media/types.js';

type Entry = { ts: number; result: MetadataLookupResult };
const entry = (ts: number, title: string | null): Entry => ({
  ts,
  result: { title, logs: [] }
});

const TTL = 15_000;

test('LRU: inserting past max evicts the OLDEST, keeps the newest', () => {
  const cache = new Map<string, Entry>();
  writeMetadataCacheEntry(cache, 'a', entry(0, 'A'), TTL, 2);
  writeMetadataCacheEntry(cache, 'b', entry(1, 'B'), TTL, 2);
  writeMetadataCacheEntry(cache, 'c', entry(2, 'C'), TTL, 2); // over max → 'a' evicted

  assert.equal(cache.size, 2);
  assert.equal(cache.has('a'), false);
  assert.equal(cache.has('b'), true);
  assert.equal(cache.has('c'), true);
  assert.equal(cache.get('c')?.result.title, 'C'); // newest still present + correct
});

test('TTL: expired entries are swept out on insert', () => {
  const cache = new Map<string, Entry>();
  writeMetadataCacheEntry(cache, 'old', entry(0, 'X'), TTL, 5000);
  // A later insert whose clock is past the TTL sweeps the stale 'old' entry.
  writeMetadataCacheEntry(cache, 'new', entry(TTL + 1, 'Y'), TTL, 5000);

  assert.equal(cache.has('old'), false);
  assert.equal(cache.has('new'), true);
});

test('a still-fresh entry (within TTL) survives an insert and stays readable', () => {
  const cache = new Map<string, Entry>();
  writeMetadataCacheEntry(cache, 'fresh', entry(0, 'Z'), TTL, 5000);
  writeMetadataCacheEntry(cache, 'other', entry(TTL - 1, 'W'), TTL, 5000); // still within TTL

  assert.equal(cache.has('fresh'), true);
  assert.equal(cache.get('fresh')?.result.title, 'Z');
  assert.equal(cache.size, 2);
});

test('negative (title:null) entries count toward the cap and evict like any other', () => {
  const cache = new Map<string, Entry>();
  writeMetadataCacheEntry(cache, 'n1', entry(0, null), TTL, 2);
  writeMetadataCacheEntry(cache, 'n2', entry(1, null), TTL, 2);
  writeMetadataCacheEntry(cache, 'n3', entry(2, null), TTL, 2); // over max

  assert.equal(cache.size, 2);
  assert.equal(cache.has('n1'), false); // oldest negative evicted
  assert.equal(cache.has('n3'), true);
});

test('re-setting an existing url refreshes in place (not a new slot) and keeps its age order', () => {
  const cache = new Map<string, Entry>();
  writeMetadataCacheEntry(cache, 'a', entry(0, 'A'), TTL, 2);
  writeMetadataCacheEntry(cache, 'b', entry(1, 'B'), TTL, 2);
  // Refresh 'a' (e.g. the radiovanya overwrite path) — must NOT grow the cache
  // nor evict 'b'; insertion order is preserved (a stays oldest).
  writeMetadataCacheEntry(cache, 'a', entry(2, 'A2'), TTL, 2);

  assert.equal(cache.size, 2);
  assert.equal(cache.get('a')?.result.title, 'A2');
  assert.equal(cache.has('b'), true);

  // A third distinct url now evicts the oldest ('a'), confirming order held.
  writeMetadataCacheEntry(cache, 'c', entry(3, 'C'), TTL, 2);
  assert.equal(cache.has('a'), false);
  assert.equal(cache.has('b'), true);
  assert.equal(cache.has('c'), true);
});
