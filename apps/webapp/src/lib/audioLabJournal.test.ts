import { beforeEach, describe, expect, it } from 'vitest';
import {
  AUDIO_LAB_JOURNAL_KEY,
  AUDIO_LAB_MAX_BYTES,
  AUDIO_LAB_MAX_ENTRIES,
  AUDIO_LAB_TTL_MS,
  appendAudioLabEntry,
  loadAudioLabJournal,
  startAudioLabJournal,
  type AudioLabEntry
} from './audioLabJournal';

const entry = (at: number, event: AudioLabEntry['event'] = 'playing'): AudioLabEntry => ({
  at, event, standalone: true, visibility: 'visible', paused: false, readyState: 4,
  currentTime: 3, errorCode: null, sessionType: 'auto', sessionState: 'active'
});

describe('minimal audio lab journal', () => {
  beforeEach(() => localStorage.clear());

  it('keeps a strict allowlisted local shape and caps entries and bytes', () => {
    let journal = startAudioLabJournal(localStorage, 1000);
    for (let i = 0; i < AUDIO_LAB_MAX_ENTRIES + 30; i += 1) {
      journal = appendAudioLabEntry(journal, entry(1001 + i), localStorage, 1001 + i);
    }
    expect(journal.entries.length).toBeLessThanOrEqual(AUDIO_LAB_MAX_ENTRIES);
    expect(new TextEncoder().encode(localStorage.getItem(AUDIO_LAB_JOURNAL_KEY) || '').byteLength).toBeLessThanOrEqual(AUDIO_LAB_MAX_BYTES);
    expect(localStorage.getItem(AUDIO_LAB_JOURNAL_KEY)).not.toContain('url');
  });

  it('expires on an event and does not silently renew', () => {
    let journal = startAudioLabJournal(localStorage, 5000);
    const expiredAt = 5000 + AUDIO_LAB_TTL_MS;
    journal = appendAudioLabEntry(journal, entry(expiredAt), localStorage, expiredAt);
    expect(journal.active).toBe(false);
    const unchanged = appendAudioLabEntry(journal, entry(expiredAt + 1), localStorage, expiredAt + 1);
    expect(unchanged.active).toBe(false);
    expect(unchanged.startedAt).toBe(5000);
  });

  it('sanitizes malformed persisted data and safely handles storage failures', () => {
    localStorage.setItem(AUDIO_LAB_JOURNAL_KEY, JSON.stringify({ version: 1, startedAt: 1, active: true, entries: [{ event: 'playing', url: 'private' }] }));
    const now = Date.now();
    const loaded = loadAudioLabJournal(localStorage, now);
    expect(loaded.active).toBe(false);
    expect(loaded.entries).toEqual([]);

    const brokenStorage = { getItem: () => { throw new Error('private'); }, setItem: () => { throw new Error('private'); } } as unknown as Storage;
    expect(() => startAudioLabJournal(brokenStorage, now)).not.toThrow();
  });

  it('restores expired evidence without resuming collection and strips unknown fields', () => {
    const now = 50_000_000;
    const old = {
      version: 1, startedAt: now - AUDIO_LAB_TTL_MS - 1, active: true,
      entries: [entry(now - AUDIO_LAB_TTL_MS, 'manual_heard'), { ...entry(now - 1), account: 'private', url: 'private' }]
    };
    localStorage.setItem(AUDIO_LAB_JOURNAL_KEY, JSON.stringify(old));
    const restored = loadAudioLabJournal(localStorage, now);
    expect(restored.active).toBe(false);
    expect(restored.entries).toEqual([entry(now - AUDIO_LAB_TTL_MS, 'manual_heard')]);
    expect(restored.entries).toHaveLength(1);
  });
});
