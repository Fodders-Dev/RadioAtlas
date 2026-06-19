import { describe, expect, it } from 'vitest';
import { formatSleepRemaining, normalizeSleepMinutes, sleepRemainingMs } from './sleepTimer';

describe('normalizeSleepMinutes', () => {
  it('rounds positive minutes and rejects junk', () => {
    expect(normalizeSleepMinutes(30)).toBe(30);
    expect(normalizeSleepMinutes(29.6)).toBe(30);
    expect(normalizeSleepMinutes(0)).toBeNull();
    expect(normalizeSleepMinutes(-5)).toBeNull();
    expect(normalizeSleepMinutes(Number.NaN)).toBeNull();
  });
  it('caps absurd values at 12h', () => {
    expect(normalizeSleepMinutes(99999)).toBe(720);
  });
});

describe('sleepRemainingMs', () => {
  it('is the clamped distance to endsAt, never negative', () => {
    expect(sleepRemainingMs(1000, 200)).toBe(800);
    expect(sleepRemainingMs(1000, 1000)).toBe(0);
    expect(sleepRemainingMs(1000, 5000)).toBe(0);
    expect(sleepRemainingMs(null, 5000)).toBe(0);
  });
});

describe('formatSleepRemaining', () => {
  it('renders mm:ss, rounding the partial second up', () => {
    expect(formatSleepRemaining(0)).toBe('0:00');
    expect(formatSleepRemaining(1)).toBe('0:01');
    expect(formatSleepRemaining(59_000)).toBe('0:59');
    expect(formatSleepRemaining(60_000)).toBe('1:00');
    expect(formatSleepRemaining(28 * 60_000 + 7_000)).toBe('28:07');
    expect(formatSleepRemaining(75 * 60_000)).toBe('75:00');
  });
});
