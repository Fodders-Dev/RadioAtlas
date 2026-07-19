import { describe, expect, it } from 'vitest';
import { SORT_MODES, applySearchSort, isSearchSortMode } from './searchSort';
import type { StationLite } from '../../types';

const station = (name: string, country = ''): StationLite =>
  ({
    stationuuid: `uuid-${name}`,
    name,
    url_resolved: '',
    homepage: '',
    favicon: '',
    country,
    state: '',
    tags: '',
    stationArtwork: '',
    description: '',
    websiteUrl: '',
    scheduleNote: '',
    isClaimed: false,
    isVerified: false,
    promoted: false
  }) as StationLite;

describe('applySearchSort', () => {
  it('returns the SAME array reference for relevance', () => {
    // Load-bearing: the default path must be byte-identical to the
    // pre-redesign render, or every DOM-order assertion in mobile.spec.ts
    // regresses for the wrong reason.
    const list = [station('B'), station('A')];
    expect(applySearchSort(list, 'relevance')).toBe(list);
  });

  it('sorts by name without mutating the frozen ranking', () => {
    const list = [station('Zeta'), station('alpha'), station('Beta')];
    const sorted = applySearchSort(list, 'name');
    expect(sorted.map((item) => item.name)).toEqual(['alpha', 'Beta', 'Zeta']);
    // The upstream snapshot must survive untouched — it is the rank freeze.
    expect(list.map((item) => item.name)).toEqual(['Zeta', 'alpha', 'Beta']);
    expect(sorted).not.toBe(list);
  });

  it('sorts Cyrillic names in reader order, not UTF-16 code-unit order', () => {
    const list = [station('Ярославль FM'), station('Балтика'), station('Авторадио')];
    expect(applySearchSort(list, 'name').map((item) => item.name)).toEqual([
      'Авторадио',
      'Балтика',
      'Ярославль FM'
    ]);
  });

  it('sorts by country and tie-breaks on name', () => {
    const list = [
      station('Osaka Nights', 'Japan'),
      station('Berlin Pulse', 'Germany'),
      station('Tokyo FM', 'Japan')
    ];
    expect(applySearchSort(list, 'country').map((item) => item.name)).toEqual([
      'Berlin Pulse',
      'Osaka Nights',
      'Tokyo FM'
    ]);
  });

  it('sinks stations with no country to the bottom instead of sorting them as ""', () => {
    const list = [station('Nowhere', ''), station('Tokyo FM', 'Japan')];
    expect(applySearchSort(list, 'country').map((item) => item.name)).toEqual([
      'Tokyo FM',
      'Nowhere'
    ]);
  });

  it('offers only orderings the serialized data actually supports', () => {
    // votes / clickcount are NOT serialized to StationLite, and relabelling
    // either as "popularity" is the same fabrication as a fake listener count.
    expect([...SORT_MODES]).toEqual(['relevance', 'name', 'country']);
    expect(isSearchSortMode('popularity')).toBe(false);
    expect(isSearchSortMode('relevance')).toBe(true);
  });
});
