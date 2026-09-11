import { describe, expect, it } from 'vitest';
import {
  countryCounts,
  countryTarget,
  filterPoints,
  finitePoints,
  nextPanelSize,
  orderPoints,
  pluralForm,
  pointsInBounds
} from './globeExplorer';

const point = (id: string, country: string, lat: number, lon: number, extra: Partial<{ name: string; state: string }> = {}) => ({
  id,
  country,
  lat,
  lon,
  ...extra
});

describe('globeExplorer helpers', () => {
  it('keeps only points with real coordinates — nothing is invented', () => {
    const kept = finitePoints([
      point('a', 'Japan', 35.6, 139.7),
      { id: 'b', country: 'Japan' },
      { id: 'c', country: 'Japan', lat: Number.NaN, lon: 1 },
      { id: 'd', country: 'Russia', lat: -82, lon: 30 },
      { id: 'e', country: 'X', lat: 95, lon: 0 }
    ]);
    expect(kept.map((p) => p.id)).toEqual(['a', 'd']);
  });

  it('flies to the median of the country, not to its outlier', () => {
    const target = countryTarget(
      [
        point('1', 'France', 48.8, 2.3),
        point('2', 'France', 45.7, 4.8),
        point('3', 'France', 43.3, 5.4),
        point('4', 'France', -20.9, 55.5)
      ],
      'France'
    );
    expect(target.lat).toBeCloseTo(45.7, 5);
    expect(target.lon).toBeCloseTo(5.4, 5);
  });

  it('falls back to the resolver centroid for a country without located stations', () => {
    const target = countryTarget([point('1', 'France', 48.8, 2.3)], 'Japan');
    expect(target.lat).toBeGreaterThan(30);
    expect(target.lat).toBeLessThan(46);
    expect(target.lon).toBeGreaterThan(125);
  });

  it('selects points inside a viewport, including across the antimeridian', () => {
    const points = [point('fiji', 'Fiji', -17.7, 178.1), point('samoa', 'Samoa', -13.8, -171.8), point('paris', 'France', 48.8, 2.3)];
    const hits = pointsInBounds(points, { west: 170, east: -160, south: -30, north: 0 });
    expect(hits.map((p) => p.id).sort()).toEqual(['fiji', 'samoa']);
    expect(pointsInBounds(points, { west: -180, east: 180, south: 40, north: 60 }).map((p) => p.id)).toEqual(['paris']);
  });

  it('counts countries by located stations, largest first', () => {
    expect(countryCounts([point('1', 'France', 1, 1), point('2', 'Japan', 1, 1), point('3', 'France', 1, 1)])).toEqual([
      ['France', 2],
      ['Japan', 1]
    ]);
  });

  it('puts personal sources first, then editorial, keeping catalogue order otherwise', () => {
    const points = [point('c', 'F', 0, 0), point('e', 'F', 0, 0), point('p', 'F', 0, 0), point('d', 'F', 0, 0)];
    expect(orderPoints(points, ['p'], ['e', 'p']).map((x) => x.id)).toEqual(['p', 'e', 'c', 'd']);
  });

  it('filters by name, region and the translated country label', () => {
    const points = [
      point('1', 'France', 0, 0, { name: 'RMC FR', state: 'Provence' }),
      point('2', 'Ukraine', 0, 0, { name: 'Радіо Хартія' })
    ];
    const label = (c: string) => (c === 'Ukraine' ? 'Украина' : c);
    expect(filterPoints(points, 'хартія', label).map((p) => p.id)).toEqual(['2']);
    expect(filterPoints(points, 'украин', label).map((p) => p.id)).toEqual(['2']);
    expect(filterPoints(points, 'prov', label).map((p) => p.id)).toEqual(['1']);
    expect(filterPoints(points, '  ', label)).toHaveLength(2);
  });

  it('turns a heading drag into a panel size without dropping a selected source', () => {
    expect(nextPanelSize(-10, 'normal', false)).toBe('normal');
    expect(nextPanelSize(-60, 'normal', false)).toBe('expanded');
    expect(nextPanelSize(60, 'expanded', false)).toBe('normal');
    expect(nextPanelSize(60, 'normal', false)).toBe('collapsed');
    // A selected station keeps its compact card: no collapse below it.
    expect(nextPanelSize(60, 'normal', true)).toBe('normal');
  });

  it('maps counts to plural forms per locale', () => {
    expect(pluralForm(1, 'ru')).toBe('one');
    expect(pluralForm(3, 'ru')).toBe('few');
    expect(pluralForm(12, 'ru')).toBe('many');
    expect(pluralForm(583, 'ru')).toBe('few');
    expect(pluralForm(2, 'en')).toBe('other');
  });
});
