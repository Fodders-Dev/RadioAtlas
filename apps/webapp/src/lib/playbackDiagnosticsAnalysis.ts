import type { PlaybackDiagnosticEntry } from './playbackDiagnostics';

export const PLAYBACK_DIAGNOSTICS_ANALYSIS_MAX_ENTRIES = 200;
export const PLAYBACK_DIAGNOSTICS_ANALYSIS_MAX_ATTEMPTS = 10;

export type PlaybackAttemptEvidence =
  | 'source_absence_observed'
  | 'media_error_observed'
  | 'audio_context_interrupted_or_suspended'
  | 'audio_session_interrupted_observed'
  | 'audio_context_recovery_observed'
  | 'audio_session_recovery_observed'
  | 'audio_playing_event_observed'
  | 'media_time_progress_observed'
  | 'audio_playing_and_media_time_progress_observed';

export type PlaybackAttemptOutcome =
  | 'media_time_progress_observed'
  | 'playback_state_observed_without_measured_progress'
  | 'source_absence_or_error_observed'
  | 'context_interruption_observed'
  | 'insufficient_evidence';

export type PlaybackAttemptEnd =
  | 'unknown_gap'
  | 'recording_started'
  | 'media_play_command'
  | 'media_pause_command'
  | 'media_stop_command'
  | 'media_next_command'
  | 'media_previous_command'
  | 'session_started'
  | 'recording_stopped'
  | 'recording_expired'
  | 'trace_end';

export type PlaybackAttemptAnalysis = {
  ordinal: number;
  endedBy: PlaybackAttemptEnd;
  windowEnded: boolean;
  complete: boolean;
  outcome: PlaybackAttemptOutcome;
  evidence: PlaybackAttemptEvidence[];
  errorCodes: number[];
  comparableMediaTimeIncreases: number;
  comparableSnapshots: number;
  timingDiscontinuityObserved: boolean;
  sourceResetObserved: boolean;
};

export type PlaybackDiagnosticsAnalysis = {
  analysisUnavailable: boolean;
  inputEntryCount: number;
  ignoredEntryCount: number;
  inputLimitReached: boolean;
  trace: {
    beginsWithoutRecordingStarted: boolean;
    recordingStartedObserved: boolean;
    recordingEndedObserved: boolean;
    gapsOrResetsObserved: boolean;
  };
  summaryFacts: Array<
    | 'system_play_attempts_observed'
    | 'no_system_play_commands_observed'
    | 'trace_begins_mid_recording'
    | 'trace_boundary_or_timing_discontinuity_observed'
    | 'some_attempts_have_incomplete_evidence'
    | 'all_reported_attempts_have_measured_media_time_progress'
  >;
  attempts: PlaybackAttemptAnalysis[];
  omittedAttemptCount: number;
  limitations: Array<
    | 'opt_in_javascript_recorder_only'
    | 'trace_is_bounded_to_recent_recorder_events'
    | 'cannot_observe_os_media_session_delivery'
    | 'media_time_progress_does_not_prove_decoded_or_audible_audio'
    | 'missing_events_or_trace_boundaries_leave_outcomes_unknown'
  >;
};

type SafeEvent = PlaybackDiagnosticEntry['event'];
type SafeSnapshot = NonNullable<PlaybackDiagnosticEntry['snapshot']>;
type SafeEntry = { at: number; event: SafeEvent; snapshot?: SafeSnapshot };
type TimelineEntry = SafeEntry | { gap: true };

const events = new Set<string>([
      'recording_started', 'recording_stopped', 'recording_expired', 'session_started',
  'audio_pause', 'audio_play', 'audio_playing', 'audio_ended', 'audio_error',
  'audio_emptied', 'audio_waiting', 'audio_stalled', 'audio_context_statechange',
  'audio_progress', 'visibilitychange', 'pagehide', 'pageshow', 'media_play_command',
  'media_pause_command', 'media_stop_command', 'media_next_command', 'media_session_updated',
  'media_previous_command'
]);
const allowedKeys = new Set(['at', 'event', 'visibility', 'snapshot']);
const snapshotKeys = new Set([
  'paused', 'ended', 'readyState', 'networkState', 'currentTime', 'errorCode', 'hasSrc',
  'hasMetadata', 'mediaPlaybackState', 'audioSessionType', 'audioSessionState', 'audioContextState'
]);
const transportEvents = new Set<SafeEvent>([
  'media_play_command', 'media_pause_command', 'media_stop_command', 'media_next_command', 'media_previous_command'
]);
const closeReasons: Record<SafeEvent, PlaybackAttemptEnd | null> = {
  recording_started: 'recording_started', recording_stopped: 'recording_stopped', recording_expired: 'recording_expired',
  session_started: 'session_started', audio_pause: null, audio_play: null, audio_playing: null,
  audio_ended: null, audio_error: null, audio_emptied: null, audio_waiting: null, audio_stalled: null,
  audio_context_statechange: null, audio_progress: null, visibilitychange: null, pagehide: null,
  pageshow: null, media_play_command: 'media_play_command', media_pause_command: 'media_pause_command',
  media_stop_command: 'media_stop_command', media_next_command: 'media_next_command',
  media_session_updated: null, media_previous_command: 'media_previous_command'
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hasOnlyKeys = (value: Record<string, unknown>, keys: Set<string>) =>
  Object.keys(value).every((key) => keys.has(key));
const validSnapshot = (value: unknown): SafeSnapshot | null => {
  if (!isRecord(value) || !hasOnlyKeys(value, snapshotKeys)) return null;
  const copy = Object.fromEntries([...snapshotKeys].map((key) => [key, value[key]]));
  const snapshot = copy as Record<string, unknown>;
  const nullableBoolean = (item: unknown) => item === null || typeof item === 'boolean';
  const nullableEnum = (item: unknown, allowed: string[]) => item === null || (typeof item === 'string' && allowed.includes(item));
  const valid = nullableBoolean(snapshot.paused) && nullableBoolean(snapshot.ended) &&
    (snapshot.readyState === null || (Number.isInteger(snapshot.readyState) && Number(snapshot.readyState) >= 0 && Number(snapshot.readyState) <= 4)) &&
    (snapshot.networkState === null || (Number.isInteger(snapshot.networkState) && Number(snapshot.networkState) >= 0 && Number(snapshot.networkState) <= 3)) &&
    (snapshot.currentTime === null || (typeof snapshot.currentTime === 'number' && Number.isFinite(snapshot.currentTime) && snapshot.currentTime >= 0)) &&
    (snapshot.errorCode === null || (Number.isInteger(snapshot.errorCode) && Number(snapshot.errorCode) >= 1 && Number(snapshot.errorCode) <= 4)) &&
    nullableBoolean(snapshot.hasSrc) && nullableBoolean(snapshot.hasMetadata) &&
    nullableEnum(snapshot.mediaPlaybackState, ['none', 'paused', 'playing']) &&
    nullableEnum(snapshot.audioSessionType, ['ambient', 'auto', 'playback', 'transient', 'transient-solo']) &&
    nullableEnum(snapshot.audioSessionState, ['active', 'inactive', 'interrupted']) &&
    nullableEnum(snapshot.audioContextState, ['closed', 'interrupted', 'running', 'suspended']);
  return valid ? copy as SafeSnapshot : null;
};
const safeEntry = (value: unknown): SafeEntry | null => {
  try {
    if (!isRecord(value) || !hasOnlyKeys(value, allowedKeys)) return null;
    const at = value.at;
    const event = value.event;
    const visibility = value.visibility;
    const rawSnapshot = value.snapshot;
    if (typeof at !== 'number' || !Number.isFinite(at) || typeof event !== 'string' || !events.has(event)) return null;
    if (visibility !== undefined && !['visible', 'hidden', 'prerender', 'unloaded'].includes(String(visibility))) return null;
    const snapshot = rawSnapshot === undefined ? undefined : validSnapshot(rawSnapshot);
    if (rawSnapshot !== undefined && !snapshot) return null;
    return {
      at,
      event: event as SafeEvent,
      ...(snapshot ? { snapshot } : {})
    };
  } catch {
    return null;
  }
};

type MutableAttempt = {
  ordinal: number; endedBy: PlaybackAttemptEnd; windowEnded: boolean; complete: boolean; evidenceComplete: boolean;
  sourceAbsence: boolean; mediaErrorObserved: boolean; errorCodes: Set<number>;
  audioContextIssue: boolean; audioSessionIssue: boolean;
  audioContextRecovered: boolean; audioSessionRecovered: boolean;
  audioPlaying: boolean; increases: number; comparableSnapshots: number;
  timingDiscontinuity: boolean; sourceReset: boolean; baseline: { at: number; currentTime: number } | null;
  lastHasSrc: boolean | null;
};

const finalize = (attempt: MutableAttempt): PlaybackAttemptAnalysis => {
  const evidence: PlaybackAttemptEvidence[] = [];
  if (attempt.sourceAbsence) evidence.push('source_absence_observed');
  if (attempt.mediaErrorObserved) evidence.push('media_error_observed');
  if (attempt.audioContextIssue) evidence.push('audio_context_interrupted_or_suspended');
  if (attempt.audioSessionIssue) evidence.push('audio_session_interrupted_observed');
  if (attempt.audioContextRecovered) evidence.push('audio_context_recovery_observed');
  if (attempt.audioSessionRecovered) evidence.push('audio_session_recovery_observed');
  if (attempt.audioPlaying) evidence.push('audio_playing_event_observed');
  if (attempt.increases > 0) evidence.push('media_time_progress_observed');
  if (attempt.audioPlaying && attempt.increases > 0) evidence.push('audio_playing_and_media_time_progress_observed');
  let outcome: PlaybackAttemptOutcome = 'insufficient_evidence';
  if (attempt.increases > 0) outcome = 'media_time_progress_observed';
  else if (attempt.audioPlaying) outcome = 'playback_state_observed_without_measured_progress';
  else if (attempt.sourceAbsence || attempt.mediaErrorObserved) outcome = 'source_absence_or_error_observed';
  else if (attempt.audioContextIssue || attempt.audioSessionIssue) outcome = 'context_interruption_observed';
  return {
    ordinal: attempt.ordinal, endedBy: attempt.endedBy, windowEnded: attempt.windowEnded, complete: attempt.complete, outcome,
    evidence, errorCodes: [...attempt.errorCodes].sort((a, b) => a - b),
    comparableMediaTimeIncreases: attempt.increases, comparableSnapshots: attempt.comparableSnapshots,
    timingDiscontinuityObserved: attempt.timingDiscontinuity,
    sourceResetObserved: attempt.sourceReset
  };
};

/** Analyze a bounded diagnostic trace without inferring OS delivery or audible output. */
const analyzePlaybackDiagnosticsUnsafe = (entries: readonly PlaybackDiagnosticEntry[]): PlaybackDiagnosticsAnalysis => {
  const total = Array.isArray(entries) ? entries.length : 0;
  const limited = Array.isArray(entries) ? entries.slice(-PLAYBACK_DIAGNOSTICS_ANALYSIS_MAX_ENTRIES) : [];
  const safe: TimelineEntry[] = [];
  let ignoredEntryCount = Math.max(0, total - limited.length);
  for (const raw of limited) {
    const entry = safeEntry(raw);
    if (entry) safe.push(entry);
    else { ignoredEntryCount += 1; safe.push({ gap: true }); }
  }

  const attempts: PlaybackAttemptAnalysis[] = [];
  let current: MutableAttempt | null = null;
  let ordinal = 0;
  let lastTimestamp: number | null = null;
  let beginsWithoutRecordingStarted = safe.length > 0 && ('gap' in safe[0] || safe[0].event !== 'recording_started');
  let recordingStartedObserved = false;
  let recordingEndedObserved = false;
  let gapsOrResetsObserved = ignoredEntryCount > 0 || beginsWithoutRecordingStarted;
  const close = (endedBy: PlaybackAttemptEnd, windowEnded: boolean) => {
    if (!current) return;
    current.endedBy = endedBy;
    current.windowEnded = windowEnded;
    current.complete = windowEnded && current.evidenceComplete;
    attempts.push(finalize(current));
    current = null;
  };

  for (const entry of safe) {
    if ('gap' in entry) {
      gapsOrResetsObserved = true;
      lastTimestamp = null;
      if (current) {
        current.timingDiscontinuity = true;
        current.evidenceComplete = false;
        current.baseline = null;
        close('unknown_gap', false);
      }
      continue;
    }
    const rollback = lastTimestamp !== null && entry.at < lastTimestamp;
    const equalTimestamp = lastTimestamp !== null && entry.at === lastTimestamp;
    if (rollback || equalTimestamp) {
      gapsOrResetsObserved = true;
      if (current) {
        current.timingDiscontinuity = true;
        current.evidenceComplete = false;
        current.baseline = null;
      }
    }
    lastTimestamp = entry.at;

    if (entry.event === 'recording_started') recordingStartedObserved = true;
    if (entry.event === 'recording_stopped' || entry.event === 'recording_expired') recordingEndedObserved = true;

    const end = closeReasons[entry.event];
    if (end) close(end, transportEvents.has(entry.event));
    if (entry.event === 'media_play_command') {
      ordinal += 1;
      current = {
        ordinal, endedBy: 'trace_end', windowEnded: false, complete: false, evidenceComplete: true,
        sourceAbsence: false, mediaErrorObserved: false, errorCodes: new Set(),
        audioContextIssue: false, audioSessionIssue: false, audioContextRecovered: false, audioSessionRecovered: false,
        audioPlaying: false, increases: 0,
        comparableSnapshots: 0, timingDiscontinuity: false, sourceReset: false, baseline: null, lastHasSrc: null
      };
    }
    if (!current) continue;

    const snapshot = entry.snapshot;
    if (entry.event === 'audio_emptied') {
      current.sourceReset = true;
      current.baseline = null;
      gapsOrResetsObserved = true;
    }
    if (entry.event === 'audio_error') {
      current.baseline = null;
      current.mediaErrorObserved = true;
      if (snapshot?.errorCode !== null && snapshot?.errorCode !== undefined) current.errorCodes.add(snapshot.errorCode);
    }
    if (snapshot) {
      if (snapshot.hasSrc === false) {
        current.sourceAbsence = true;
        if (current.lastHasSrc !== false) {
          current.sourceReset ||= current.lastHasSrc !== null;
          current.baseline = null;
        }
      } else if (snapshot.hasSrc === true && current.lastHasSrc === false) {
        current.sourceReset = true;
        current.baseline = null;
      }
      if (snapshot.hasSrc !== null) current.lastHasSrc = snapshot.hasSrc;
      if (snapshot.errorCode !== null) current.errorCodes.add(snapshot.errorCode);
      if (snapshot.errorCode !== null) current.mediaErrorObserved = true;

      if (snapshot.audioContextState === 'interrupted' || snapshot.audioContextState === 'suspended') {
        current.audioContextIssue = true;
        current.baseline = null;
      } else if (snapshot.audioContextState === 'running' && current.audioContextIssue) {
        current.audioContextRecovered = true;
      }
      if (snapshot.audioSessionState === 'interrupted') {
        current.audioSessionIssue = true;
        current.baseline = null;
      } else if (snapshot.audioSessionState === 'active' && current.audioSessionIssue) {
        current.audioSessionRecovered = true;
      }
      const contextHealthy = snapshot.audioContextState !== 'interrupted' && snapshot.audioContextState !== 'suspended' &&
        snapshot.audioSessionState !== 'interrupted';
      const healthyBaseline = entry.event !== 'audio_error' && entry.event !== 'audio_emptied' && contextHealthy &&
        snapshot.hasSrc === true && snapshot.errorCode === null && snapshot.currentTime !== null;
      if (healthyBaseline && snapshot.currentTime !== null) {
        current.comparableSnapshots += 1;
        if (current.baseline && snapshot.currentTime < current.baseline.currentTime) {
          current.timingDiscontinuity = true;
          current.evidenceComplete = false;
          gapsOrResetsObserved = true;
          current.baseline = null;
        }
        if (current.baseline && entry.at > current.baseline.at && snapshot.currentTime > current.baseline.currentTime) {
          current.increases += 1;
        }
        current.baseline = { at: entry.at, currentTime: snapshot.currentTime };
      } else {
        current.baseline = null;
      }
    }
    if (entry.event === 'audio_playing') current.audioPlaying = true;
  }
  close('trace_end', false);

  const omittedAttemptCount = Math.max(0, attempts.length - PLAYBACK_DIAGNOSTICS_ANALYSIS_MAX_ATTEMPTS);
  const recentAttempts = attempts.slice(-PLAYBACK_DIAGNOSTICS_ANALYSIS_MAX_ATTEMPTS);
  const summaryFacts: PlaybackDiagnosticsAnalysis['summaryFacts'] = [];
  if (attempts.length) summaryFacts.push('system_play_attempts_observed');
  else summaryFacts.push('no_system_play_commands_observed');
  if (beginsWithoutRecordingStarted) summaryFacts.push('trace_begins_mid_recording');
  if (gapsOrResetsObserved) summaryFacts.push('trace_boundary_or_timing_discontinuity_observed');
  if (attempts.some((attempt) => attempt.outcome === 'insufficient_evidence' || !attempt.complete)) {
    summaryFacts.push('some_attempts_have_incomplete_evidence');
  }
  if (recentAttempts.length && recentAttempts.every((attempt) => attempt.comparableMediaTimeIncreases > 0)) {
    summaryFacts.push('all_reported_attempts_have_measured_media_time_progress');
  }
  return {
    analysisUnavailable: false,
    inputEntryCount: total, ignoredEntryCount, inputLimitReached: total > PLAYBACK_DIAGNOSTICS_ANALYSIS_MAX_ENTRIES,
    trace: { beginsWithoutRecordingStarted, recordingStartedObserved, recordingEndedObserved, gapsOrResetsObserved },
    summaryFacts, attempts: recentAttempts, omittedAttemptCount,
    limitations: [
      'opt_in_javascript_recorder_only', 'trace_is_bounded_to_recent_recorder_events',
      'cannot_observe_os_media_session_delivery',
      'media_time_progress_does_not_prove_decoded_or_audible_audio',
      'missing_events_or_trace_boundaries_leave_outcomes_unknown'
    ]
  };
};

const unavailableAnalysis = (): PlaybackDiagnosticsAnalysis => ({
  analysisUnavailable: true,
  inputEntryCount: 0,
  ignoredEntryCount: 0,
  inputLimitReached: false,
  trace: {
    beginsWithoutRecordingStarted: true,
    recordingStartedObserved: false,
    recordingEndedObserved: false,
    gapsOrResetsObserved: true
  },
  summaryFacts: [
    'no_system_play_commands_observed',
    'trace_begins_mid_recording',
    'trace_boundary_or_timing_discontinuity_observed',
    'some_attempts_have_incomplete_evidence'
  ],
  attempts: [],
  omittedAttemptCount: 0,
  limitations: [
    'opt_in_javascript_recorder_only',
    'trace_is_bounded_to_recent_recorder_events',
    'cannot_observe_os_media_session_delivery',
    'media_time_progress_does_not_prove_decoded_or_audible_audio',
    'missing_events_or_trace_boundaries_leave_outcomes_unknown'
  ]
});

export const analyzePlaybackDiagnostics = (entries: readonly PlaybackDiagnosticEntry[]): PlaybackDiagnosticsAnalysis => {
  try { return analyzePlaybackDiagnosticsUnsafe(entries); }
  catch { return unavailableAnalysis(); }
};
