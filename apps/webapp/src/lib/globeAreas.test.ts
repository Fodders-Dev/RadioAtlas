import { geoContains } from 'd3-geo';
import { feature } from 'topojson-client';
import { describe, expect, it } from 'vitest';

import worldData from '../assets/countries-110m.json';
import { countryOfArea, placeArea } from './globeAreas';
import type { CatalogArea } from '../domain/contracts';

/**
 * The live catalogue had five Radio Caprice stations — a Moscow network —
 * filed at latitudes around 82°S, and the API's area aggregation has no
 * geometry to notice. The globe drew Russian pills in Antarctica while
 * Russia's 3,164 real stations were absent from that layer entirely.
 */

const world = feature(worldData as never, (worldData as never as any).objects.countries)
  .features as any[];
const polygonFor = (name: string) => world.find((item) => item?.properties?.name === name);

const area = (over: Partial<CatalogArea>): CatalogArea => ({
  id: '10:14:12',
  lat: 55.75,
  lon: 37.61,
  label: 'The Russian Federation',
  subtitle: '1851 stations',
  count: 1851,
  ...over
});

describe('countryOfArea', () => {
  it('reads the country from the label when the subtitle is a station count', () => {
    expect(countryOfArea({ label: 'Germany', subtitle: '1851 stations' })).toBe('Germany');
    expect(countryOfArea({ label: 'Poland', subtitle: '1 station' })).toBe('Poland');
  });

  it('reads it from the subtitle when the label is a region', () => {
    expect(countryOfArea({ label: 'Ciudad de México', subtitle: 'Mexico' })).toBe('Mexico');
  });
});

describe('placeArea', () => {
  it('leaves a plausible cluster exactly where the API put it', () => {
    const moscow = area({ lat: 55.75, lon: 37.61 });
    const placed = placeArea(moscow);
    expect(placed.lat).toBeCloseTo(55.75, 6);
    expect(placed.lon).toBeCloseTo(37.61, 6);
  });

  it('pulls a Russian pill out of Antarctica and back into Russia', () => {
    // The real row: Radio Caprice, country=The Russian Federation, 82°S.
    const wrong = area({ lat: -82.41, lon: 1.58, count: 5, subtitle: '5 stations' });
    const placed = placeArea(wrong);
    expect(placed.lat).not.toBeCloseTo(-82.41, 3);
    expect(geoContains(polygonFor('Russia'), [placed.lon, placed.lat])).toBe(true);
  });

  it('pulls one out of the South Atlantic too', () => {
    const wrong = area({ lat: -59.5, lon: -27.3, count: 1, subtitle: '1 station' });
    const placed = placeArea(wrong);
    expect(geoContains(polygonFor('Russia'), [placed.lon, placed.lat])).toBe(true);
  });

  it('keeps a legitimate outlying region where it is', () => {
    // Kamchatka is 6,600km from Moscow and entirely real; a rule based on
    // distance from the country's other stations would have thrown it away.
    const kamchatka = area({ lat: 53.02, lon: 158.65, count: 3, subtitle: '3 stations' });
    const placed = placeArea(kamchatka);
    expect(placed.lat).toBeCloseTo(53.02, 6);
    expect(placed.lon).toBeCloseTo(158.65, 6);
  });

  it('leaves an area alone when its country means nothing to the resolver', () => {
    const unknown = area({ label: 'Unknown', subtitle: '4 stations', lat: -70, lon: 10 });
    const placed = placeArea(unknown);
    expect(placed.lat).toBe(-70);
    expect(placed.lon).toBe(10);
  });
});
