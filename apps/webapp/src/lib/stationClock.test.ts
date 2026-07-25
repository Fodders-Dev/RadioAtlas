import { describe, expect, it, beforeEach } from 'vitest';
import { __resetStationClockCache, stationLocalTime, stationTimeZone } from './stationClock';

const hasZoneLookup =
  typeof (new Intl.Locale('und-JP') as Intl.Locale & { getTimeZones?: () => string[] })
    .getTimeZones === 'function';

describe('stationClock', () => {
  beforeEach(() => {
    __resetStationClockCache();
  });

  it('refuses a country that spans several zones instead of guessing one', () => {
    // The whole point: a single clock for Russia or the USA is wrong for most of
    // that country's listeners, so we show nothing at all.
    for (const code of ['RU', 'US', 'BR', 'AU', 'CA', 'KZ', 'ID', 'MX']) {
      expect(stationTimeZone(code), `${code} must have no single local time`).toBeNull();
      expect(stationLocalTime(code)).toBeNull();
    }
  });

  it('refuses junk, blanks and non-ISO codes', () => {
    for (const code of ['', ' ', null, undefined, 'X', 'JPN', '12', 'the world']) {
      expect(stationTimeZone(code)).toBeNull();
      expect(stationLocalTime(code)).toBeNull();
    }
  });

  it.runIf(hasZoneLookup)('resolves a single-zone country', () => {
    expect(stationTimeZone('JP')).toBe('Asia/Tokyo');
    expect(stationTimeZone('jp')).toBe('Asia/Tokyo');
  });

  it.runIf(hasZoneLookup)('formats the wall clock at the station, not here', () => {
    // 2026-07-25T12:00:00Z is 21:00 in Tokyo and 14:00 in Paris.
    const instant = new Date('2026-07-25T12:00:00.000Z');
    expect(stationLocalTime('JP', instant)).toBe('21:00');
    expect(stationLocalTime('FR', instant)).toBe('14:00');
  });

  it('never throws, whatever it is handed', () => {
    expect(() => stationLocalTime('ZZ')).not.toThrow();
    expect(() => stationLocalTime('JP', new Date(Number.NaN))).not.toThrow();
    expect(stationLocalTime('JP', new Date(Number.NaN))).toSatisfy(
      (value: string | null) => value === null || typeof value === 'string'
    );
  });
});
