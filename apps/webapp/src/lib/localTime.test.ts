import { describe, expect, it } from 'vitest';
import { formatCoordinate, formatCoordinatePair, formatLocalTime } from './localTime';

describe('formatLocalTime', () => {
  // The helper works off the LOCAL clock plus the runner's own tz offset, so the
  // assertions below reconstruct the same arithmetic rather than hard-coding a
  // wall-clock string (CI and this Windows box sit in different zones).
  const expected = (lon: number, now: Date) => {
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
    const target = new Date(utcMs + (lon / 15) * 60 * 60_000);
    return `${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`;
  };

  it('reads solar time from the longitude', () => {
    const now = new Date(Date.UTC(2026, 3, 20, 9, 0, 0));
    expect(formatLocalTime(135.5023, now)).toBe(expected(135.5023, now));
  });

  it('is zero-padded to HH:MM', () => {
    const now = new Date(Date.UTC(2026, 3, 20, 1, 5, 0));
    expect(formatLocalTime(0, now)).toMatch(/^\d{2}:\d{2}$/);
  });

  it('moves west for a negative longitude', () => {
    const now = new Date(Date.UTC(2026, 3, 20, 12, 0, 0));
    expect(formatLocalTime(-75, now)).toBe(expected(-75, now));
    expect(formatLocalTime(-75, now)).not.toBe(formatLocalTime(75, now));
  });

  it('is UTC at the prime meridian', () => {
    const now = new Date(Date.UTC(2026, 3, 20, 9, 30, 0));
    expect(formatLocalTime(0, now)).toBe('09:30');
  });
});

describe('formatCoordinate', () => {
  it('prints the datum verbatim at 4 decimals with a hemisphere letter', () => {
    expect(formatCoordinate(34.6937, 'N', 'S')).toBe('34.6937° N');
    expect(formatCoordinate(135.5023, 'E', 'W')).toBe('135.5023° E');
  });

  it('uses the negative hemisphere letter and drops the sign', () => {
    expect(formatCoordinate(-33.8688, 'N', 'S')).toBe('33.8688° S');
    expect(formatCoordinate(-46.6333, 'E', 'W')).toBe('46.6333° W');
  });

  it('treats zero as the positive hemisphere', () => {
    expect(formatCoordinate(0, 'N', 'S')).toBe('0° N');
  });

  // toFixed(4) PADS as well as rounds, and padding is fabrication on the one
  // screen whose premise is not fabricating data: the catalog really does carry
  // stations stored at 2 decimals, and "30.76" must not be printed as
  // "30.7600" — that claims ~11m precision the datum does not have.
  it('does not pad a low-precision datum into false precision', () => {
    expect(formatCoordinate(30.76, 'N', 'S')).toBe('30.76° N');
    expect(formatCoordinate(-86.57, 'E', 'W')).toBe('86.57° W');
    expect(formatCoordinate(52.5, 'N', 'S')).toBe('52.5° N');
  });

  // The other direction is safe and stays capped: truncating 14-16 stored
  // decimals to 4 (~11m) never overstates what is known.
  it('caps an over-precise datum at 4 decimals', () => {
    expect(formatCoordinate(34.693737373737, 'N', 'S')).toBe('34.6937° N');
  });

  it('pairs lat and lon', () => {
    expect(formatCoordinatePair(34.6937, 135.5023)).toBe('34.6937° N, 135.5023° E');
  });
});
