import { describe, expect, it } from 'vitest';
import { canonicalHomeCountryCode, hasActualMapCoordinate, naturalEarthHomeCountryCode } from './homeAtlas';
import { countryCodeOf } from './countryName';
import atlas from '../assets/home-atlas.json';
import type { StationLite } from '../types';

const station = (geo_lat: number | null, geo_long: number | null) => ({ geo_lat, geo_long } as StationLite);

describe('Home atlas station coordinates', () => {
  it('accepts only explicit valid coordinates from the catalogue', () => {
    expect(hasActualMapCoordinate(station(35.68, 139.69))).toBe(true);
    expect(hasActualMapCoordinate(station(null, null))).toBe(false);
    expect(hasActualMapCoordinate(station(91, 0))).toBe(false);
    expect(hasActualMapCoordinate(station(0, Number.NaN))).toBe(false);
  });

  it('normalizes legacy country aliases used by Natural Earth matching', () => {
    const ids = new Set(atlas.countries.map((country) => country.id));
    expect(ids.size).toBe(atlas.countries.length);
    const features = new Map(atlas.countries.map((country) => [country.name, canonicalHomeCountryCode(countryCodeOf({ country: country.name }))]));
    for (const [name, code] of [['Russia', 'RU'], ['United Kingdom', 'GB'], ['France', 'FR'], ['Serbia', 'RS']]) {
      expect(features.get(name)).toBe(code);
      expect(canonicalHomeCountryCode(code)).toBe(code);
    }
  });

  it('matches Natural Earth numeric ids to the available country decks', () => {
    const ids = new Map(atlas.countries.map((country) => [country.name, country.id]));
    for (const [name, code] of [['Russia', 'RU'], ['United Kingdom', 'GB'], ['France', 'FR'], ['Serbia', 'RS']]) {
      expect(naturalEarthHomeCountryCode(ids.get(name)!, countryCodeOf({ country: name }))).toBe(code);
    }
  });
});
