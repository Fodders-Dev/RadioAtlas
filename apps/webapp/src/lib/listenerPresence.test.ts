import { describe, expect, it } from 'vitest';
import {
  BEAT_HIDDEN_MS,
  BEAT_VISIBLE_MS,
  beatIntervalMs,
  createPresenceToken,
  formatListenerLine,
  shouldReportListening
} from './listenerPresence';

describe('shouldReportListening', () => {
  const base = { hasStation: true, isPlaying: true, optedIn: true };

  it('counts a listener only while audio is actually playing', () => {
    expect(shouldReportListening(base)).toBe(true);
    expect(shouldReportListening({ ...base, isPlaying: false })).toBe(false);
    expect(shouldReportListening({ ...base, hasStation: false })).toBe(false);
  });

  it('honours the opt-out unconditionally', () => {
    expect(shouldReportListening({ ...base, optedIn: false })).toBe(false);
  });
});

describe('beatIntervalMs', () => {
  it('slows down when the app is backgrounded', () => {
    expect(beatIntervalMs(false)).toBe(BEAT_VISIBLE_MS);
    expect(beatIntervalMs(true)).toBe(BEAT_HIDDEN_MS);
    expect(BEAT_HIDDEN_MS).toBeGreaterThan(BEAT_VISIBLE_MS);
  });
});

describe('createPresenceToken', () => {
  it('is unguessable enough and never repeats', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => createPresenceToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      expect(token.length).toBeGreaterThanOrEqual(16);
      expect(token.length).toBeLessThanOrEqual(64);
    }
  });
});

describe('formatListenerLine (anti-fabrication + co-presence gate)', () => {
  it('says NOTHING when you are the only listener', () => {
    // 1 means "just you" — not information, and on a niche station it would be a
    // statement about one identifiable person.
    expect(formatListenerLine(1)).toBeNull();
    expect(formatListenerLine(0)).toBeNull();
  });

  it('says nothing when the count is unknown', () => {
    expect(formatListenerLine(null)).toBeNull();
    expect(formatListenerLine(Number.NaN)).toBeNull();
  });

  it('quotes OTHERS, not the total', () => {
    expect(formatListenerLine(2)).toBe('Ещё 1 слушатель');
    expect(formatListenerLine(3)).toBe('Ещё 2 слушателя');
    expect(formatListenerLine(6)).toBe('Ещё 5 слушателей');
  });

  it('gets Russian plurals right where they are actually hard', () => {
    expect(formatListenerLine(22)).toBe('Ещё 21 слушатель');
    expect(formatListenerLine(12)).toBe('Ещё 11 слушателей');
    expect(formatListenerLine(13)).toBe('Ещё 12 слушателей');
    expect(formatListenerLine(15)).toBe('Ещё 14 слушателей');
    expect(formatListenerLine(102)).toBe('Ещё 101 слушатель');
    expect(formatListenerLine(105)).toBe('Ещё 104 слушателя');
  });

  it('never rounds up or embellishes', () => {
    expect(formatListenerLine(2)).not.toMatch(/~|около|примерно|\+/);
  });
});
