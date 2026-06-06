import { describe, expect, it } from 'vitest';
import { normalizeStationName } from './stationUtils';

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
    expect(normalizeStationName('Jazz __ Cool')).toBe('Jazz _ Cool');
    expect(normalizeStationName('  __80__  EXITOS  ')).toBe('80_ EXITOS');
  });

  it('preserves a single interior underscore', () => {
    expect(normalizeStationName('LO_FI')).toBe('LO_FI');
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
