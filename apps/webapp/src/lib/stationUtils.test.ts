import { describe, expect, it } from 'vitest';
import type { StationLite } from '../types';
import {
  formatCountryLabel,
  normalizeStationName,
  stationLocation,
  stationTags
} from './stationUtils';

describe('normalizeStationName', () => {
  it('trims leading underscores and spaces', () => {
    expect(normalizeStationName('___80 EXITOS')).toBe('80 EXITOS');
    expect(normalizeStationName('   Radio One')).toBe('Radio One');
  });

  it('trims trailing underscores and spaces', () => {
    expect(normalizeStationName('Radio One___')).toBe('Radio One');
    expect(normalizeStationName('Radio One   ')).toBe('Radio One');
  });

  it('collapses runs of whitespace and underscores', () => {
    expect(normalizeStationName('Radio    Salü')).toBe('Radio Salü');
  });

  it('drops a single underscore that hugs a space', () => {
    // PR-4: "CHRISTMAS CHOR_ by" -> "CHRISTMAS CHOR by"
    expect(normalizeStationName('CHRISTMAS CHOR_ by')).toBe('CHRISTMAS CHOR by');
    expect(normalizeStationName('by _CHRISTMAS')).toBe('by CHRISTMAS');
    expect(normalizeStationName('Jazz __ Cool')).toBe('Jazz Cool');
    expect(normalizeStationName('  __80__  EXITOS  ')).toBe('80 EXITOS');
  });

  it('preserves an underscore between word characters', () => {
    expect(normalizeStationName('LO_FI')).toBe('LO_FI');
    expect(normalizeStationName('DEEP_HOUSE FM')).toBe('DEEP_HOUSE FM');
  });

  it('handles empty / nullish input', () => {
    expect(normalizeStationName('')).toBe('');
    expect(normalizeStationName(undefined)).toBe('');
    expect(normalizeStationName(null)).toBe('');
    expect(normalizeStationName('___')).toBe('');
    expect(normalizeStationName('   ')).toBe('');
  });

  it('leaves an already-clean name unchanged', () => {
    expect(normalizeStationName('BBC Radio 6 Music')).toBe('BBC Radio 6 Music');
  });
});

describe('station display fallbacks', () => {
  const station = {
    stationuuid: 'station',
    name: 'Station',
    country: '',
    state: '',
    tags: ''
  } as StationLite;

  it('lets localized callers supply empty-state copy', () => {
    expect(stationLocation(station, 'Локация не указана')).toBe('Локация не указана');
    expect(stationTags(station, '')).toBe('');
  });

  // The default used to be the hard-coded English «Unknown location», and almost
  // no caller passed a localised one — so a Russian UI printed it under station
  // cards on the first screen a new user sees. Defaulting to empty means the
  // line is simply omitted rather than spending a row to announce an absence.
  it('defaults to nothing rather than inventing an English placeholder', () => {
    expect(stationLocation(station)).toBe('');
    expect(stationLocation(station)).not.toMatch(/unknown/i);
  });

  it('shortens verbose catalog country names for display', () => {
    expect(formatCountryLabel('The United Kingdom Of Great Britain And Northern Ireland')).toBe(
      'United Kingdom'
    );
  });
});
