import { beforeEach, describe, expect, it, vi } from 'vitest';

const load = () => import('./playbackDiagnostics');

describe('playback diagnostics recorder', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('keeps the newest 200 allowlisted events', async () => {
    const diagnostics = await load();
    diagnostics.startPlaybackDiagnostics();
    for (let index = 0; index < 230; index += 1) {
      diagnostics.recordPlaybackDiagnostic('media_play_command');
    }
    const state = diagnostics.getPlaybackDiagnosticsState();
    expect(state.enabled).toBe(true);
    expect(state.entries).toHaveLength(200);
    expect(state.entries.every((entry) => entry.event === 'media_play_command')).toBe(true);
    diagnostics.stopPlaybackDiagnostics();
  });

  it('retains an expired trace across reload and marks it expired', async () => {
    const diagnostics = await load();
    const now = Date.now();
    localStorage.setItem(diagnostics.PLAYBACK_DIAGNOSTICS_STORAGE_KEY, JSON.stringify({
      version: 1,
      enabled: true,
      expiresAt: now - 1,
      entries: [{ at: now - 100, event: 'audio_pause' }]
    }));

    vi.resetModules();
    const reloaded = await load();
    const state = reloaded.getPlaybackDiagnosticsState();
    expect(state.enabled).toBe(false);
    expect(state.entries.map((entry) => entry.event)).toEqual(['audio_pause', 'recording_expired']);
    expect(JSON.parse(localStorage.getItem(reloaded.PLAYBACK_DIAGNOSTICS_STORAGE_KEY) || '{}').entries).toHaveLength(2);
  });

  it('rejects unknown persisted fields and malformed snapshot ranges', async () => {
    const diagnostics = await load();
    localStorage.setItem(diagnostics.PLAYBACK_DIAGNOSTICS_STORAGE_KEY, JSON.stringify({
      version: 1,
      enabled: false,
      expiresAt: 0,
      entries: [{ at: Date.now(), event: 'audio_pause', unexpected: true }]
    }));
    vi.resetModules();
    const reloaded = await load();
    expect(reloaded.getPlaybackDiagnosticsState().entries).toEqual([]);
    expect(localStorage.getItem(reloaded.PLAYBACK_DIAGNOSTICS_STORAGE_KEY)).toBeNull();

    localStorage.setItem(reloaded.PLAYBACK_DIAGNOSTICS_STORAGE_KEY, JSON.stringify({
      version: 1, enabled: false, expiresAt: 0,
      entries: [{ at: Date.now(), event: 'audio_pause', snapshot: {
        paused: true, ended: false, readyState: 9, networkState: 0, currentTime: 0,
        errorCode: null, hasSrc: false, hasMetadata: false, mediaPlaybackState: 'paused',
        audioSessionType: null, audioSessionState: null, audioContextState: null, url: 'forbidden'
      }}]
    }));
    vi.resetModules();
    const malformed = await load();
    expect(malformed.getPlaybackDiagnosticsState().entries).toEqual([]);
  });

  it('expires on schedule and ignores events after expiry', async () => {
    vi.useFakeTimers();
    const diagnostics = await load();
    diagnostics.startPlaybackDiagnostics();
    vi.advanceTimersByTime(diagnostics.PLAYBACK_DIAGNOSTICS_TTL_MS + 1);
    const expired = diagnostics.getPlaybackDiagnosticsState();
    const count = expired.entries.length;
    expect(expired.enabled).toBe(false);
    expect(expired.entries.at(-1)?.event).toBe('recording_expired');
    diagnostics.recordPlaybackDiagnostic('media_play_command');
    expect(diagnostics.getPlaybackDiagnosticsState().entries).toHaveLength(count);
    vi.useRealTimers();
  });

  it('falls back to memory when storage is blocked and isolates listener failures', async () => {
    const diagnostics = await load();
    const storageGetter = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    const listener = vi.fn(() => { throw new Error('observer failure'); });
    diagnostics.subscribePlaybackDiagnostics(listener);
    expect(() => diagnostics.startPlaybackDiagnostics()).not.toThrow();
    expect(diagnostics.playbackDiagnosticsIsPersisted()).toBe(false);
    const report = JSON.parse(diagnostics.getPlaybackDiagnosticsReport());
    expect(report.persistence).toBe('memory');
    expect(report.analysis.summaryFacts).toContain('no_system_play_commands_observed');
    expect(listener).toHaveBeenCalled();
    diagnostics.stopPlaybackDiagnostics();
    storageGetter.mockRestore();
  });

  it('does not read media getters while diagnostics are disabled', async () => {
    const diagnostics = await load();
    const paused = vi.fn(() => { throw new Error('must not read'); });
    const audio = { get paused() { return paused(); } } as unknown as HTMLMediaElement;
    expect(() => diagnostics.recordAudioDiagnostic('audio_pause', audio)).not.toThrow();
    expect(paused).not.toHaveBeenCalled();
  });

  it('contains a throwing media getter while recording', async () => {
    const diagnostics = await load();
    diagnostics.startPlaybackDiagnostics();
    const paused = vi.fn(() => { throw new Error('browser getter failed'); });
    const audio = { get paused() { return paused(); } } as unknown as HTMLMediaElement;
    expect(() => diagnostics.recordAudioDiagnostic('audio_pause', audio)).not.toThrow();
    expect(paused).toHaveBeenCalled();
    diagnostics.stopPlaybackDiagnostics();
  });

  it('computes analysis only in the exported report without changing schema-v1 persisted entries', async () => {
    const diagnostics = await load();
    diagnostics.startPlaybackDiagnostics();
    diagnostics.recordPlaybackDiagnostic('media_play_command');
    diagnostics.recordPlaybackDiagnostic('media_pause_command');

    const persisted = JSON.parse(localStorage.getItem(diagnostics.PLAYBACK_DIAGNOSTICS_STORAGE_KEY) || '{}');
    const report = JSON.parse(diagnostics.getPlaybackDiagnosticsReport());
    expect(persisted.version).toBe(1);
    expect(Object.keys(persisted).sort()).toEqual(['enabled', 'entries', 'expiresAt', 'version']);
    expect(persisted.analysis).toBeUndefined();
    expect(report.version).toBe(1);
    expect(report.entries).toEqual(persisted.entries);
    expect(report.analysis.analysisUnavailable).toBe(false);
    expect(report.analysis.attempts[0]).toMatchObject({ endedBy: 'media_pause_command', windowEnded: true });
    diagnostics.stopPlaybackDiagnostics();
  });
});
