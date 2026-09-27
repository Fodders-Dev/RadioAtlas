import { describe, expect, it } from 'vitest';
import { canonicalHomeCountryCode } from './homeAtlas';
describe('Home country codes', () => {
  it('normalizes legacy country aliases and leaves canonical codes intact', () => {
    expect(canonicalHomeCountryCode(' UK ')).toBe('GB');
    expect(canonicalHomeCountryCode('FX')).toBe('FR');
    expect(canonicalHomeCountryCode('SU')).toBe('RU');
    expect(canonicalHomeCountryCode('YU')).toBe('RS');
    expect(canonicalHomeCountryCode('jp')).toBe('JP');
    expect(canonicalHomeCountryCode('')).toBeNull();
    expect(canonicalHomeCountryCode(undefined)).toBeNull();
  });
});
