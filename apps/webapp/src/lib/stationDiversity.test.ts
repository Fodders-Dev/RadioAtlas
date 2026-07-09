import { describe, expect, it } from 'vitest';
import { diversifyStationOrder, stationNameDiversityKey } from './stationDiversity';

const station = (id: string, country: string, tags: string, name = id) => ({
  stationuuid: id,
  name,
  country,
  tags
});

describe('diversifyStationOrder', () => {
  it('preserves the lead while spacing out country and primary-tag repeats', () => {
    const out = diversifyStationOrder(
      [
        station('lead', 'US', 'jazz'),
        station('same-1', 'US', 'jazz'),
        station('same-2', 'US', 'jazz'),
        station('uk-rock', 'UK', 'rock'),
        station('de-soul', 'Germany', 'soul')
      ],
      { limit: 4, preserveFirst: true, maxPerCountry: 1, maxPerPrimaryTag: 1 }
    );

    expect(out.map((item) => item.stationuuid)).toEqual(['lead', 'uk-rock', 'de-soul', 'same-1']);
  });

  it('backfills from overflow when diversity caps would make the list too short', () => {
    const out = diversifyStationOrder(
      [
        station('j1', 'US', 'jazz'),
        station('j2', 'US', 'jazz'),
        station('j3', 'US', 'jazz')
      ],
      { limit: 3, maxPerCountry: 1, maxPerPrimaryTag: 1 }
    );

    expect(out.map((item) => item.stationuuid)).toEqual(['j1', 'j2', 'j3']);
  });

  it('normalizes obvious stream-quality suffixes in names', () => {
    expect(stationNameDiversityKey('Classic Vinyl HD Opus')).toBe('classic vinyl');
  });
});
