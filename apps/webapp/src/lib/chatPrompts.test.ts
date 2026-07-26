import { describe, expect, it } from 'vitest';
import { CHAT_PROMPT_COUNT, pickChatPrompts, timeBucketOf } from './chatPrompts';

const ids = (args: Parameters<typeof pickChatPrompts>[0]) =>
  pickChatPrompts(args).map((p) => p.id);

describe('timeBucketOf', () => {
  it('splits the day the way a listener would', () => {
    expect(timeBucketOf(2)).toBe('night');
    expect(timeBucketOf(5)).toBe('night');
    expect(timeBucketOf(6)).toBe('morning');
    expect(timeBucketOf(11)).toBe('morning');
    expect(timeBucketOf(12)).toBe('day');
    expect(timeBucketOf(17)).toBe('day');
    expect(timeBucketOf(18)).toBe('evening');
    expect(timeBucketOf(23)).toBe('evening');
  });
});

describe('pickChatPrompts', () => {
  it('always fills every slot', () => {
    for (let seed = 0; seed < 12; seed += 1) {
      for (const hour of [3, 9, 14, 21]) {
        expect(pickChatPrompts({ seed, hour })).toHaveLength(CHAT_PROMPT_COUNT);
      }
    }
  });

  it('never repeats a chip within one set', () => {
    for (let seed = 0; seed < 12; seed += 1) {
      const set = ids({ seed, hour: 9, station: 'Tokyo FM', track: 'Anri — Remember Summer Days' });
      expect(new Set(set).size).toBe(set.length);
    }
  });

  it('offers the station on air, and asks about it by name', () => {
    const picked = pickChatPrompts({ seed: 0, hour: 14, station: 'Tokyo FM' });
    const station = picked.find((p) => p.id.startsWith('ctx-'));
    expect(station).toBeDefined();
    expect(station?.params?.station).toBe('Tokyo FM');
  });

  it('offers the track on air only when there IS one', () => {
    const withTrack = ids({ seed: 0, hour: 14, station: 'Tokyo FM', track: 'Plastic Love' });
    expect(withTrack).toContain('ctx-track');
    const without = ids({ seed: 0, hour: 14, station: 'Tokyo FM' });
    expect(without).not.toContain('ctx-track');
  });

  it('spends at most two slots on the thing already playing', () => {
    // Otherwise every chip becomes one topic and the chat stops feeling open.
    for (let seed = 0; seed < 6; seed += 1) {
      const set = ids({ seed, hour: 9, station: 'Tokyo FM', track: 'Plastic Love' });
      expect(set.filter((id) => id.startsWith('ctx-')).length).toBeLessThanOrEqual(2);
    }
  });

  it('matches the chip to the hour', () => {
    expect(ids({ seed: 0, hour: 2 })).toContain('time-night');
    expect(ids({ seed: 0, hour: 8 })).toContain('time-morning');
    expect(ids({ seed: 0, hour: 15 })).toContain('time-focus');
    expect(ids({ seed: 0, hour: 20 })).toContain('time-evening');
  });

  it('actually rotates between consecutive opens', () => {
    // The whole point of the change: the same four chips every time read as
    // decoration rather than an invitation.
    const first = ids({ seed: 1, hour: 14 });
    const second = ids({ seed: 2, hour: 14 });
    expect(first).not.toEqual(second);
  });

  it('is stable for one open — the same seed gives the same chips', () => {
    const a = ids({ seed: 5, hour: 14, station: 'Tokyo FM' });
    const b = ids({ seed: 5, hour: 14, station: 'Tokyo FM' });
    expect(a).toEqual(b);
  });

  it('works with nothing playing at all', () => {
    const set = pickChatPrompts({ seed: 3, hour: 14 });
    expect(set).toHaveLength(CHAT_PROMPT_COUNT);
    expect(set.every((p) => !p.id.startsWith('ctx-'))).toBe(true);
  });
});
