import { describe, expect, it } from 'vitest';
import type { PlaybackDiagnosticEntry, PlaybackDiagnosticSnapshot } from './playbackDiagnostics';
import { analyzePlaybackDiagnostics } from './playbackDiagnosticsAnalysis';

const snapshot = (overrides: Partial<PlaybackDiagnosticSnapshot> = {}): PlaybackDiagnosticSnapshot => ({
  paused: null, ended: null, readyState: null, networkState: null, currentTime: null, errorCode: null,
  hasSrc: null, hasMetadata: null, mediaPlaybackState: null, audioSessionType: null,
  audioSessionState: null, audioContextState: null, ...overrides
});
const entry = (at: number, event: PlaybackDiagnosticEntry['event'], data?: Partial<PlaybackDiagnosticSnapshot>): PlaybackDiagnosticEntry => ({
  at, event, ...(data ? { snapshot: snapshot(data) } : {})
});
const one = (entries: PlaybackDiagnosticEntry[]) => analyzePlaybackDiagnostics(entries).attempts[0];

describe('playback diagnostic evidence analysis', () => {
  it('reports measured media-time progress with a distinct non-audibility limitation', () => {
    const attempt = one([
      entry(1, 'recording_started'), entry(2, 'media_play_command', { hasSrc: true, currentTime: 0 }),
      entry(3, 'audio_playing', { hasSrc: true, currentTime: 0.2 }),
      entry(4, 'audio_progress', { hasSrc: true, currentTime: 1.2 }),
      entry(5, 'media_pause_command')
    ]);
    expect(attempt?.outcome).toBe('media_time_progress_observed');
    expect(attempt?.evidence).toContain('audio_playing_and_media_time_progress_observed');
    expect(attempt?.comparableMediaTimeIncreases).toBe(2);
    expect(analyzePlaybackDiagnostics([]).limitations).toContain('media_time_progress_does_not_prove_decoded_or_audible_audio');
  });

  it('does not treat a play event without measured progress as proof of progress', () => {
    const attempt = one([
      entry(1, 'media_play_command'), entry(2, 'audio_playing', { hasSrc: true, currentTime: 0.4 }),
      entry(3, 'audio_progress', { hasSrc: true, currentTime: 0.4 }), entry(4, 'media_pause_command')
    ]);
    expect(attempt?.outcome).toBe('playback_state_observed_without_measured_progress');
    expect(attempt?.comparableMediaTimeIncreases).toBe(0);
  });

  it('records interrupted context and later recovery without declaring a cause', () => {
    const attempt = one([
      entry(1, 'media_play_command'), entry(2, 'audio_context_statechange', { audioContextState: 'interrupted' }),
      entry(3, 'audio_context_statechange', { audioContextState: 'running' }), entry(4, 'media_pause_command')
    ]);
    expect(attempt?.evidence).toContain('audio_context_interrupted_or_suspended');
    expect(attempt?.evidence).toContain('audio_context_recovery_observed');
    expect(attempt?.outcome).toBe('context_interruption_observed');
  });

  it('does not call an unrelated active audio session recovery from a suspended context', () => {
    const attempt = one([
      entry(1, 'media_play_command'),
      entry(2, 'audio_context_statechange', { audioContextState: 'suspended', audioSessionState: 'active' }),
      entry(3, 'audio_context_statechange', { audioContextState: 'suspended', audioSessionState: 'active' }),
      entry(4, 'media_pause_command')
    ]);
    expect(attempt?.evidence).toContain('audio_context_interrupted_or_suspended');
    expect(attempt?.evidence).not.toContain('audio_context_recovery_observed');
    expect(attempt?.evidence).not.toContain('audio_session_recovery_observed');
  });

  it('records channel-matched recovery only on a later snapshot', () => {
    const context = one([
      entry(1, 'media_play_command'),
      entry(2, 'audio_context_statechange', { audioContextState: 'suspended', audioSessionState: 'active' }),
      entry(3, 'audio_context_statechange', { audioContextState: 'running', hasSrc: true, currentTime: 5 }),
      entry(4, 'audio_progress', { audioContextState: 'running', hasSrc: true, currentTime: 6 }),
      entry(5, 'media_pause_command')
    ]);
    expect(context?.evidence).toContain('audio_context_recovery_observed');
    expect(context?.evidence).not.toContain('audio_session_recovery_observed');
    expect(context?.comparableMediaTimeIncreases).toBe(1);

    const session = one([
      entry(1, 'media_play_command'),
      entry(2, 'audio_context_statechange', { audioSessionState: 'interrupted' }),
      entry(3, 'audio_context_statechange', { audioSessionState: 'active' }),
      entry(4, 'media_pause_command')
    ]);
    expect(session?.evidence).toContain('audio_session_interrupted_observed');
    expect(session?.evidence).toContain('audio_session_recovery_observed');
    expect(session?.evidence).not.toContain('audio_context_recovery_observed');
  });

  it('reports an observed media error while allowing later measured recovery', () => {
    const attempt = one([
      entry(1, 'media_play_command'), entry(2, 'audio_error', { errorCode: 2, currentTime: 0 }),
      entry(3, 'audio_playing', { hasSrc: true, currentTime: 0.1 }), entry(4, 'audio_progress', { hasSrc: true, currentTime: 1 }),
      entry(5, 'media_pause_command')
    ]);
    expect(attempt?.errorCodes).toEqual([2]);
    expect(attempt?.outcome).toBe('media_time_progress_observed');
  });

  it('reports audio_error even when no snapshot or numeric error code is available', () => {
    const attempt = one([
      entry(1, 'media_play_command'), entry(2, 'audio_error'), entry(3, 'media_pause_command')
    ]);
    expect(attempt?.evidence).toContain('media_error_observed');
    expect(attempt?.outcome).toBe('source_absence_or_error_observed');
    expect(attempt?.errorCodes).toEqual([]);
  });

  it('does not compare times from source-less snapshots', () => {
    const attempt = one([
      entry(1, 'media_play_command', { hasSrc: false, currentTime: 0 }),
      entry(2, 'audio_progress', { hasSrc: false, currentTime: 10 }),
      entry(3, 'media_pause_command')
    ]);
    expect(attempt?.comparableMediaTimeIncreases).toBe(0);
    expect(attempt?.comparableSnapshots).toBe(0);
  });

  it('re-establishes a healthy baseline after an error before counting later progress', () => {
    const attempt = one([
      entry(1, 'media_play_command', { hasSrc: true, currentTime: 0 }),
      entry(2, 'audio_error', { hasSrc: true, errorCode: 2, currentTime: 0 }),
      entry(3, 'audio_playing', { hasSrc: true, errorCode: null, currentTime: 10 }),
      entry(4, 'audio_progress', { hasSrc: true, errorCode: null, currentTime: 11 }),
      entry(5, 'media_pause_command')
    ]);
    expect(attempt?.evidence).toContain('media_error_observed');
    expect(attempt?.comparableMediaTimeIncreases).toBe(1);
  });

  it('returns an insufficient-evidence summary when no system play was recorded', () => {
    const result = analyzePlaybackDiagnostics([entry(1, 'recording_started'), entry(2, 'audio_playing')]);
    expect(result.attempts).toEqual([]);
    expect(result.summaryFacts).toContain('no_system_play_commands_observed');
  });

  it('marks a trace that starts after recording began as truncated and attempt evidence incomplete', () => {
    const result = analyzePlaybackDiagnostics([entry(1, 'media_play_command')]);
    expect(result.trace.beginsWithoutRecordingStarted).toBe(true);
    expect(result.summaryFacts).toContain('trace_begins_mid_recording');
    expect(result.attempts[0]).toMatchObject({ complete: false, outcome: 'insufficient_evidence', endedBy: 'trace_end' });
  });

  it('closes attempts at later transport commands so their events cannot be attributed to the old play', () => {
    const result = analyzePlaybackDiagnostics([
      entry(1, 'media_play_command'), entry(2, 'media_next_command'),
      entry(3, 'audio_playing', { currentTime: 3 }), entry(4, 'audio_progress', { currentTime: 4 })
    ]);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({ endedBy: 'media_next_command', complete: true, outcome: 'insufficient_evidence' });
  });

  it('does not count equal timestamps, clock rollback, or media-time rollback as progress', () => {
    const result = analyzePlaybackDiagnostics([
      entry(1, 'recording_started'), entry(2, 'media_play_command', { hasSrc: true, currentTime: 0 }),
      entry(2, 'audio_progress', { hasSrc: true, currentTime: 1 }), entry(1, 'audio_progress', { hasSrc: true, currentTime: 2 }),
      entry(3, 'audio_progress', { hasSrc: true, currentTime: 0.5 }), entry(4, 'audio_progress', { hasSrc: true, currentTime: 0.5 }),
      entry(5, 'media_pause_command')
    ]);
    expect(result.attempts[0]?.comparableMediaTimeIncreases).toBe(0);
    expect(result.attempts[0]?.timingDiscontinuityObserved).toBe(true);
    expect(result.attempts[0]?.complete).toBe(false);
    expect(result.attempts[0]?.windowEnded).toBe(true);
    expect(result.trace.gapsOrResetsObserved).toBe(true);
  });

  it('keeps an attempt incomplete after media-time rollback even without wall-clock rollback', () => {
    const attempt = one([
      entry(1, 'media_play_command', { hasSrc: true, currentTime: 10 }),
      entry(2, 'audio_progress', { hasSrc: true, currentTime: 1 }),
      entry(3, 'audio_progress', { hasSrc: true, currentTime: 2 }),
      entry(4, 'media_pause_command')
    ]);
    expect(attempt).toMatchObject({
      timingDiscontinuityObserved: true,
      windowEnded: true,
      complete: false,
      comparableMediaTimeIncreases: 1
    });
  });

  it('closes an active attempt at a repeated recording start and waits for a new play', () => {
    const result = analyzePlaybackDiagnostics([
      entry(1, 'recording_started'),
      entry(2, 'media_play_command', { hasSrc: true, currentTime: 1 }),
      entry(3, 'recording_started'),
      entry(4, 'audio_progress', { hasSrc: true, currentTime: 50 }),
      entry(5, 'media_pause_command')
    ]);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({
      endedBy: 'recording_started', windowEnded: false, complete: false,
      comparableMediaTimeIncreases: 0
    });
  });

  it('breaks media-time comparisons across an emptied or changed source', () => {
    const emptied = one([
      entry(1, 'media_play_command', { currentTime: 0, hasSrc: true }),
      entry(2, 'audio_emptied', { currentTime: 0.5, hasSrc: false }),
      entry(3, 'audio_progress', { currentTime: 9, hasSrc: true }),
      entry(4, 'audio_progress', { currentTime: 10, hasSrc: true }), entry(5, 'media_pause_command')
    ]);
    expect(emptied?.comparableMediaTimeIncreases).toBe(1);
    expect(emptied?.sourceResetObserved).toBe(true);
    expect(emptied?.evidence).toContain('source_absence_observed');
  });

  it('keeps source reset evidence when emptied and source absence share one entry', () => {
    const attempt = one([
      entry(1, 'media_play_command'),
      entry(2, 'audio_emptied', { hasSrc: false }),
      entry(3, 'media_pause_command')
    ]);
    expect(attempt?.sourceResetObserved).toBe(true);
  });

  it('omits hostile unknown payloads from the result and treats them as gaps', () => {
    const hostile = { at: 2, event: 'audio_playing', message: 'secret station URL' } as unknown as PlaybackDiagnosticEntry;
    const result = analyzePlaybackDiagnostics([entry(1, 'media_play_command'), hostile]);
    expect(result.ignoredEntryCount).toBe(1);
    expect(result.attempts[0]).toMatchObject({ endedBy: 'unknown_gap', windowEnded: false, complete: false });
    expect(result.attempts[0]?.outcome).toBe('insufficient_evidence');
    expect(JSON.stringify(result)).not.toContain('secret station URL');
  });

  it('does not compare media time across an unknown timeline gap or attribute later events', () => {
    const malformed = { at: 3, event: 'audio_playing', stationUrl: 'private://station' } as unknown as PlaybackDiagnosticEntry;
    const result = analyzePlaybackDiagnostics([
      entry(1, 'media_play_command', { hasSrc: true, currentTime: 0 }),
      entry(2, 'audio_progress', { hasSrc: true, currentTime: 0 }),
      malformed,
      entry(4, 'audio_progress', { hasSrc: true, currentTime: 10 }),
      entry(5, 'media_pause_command')
    ]);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({
      endedBy: 'unknown_gap', windowEnded: false, complete: false,
      comparableMediaTimeIncreases: 0, timingDiscontinuityObserved: true
    });
    expect(JSON.stringify(result)).not.toContain('private://station');
  });

  it('contains hostile proxies and throwing snapshot getters at the analyzer boundary', () => {
    const throwingSnapshot = new Proxy(snapshot(), {
      get(_target, key) { if (key === 'currentTime') throw new Error('hostile getter'); return null; }
    });
    const malformed = { at: 2, event: 'audio_progress', snapshot: throwingSnapshot } as unknown as PlaybackDiagnosticEntry;
    expect(() => analyzePlaybackDiagnostics([entry(1, 'media_play_command'), malformed])).not.toThrow();
    expect(analyzePlaybackDiagnostics([entry(1, 'media_play_command'), malformed]).attempts[0]?.endedBy).toBe('unknown_gap');

    const hostileArray = new Proxy([] as PlaybackDiagnosticEntry[], {
      get(target, key, receiver) { if (key === 'length') throw new Error('hostile array'); return Reflect.get(target, key, receiver); }
    });
    expect(analyzePlaybackDiagnostics(hostileArray).analysisUnavailable).toBe(true);
  });

  it('bounds attempts and event input while retaining recent attempts in input order', () => {
    const entries: PlaybackDiagnosticEntry[] = [];
    for (let i = 0; i < 12; i += 1) {
      entries.push(entry(i * 2, 'media_play_command'), entry(i * 2 + 1, 'media_pause_command'));
    }
    const result = analyzePlaybackDiagnostics(entries);
    expect(result.attempts).toHaveLength(10);
    expect(result.attempts.map((attempt) => attempt.ordinal)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(result.omittedAttemptCount).toBe(2);
    const overLimit: PlaybackDiagnosticEntry[] = [];
    for (let i = 0; i < 101; i += 1) {
      overLimit.push(entry(i * 2, 'media_play_command'), entry(i * 2 + 1, 'media_pause_command'));
    }
    expect(analyzePlaybackDiagnostics(overLimit)).toMatchObject({ inputEntryCount: 202, inputLimitReached: true });
  });
});
