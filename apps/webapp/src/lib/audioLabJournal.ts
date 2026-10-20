export const AUDIO_LAB_JOURNAL_KEY = 'radio:audio-lab:v1';
export const AUDIO_LAB_TTL_MS = 20 * 60 * 1000;
export const AUDIO_LAB_MAX_ENTRIES = 200;
export const AUDIO_LAB_MAX_BYTES = 128 * 1024;

export type AudioLabEventName =
  | 'recording_started' | 'recording_expired' | 'lab_opened' | 'play_requested' | 'play_resolved'
  | 'play_rejected' | 'pause_requested' | 'stop_requested' | 'audio_play' | 'audio_pause' | 'audio_emptied'
  | 'playing' | 'waiting' | 'stalled' | 'ended' | 'error' | 'time_progress' | 'visibilitychange' | 'pagehide' | 'pageshow'
  | 'audio_session_statechange' | 'audio_session_trial_selected' | 'audio_session_trial_attempt'
  | 'audio_session_trial_applied' | 'audio_session_trial_release' | 'manual_heard' | 'manual_silence';

export type AudioLabSessionType = 'ambient' | 'auto' | 'play-and-record' | 'playback' | 'transient' | 'transient-solo';
export type AudioLabTrialMode = 'automatic' | 'playback';
export type AudioLabTrialStatus = 'automatic' | 'selected' | 'applied' | 'already-playback' | 'unavailable' |
  'original-unknown' | 'write-failed' | 'write-ignored' | 'readback-unknown' | 'restored' |
  'restore-skipped-changed' | 'restore-unknown' | 'restore-failed';
export type AudioLabCommandSource = 'ui' | 'media-session' | 'return' | 'pagehide';

export type AudioLabEntry = {
  at: number;
  event: AudioLabEventName;
  standalone: boolean;
  visibility: 'visible' | 'hidden' | 'prerender' | 'unloaded';
  paused: boolean | null;
  readyState: number | null;
  currentTime: number | null;
  errorCode: number | null;
  sessionType: AudioLabSessionType | null;
  sessionState: 'active' | 'inactive' | 'interrupted' | null;
  sessionTrialMode?: AudioLabTrialMode;
  sessionTrialStatus?: AudioLabTrialStatus;
  commandSource?: AudioLabCommandSource;
};

export type AudioLabJournal = { version: 1; startedAt: number; active: boolean; entries: AudioLabEntry[] };

const events = new Set<AudioLabEventName>([
  'recording_started', 'recording_expired', 'lab_opened', 'play_requested', 'play_resolved', 'play_rejected',
  'pause_requested', 'stop_requested', 'audio_play', 'audio_pause', 'audio_emptied', 'playing', 'waiting', 'stalled', 'ended', 'error', 'time_progress',
  'visibilitychange', 'pagehide', 'pageshow', 'audio_session_statechange', 'audio_session_trial_selected',
  'audio_session_trial_attempt', 'audio_session_trial_applied', 'audio_session_trial_release', 'manual_heard', 'manual_silence'
]);
const types = new Set(['ambient', 'auto', 'play-and-record', 'playback', 'transient', 'transient-solo']);
const states = new Set(['active', 'inactive', 'interrupted']);
const trialModes = new Set<AudioLabTrialMode>(['automatic', 'playback']);
const trialStatuses = new Set<AudioLabTrialStatus>([
  'automatic', 'selected', 'applied', 'already-playback', 'unavailable', 'original-unknown', 'write-failed',
  'write-ignored', 'readback-unknown', 'restored', 'restore-skipped-changed', 'restore-unknown', 'restore-failed'
]);
const commandSources = new Set<AudioLabCommandSource>(['ui', 'media-session', 'return', 'pagehide']);
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const empty = (now: number): AudioLabJournal => ({ version: 1, startedAt: now, active: true, entries: [] });

const isEntry = (value: unknown): value is AudioLabEntry => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).every((key) => ['at', 'event', 'standalone', 'visibility', 'paused', 'readyState', 'currentTime', 'errorCode', 'sessionType', 'sessionState', 'sessionTrialMode', 'sessionTrialStatus', 'commandSource'].includes(key)) &&
    Number.isSafeInteger(v.at) && (v.at as number) >= 0 && events.has(v.event as AudioLabEventName) &&
    typeof v.standalone === 'boolean' && ['visible', 'hidden', 'prerender', 'unloaded'].includes(String(v.visibility)) &&
    (v.paused === null || typeof v.paused === 'boolean') &&
    (v.readyState === null || (Number.isInteger(v.readyState) && Number(v.readyState) >= 0 && Number(v.readyState) <= 4)) &&
    (v.currentTime === null || (typeof v.currentTime === 'number' && Number.isFinite(v.currentTime) && v.currentTime >= 0)) &&
    (v.errorCode === null || (Number.isInteger(v.errorCode) && Number(v.errorCode) >= 1 && Number(v.errorCode) <= 4)) &&
    (v.sessionType === null || types.has(String(v.sessionType))) && (v.sessionState === null || states.has(String(v.sessionState))) &&
    (v.sessionTrialMode === undefined || trialModes.has(v.sessionTrialMode as AudioLabTrialMode)) &&
    (v.sessionTrialStatus === undefined || trialStatuses.has(v.sessionTrialStatus as AudioLabTrialStatus)) &&
    (v.commandSource === undefined || commandSources.has(v.commandSource as AudioLabCommandSource));
};

const sanitize = (value: unknown, now: number): AudioLabJournal | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || !Number.isSafeInteger(v.startedAt) || Number(v.startedAt) < 0 || typeof v.active !== 'boolean' || !Array.isArray(v.entries)) return null;
  const entries = v.entries.filter(isEntry).slice(-AUDIO_LAB_MAX_ENTRIES);
  const expired = now - Number(v.startedAt) >= AUDIO_LAB_TTL_MS || now < Number(v.startedAt);
  const cleaned: AudioLabJournal = { version: 1, startedAt: Number(v.startedAt), active: v.active && !expired, entries };
  while (cleaned.entries.length && bytes(cleaned) > AUDIO_LAB_MAX_BYTES) cleaned.entries.shift();
  return cleaned;
};

export const loadAudioLabJournal = (storage: Storage | null, now = Date.now()): AudioLabJournal => {
  if (!storage) return empty(now);
  try {
    const raw = storage.getItem(AUDIO_LAB_JOURNAL_KEY);
    if (raw === null) return empty(now);
    const parsed: unknown = JSON.parse(raw);
    return sanitize(parsed, now) ?? empty(now);
  } catch {
    return empty(now);
  }
};

export const persistAudioLabJournal = (journal: AudioLabJournal, storage: Storage | null): void => {
  if (!storage) return;
  try { storage.setItem(AUDIO_LAB_JOURNAL_KEY, JSON.stringify(journal)); } catch { /* playback is independent of storage */ }
};

export const startAudioLabJournal = (storage: Storage | null, now = Date.now()): AudioLabJournal => {
  const journal = empty(now);
  persistAudioLabJournal(journal, storage);
  return journal;
};

export const appendAudioLabEntry = (journal: AudioLabJournal, entry: AudioLabEntry, storage: Storage | null, now = Date.now()): AudioLabJournal => {
  if (!journal.active || now - journal.startedAt >= AUDIO_LAB_TTL_MS || now < journal.startedAt) {
    const expired = { ...journal, active: false };
    persistAudioLabJournal(expired, storage);
    return expired;
  }
  if (!isEntry(entry)) return journal;
  const next: AudioLabJournal = { ...journal, entries: [...journal.entries, entry].slice(-AUDIO_LAB_MAX_ENTRIES) };
  while (next.entries.length && bytes(next) > AUDIO_LAB_MAX_BYTES) next.entries.shift();
  persistAudioLabJournal(next, storage);
  return next;
};
