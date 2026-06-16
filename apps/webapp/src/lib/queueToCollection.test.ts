import { describe, expect, it } from 'vitest';
import { buildQueueCollection } from './queueToCollection';
import type { StationLite } from '../types';

const station = (id: string): StationLite =>
  ({ stationuuid: id, name: id, url_resolved: `https://example/${id}` } as StationLite);

const meta = { id: 'collection-test', now: 1_700_000_000_000 };

describe('buildQueueCollection', () => {
  it('snapshots the queue into a playlist record, preserving order', () => {
    const collection = buildQueueCollection('My Mix', ['a', 'b', 'c'].map(station), meta);
    expect(collection).not.toBeNull();
    expect(collection!.name).toBe('My Mix');
    expect(collection!.stationIds).toEqual(['a', 'b', 'c']);
    expect(collection!.id).toBe('collection-test');
    expect(collection!.createdAt).toBe(meta.now);
    expect(collection!.updatedAt).toBe(meta.now);
    expect(collection!.pinned).toBe(false);
    expect(collection!.isPublic).toBe(false);
  });

  it('dedupes by stationuuid, keeping first occurrence order', () => {
    const collection = buildQueueCollection(
      'Dupes',
      ['a', 'b', 'a', 'c', 'b'].map(station),
      meta
    );
    expect(collection!.stationIds).toEqual(['a', 'b', 'c']);
  });

  it('trims the name and caps it at 48 chars', () => {
    const long = 'x'.repeat(80);
    const collection = buildQueueCollection(`  ${long}  `, [station('a')], meta);
    expect(collection!.name).toBe('x'.repeat(48));
  });

  it('caps the playlist at 128 stations', () => {
    const many = Array.from({ length: 200 }, (_, i) => station(`s${i}`));
    const collection = buildQueueCollection('Big', many, meta);
    expect(collection!.stationIds).toHaveLength(128);
    expect(collection!.stationIds[0]).toBe('s0');
  });

  it('returns null for an empty name', () => {
    expect(buildQueueCollection('   ', [station('a')], meta)).toBeNull();
  });

  it('returns null for an empty queue', () => {
    expect(buildQueueCollection('My Mix', [], meta)).toBeNull();
  });
});
