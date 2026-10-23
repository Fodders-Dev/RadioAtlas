import { APP_COMMIT, APP_VERSION, BUILD_TIME } from './buildInfo';

export const PLAYBACK_DIAGNOSTICS_STORAGE_KEY = 'radio:playback-diagnostics:v1';
export const PLAYBACK_DIAGNOSTICS_TTL_MS = 20 * 60 * 1000;
export const PLAYBACK_DIAGNOSTICS_MAX_ENTRIES = 200;
export const PLAYBACK_DIAGNOSTICS_MAX_BYTES = 128 * 1024;

const VERSION = 1 as const;
const EVENTS = [
  'recording_started', 'recording_stopped', 'recording_expired', 'session_started',
  'audio_pause', 'audio_play', 'audio_playing', 'audio_ended', 'audio_error',
  'audio_emptied', 'audio_waiting', 'audio_stalled', 'audio_context_statechange',
  'audio_progress', 'visibilitychange', 'pagehide', 'pageshow', 'media_play_command',
  'media_pause_command', 'media_stop_command', 'media_next_command', 'media_session_updated',
  'media_previous_command', 'transport_resume_native', 'transport_attach', 'transport_play_settled',
  'transport_recovery_decision', 'pwa_playback_category_acquire', 'pwa_playback_category_release'
] as const;
export type PlaybackDiagnosticEvent = (typeof EVENTS)[number];
type Visibility = 'visible' | 'hidden' | 'prerender' | 'unloaded';
type MediaPlaybackState = 'none' | 'paused' | 'playing';
type AudioSessionType = 'ambient' | 'auto' | 'play-and-record' | 'playback' | 'transient' | 'transient-solo';
type AudioSessionState = 'active' | 'inactive' | 'interrupted';
type AudioContextState = 'closed' | 'interrupted' | 'running' | 'suspended';
export type PlaybackDiagnosticControl = {
  candidateMode?: 'direct' | 'proxy' | 'hls' | 'extracted' | null;
  playPending?: boolean;
  permission?: 'none' | 'authorized' | 'debt-held' | 'explicit-pause';
  watchdogTicks?: number;
  watchdogAgeMs?: number | null;
  watchdogDecision?: 'not-run' | 'progress' | 'observation-grace' | 'paused' | 'no-station' |
    'not-started' | 'play-pending' | 'waiting-timer' | 'reconnect-timer' | 'inactive-status' |
    'below-threshold' | 'recover-requested';
  sessionSeq?: number;
  bufferAheadSeconds?: number | null;
  durationKind?: 'unknown' | 'finite' | 'live';
  queueSkippable?: boolean;
  actionReason?: 'buffered' | 'existing-unbuffered' | 'station-start' | 'resume-unbuffered' |
    'explicit-frozen' | 'native-failure' | 'native-timeout' | 'candidate-fallback' | 'reconnect' |
    'resolved' | 'deadline-progress' | 'timeout' | 'media-error' | 'rejected' | 'not-allowed' |
    'aborted' | 'superseded' | 'explicit-pause' | 'debt-held' | 'pending-deferred' |
    'reconnect-scheduled' | 'exhausted';
  pwaPlaybackCategory?: 'not-requested' | 'ineligible' | 'unavailable' | 'original-unknown' | 'skipped-type' |
    'already-playback' | 'write-failed' | 'write-ignored' | 'readback-unknown' | 'acquired' | 'restored' |
    'external-change' | 'restore-unknown' | 'restore-failed';
};

export type PlaybackDiagnosticSnapshot = {
  paused: boolean | null; ended: boolean | null; readyState: number | null; networkState: number | null;
  currentTime: number | null; errorCode: number | null; hasSrc: boolean | null; hasMetadata: boolean | null;
  mediaPlaybackState: MediaPlaybackState | null;
  audioSessionType: AudioSessionType | null; audioSessionState: AudioSessionState | null;
  audioContextState: AudioContextState | null;
};
export type PlaybackDiagnosticEntry = {
  at: number; event: PlaybackDiagnosticEvent; visibility?: Visibility;
  snapshot?: PlaybackDiagnosticSnapshot;
  control?: PlaybackDiagnosticControl;
};
export type PlaybackDiagnosticState = {
  version: typeof VERSION; enabled: boolean; expiresAt: number;
  entries: PlaybackDiagnosticEntry[];
};
type Listener = () => void;

const eventSet = new Set<string>(EVENTS);
const visibilitySet = new Set<Visibility>(['visible', 'hidden', 'prerender', 'unloaded']);
const mediaStateSet = new Set<MediaPlaybackState>(['none', 'paused', 'playing']);
const audioTypeSet = new Set<AudioSessionType>(['ambient', 'auto', 'play-and-record', 'playback', 'transient', 'transient-solo']);
const audioStateSet = new Set<AudioSessionState>(['active', 'inactive', 'interrupted']);
const contextStateSet = new Set<AudioContextState>(['closed', 'interrupted', 'running', 'suspended']);
const candidateModeSet = new Set(['direct', 'proxy', 'hls', 'extracted']);
const permissionSet = new Set(['none', 'authorized', 'debt-held', 'explicit-pause']);
const watchdogDecisionSet = new Set([
  'not-run', 'progress', 'observation-grace', 'paused', 'no-station', 'not-started',
  'play-pending', 'waiting-timer', 'reconnect-timer', 'inactive-status', 'below-threshold',
  'recover-requested'
]);
const durationKindSet = new Set(['unknown', 'finite', 'live']);
const actionReasonSet = new Set([
  'buffered', 'existing-unbuffered', 'station-start', 'resume-unbuffered', 'explicit-frozen',
  'native-failure', 'native-timeout', 'candidate-fallback', 'reconnect', 'resolved',
  'deadline-progress', 'timeout', 'media-error', 'rejected', 'not-allowed', 'aborted',
  'superseded', 'explicit-pause', 'debt-held', 'pending-deferred', 'reconnect-scheduled', 'exhausted'
]);
const pwaPlaybackCategorySet = new Set([
  'not-requested', 'ineligible', 'unavailable', 'original-unknown', 'skipped-type', 'already-playback',
  'write-failed', 'write-ignored', 'readback-unknown', 'acquired', 'restored', 'external-change',
  'restore-unknown', 'restore-failed'
]);
const snapshotKeys = new Set([
  'paused', 'ended', 'readyState', 'networkState', 'currentTime', 'errorCode', 'hasSrc',
  'hasMetadata', 'mediaPlaybackState', 'audioSessionType', 'audioSessionState', 'audioContextState'
]);
const stateKeys = new Set(['version', 'enabled', 'expiresAt', 'entries']);
const entryKeys = new Set(['at', 'event', 'visibility', 'snapshot', 'control']);
const controlKeys = new Set([
  'candidateMode', 'playPending', 'permission', 'watchdogTicks', 'watchdogAgeMs',
  'watchdogDecision', 'sessionSeq', 'bufferAheadSeconds', 'durationKind', 'queueSkippable', 'actionReason',
  'pwaPlaybackCategory'
]);
const listeners = new Set<Listener>();
type PlaybackControlProvider = () => PlaybackDiagnosticControl | undefined;
const controlProviders = new WeakMap<HTMLMediaElement, PlaybackControlProvider>();
let state: PlaybackDiagnosticState | null = null;
let expiryTimer: number | null = null;
let lifecycleAttached = false;
let lastProgressAt = 0;
let persistence: 'persistent' | 'memory' = 'memory';

const only = (value: Record<string, unknown>, keys: Set<string>) =>
  Object.keys(value).every((key) => keys.has(key));
const storage = () => {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
};
const notify = () => listeners.forEach((listener) => { try { listener(); } catch { /* observer only */ } });
const empty = (): PlaybackDiagnosticState => ({ version: VERSION, enabled: false, expiresAt: 0, entries: [] });
const validRange = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

const validSnapshot = (value: unknown): value is PlaybackDiagnosticSnapshot => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return only(v, snapshotKeys) && (v.paused === null || typeof v.paused === 'boolean') && (v.ended === null || typeof v.ended === 'boolean') &&
    (v.readyState === null || validRange(v.readyState, 0, 4)) && (v.networkState === null || validRange(v.networkState, 0, 3)) &&
    (v.currentTime === null || (typeof v.currentTime === 'number' && Number.isFinite(v.currentTime) && v.currentTime >= 0)) &&
    (v.errorCode === null || validRange(v.errorCode, 1, 4)) && (v.hasSrc === null || typeof v.hasSrc === 'boolean') &&
    (v.hasMetadata === null || typeof v.hasMetadata === 'boolean') && (v.mediaPlaybackState === null || mediaStateSet.has(v.mediaPlaybackState as MediaPlaybackState)) &&
    (v.audioSessionType === null || audioTypeSet.has(v.audioSessionType as AudioSessionType)) &&
    (v.audioSessionState === null || audioStateSet.has(v.audioSessionState as AudioSessionState)) &&
    (v.audioContextState === null || contextStateSet.has(v.audioContextState as AudioContextState));
};
const validControl = (value: unknown): value is PlaybackDiagnosticControl => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return only(v, controlKeys) &&
    (v.candidateMode === undefined || v.candidateMode === null || candidateModeSet.has(v.candidateMode as string)) &&
    (v.playPending === undefined || typeof v.playPending === 'boolean') &&
    (v.permission === undefined || permissionSet.has(v.permission as string)) &&
    (v.watchdogTicks === undefined || validRange(v.watchdogTicks, 0, 1_000_000)) &&
    (v.watchdogAgeMs === undefined || v.watchdogAgeMs === null || validRange(v.watchdogAgeMs, 0, 86_400_000)) &&
    (v.watchdogDecision === undefined || watchdogDecisionSet.has(v.watchdogDecision as string)) &&
    (v.sessionSeq === undefined || validRange(v.sessionSeq, 0, 1_000_000_000)) &&
    (v.bufferAheadSeconds === undefined || v.bufferAheadSeconds === null ||
      (typeof v.bufferAheadSeconds === 'number' && Number.isFinite(v.bufferAheadSeconds) &&
        v.bufferAheadSeconds >= 0 && v.bufferAheadSeconds <= 86_400)) &&
    (v.durationKind === undefined || durationKindSet.has(v.durationKind as string)) &&
    (v.queueSkippable === undefined || typeof v.queueSkippable === 'boolean') &&
    (v.actionReason === undefined || actionReasonSet.has(v.actionReason as string)) &&
    (v.pwaPlaybackCategory === undefined || pwaPlaybackCategorySet.has(v.pwaPlaybackCategory as string));
};
const validEntry = (value: unknown): value is PlaybackDiagnosticEntry => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return only(v, entryKeys) && typeof v.at === 'number' && Number.isFinite(v.at) &&
    typeof v.event === 'string' && eventSet.has(v.event) &&
    (v.visibility === undefined || (typeof v.visibility === 'string' && visibilitySet.has(v.visibility as Visibility))) &&
    (v.snapshot === undefined || validSnapshot(v.snapshot)) &&
    (v.control === undefined || validControl(v.control));
};
const validState = (value: unknown): value is PlaybackDiagnosticState => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return only(v, stateKeys) && v.version === VERSION && typeof v.enabled === 'boolean' &&
    typeof v.expiresAt === 'number' && Number.isFinite(v.expiresAt) && Array.isArray(v.entries) &&
    ((v.enabled && v.expiresAt <= Date.now() + PLAYBACK_DIAGNOSTICS_TTL_MS) || (!v.enabled && v.expiresAt === 0)) &&
    v.entries.length <= PLAYBACK_DIAGNOSTICS_MAX_ENTRIES && v.entries.every(validEntry);
};

const persist = () => {
  const store = storage();
  if (!store || !state) { persistence = 'memory'; return false; }
  try {
    let candidate = state;
    let raw = JSON.stringify(candidate);
    while (raw.length > PLAYBACK_DIAGNOSTICS_MAX_BYTES && candidate.entries.length) {
      candidate = { ...candidate, entries: candidate.entries.slice(1) };
      raw = JSON.stringify(candidate);
    }
    if (raw.length > PLAYBACK_DIAGNOSTICS_MAX_BYTES) { persistence = 'memory'; return false; }
    store.setItem(PLAYBACK_DIAGNOSTICS_STORAGE_KEY, raw);
    persistence = store.getItem(PLAYBACK_DIAGNOSTICS_STORAGE_KEY) === raw ? 'persistent' : 'memory';
    return persistence === 'persistent';
  } catch { persistence = 'memory'; return false; }
};

const read = (): PlaybackDiagnosticState => {
  if (state) return state;
  const store = storage();
  try {
    const raw = store?.getItem(PLAYBACK_DIAGNOSTICS_STORAGE_KEY);
    if (raw && raw.length <= PLAYBACK_DIAGNOSTICS_MAX_BYTES) {
      const parsed: unknown = JSON.parse(raw);
      if (validState(parsed)) {
        persistence = 'persistent';
        if (!parsed.enabled || parsed.expiresAt > Date.now()) return (state = parsed);
        state = { ...parsed, enabled: false, expiresAt: 0, entries: [
          ...parsed.entries, { at: Date.now(), event: 'recording_expired' as const }
        ].slice(-PLAYBACK_DIAGNOSTICS_MAX_ENTRIES) };
        persist();
        return state;
      }
    }
    if (raw) store?.removeItem(PLAYBACK_DIAGNOSTICS_STORAGE_KEY);
  } catch {
    try { store?.removeItem(PLAYBACK_DIAGNOSTICS_STORAGE_KEY); } catch { /* optional */ }
  }
  persistence = 'memory';
  return (state = empty());
};

const detach = () => {
  if (!lifecycleAttached || typeof window === 'undefined') return;
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('pagehide', onPageHide);
  window.removeEventListener('pageshow', onPageShow);
  lifecycleAttached = false;
};
const expire = (announce: boolean) => {
  if (!state?.enabled || state.expiresAt > Date.now()) return;
  state = { ...state, enabled: false, expiresAt: 0, entries: [
    ...state.entries, { at: Date.now(), event: 'recording_expired' as const }
  ].slice(-PLAYBACK_DIAGNOSTICS_MAX_ENTRIES) };
  persist(); detach(); if (announce) notify();
};
const schedule = () => {
  if (expiryTimer !== null && typeof window !== 'undefined') window.clearTimeout(expiryTimer);
  expiryTimer = null;
  if (state?.enabled && typeof window !== 'undefined') expiryTimer = window.setTimeout(() => expire(true), Math.max(0, state.expiresAt - Date.now()));
};
const onVisibility = () => recordMainAudioDiagnostic('visibilitychange', document.visibilityState);
const onPageHide = () => recordMainAudioDiagnostic('pagehide');
const onPageShow = () => recordMainAudioDiagnostic('pageshow');
const attach = () => {
  if (lifecycleAttached || !read().enabled || typeof window === 'undefined') return;
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  lifecycleAttached = true;
};

export const initPlaybackDiagnostics = () => {
  if (read().enabled) { attach(); recordPlaybackDiagnostic('session_started'); schedule(); }
  return () => {
    detach();
    if (expiryTimer !== null && typeof window !== 'undefined') window.clearTimeout(expiryTimer);
    expiryTimer = null;
  };
};
export const subscribePlaybackDiagnostics = (listener: Listener) => {
  listeners.add(listener); return () => { listeners.delete(listener); };
};
export const getPlaybackDiagnosticsState = () => {
  const current = read();
  if (current.enabled && current.expiresAt <= Date.now()) expire(false);
  return state ?? current;
};
export const playbackDiagnosticsEnabled = () => {
  try { return getPlaybackDiagnosticsState().enabled; } catch { return false; }
};
export const startPlaybackDiagnostics = () => {
  lastProgressAt = 0;
  state = { version: VERSION, enabled: true, expiresAt: Date.now() + PLAYBACK_DIAGNOSTICS_TTL_MS, entries: [] };
  attach(); persist(); recordPlaybackDiagnostic('recording_started'); schedule(); notify();
};
export const stopPlaybackDiagnostics = () => {
  if (!read().enabled) return;
  recordPlaybackDiagnostic('recording_stopped');
  state = { ...read(), enabled: false, expiresAt: 0 };
  persist(); detach();
  if (expiryTimer !== null && typeof window !== 'undefined') window.clearTimeout(expiryTimer);
  expiryTimer = null; notify();
};

export const registerPlaybackControlProvider = (
  audio: HTMLMediaElement,
  provider: PlaybackControlProvider
) => {
  controlProviders.set(audio, provider);
  return () => {
    if (controlProviders.get(audio) === provider) controlProviders.delete(audio);
  };
};

const readPlaybackControl = (
  audio: HTMLMediaElement | null | undefined,
  overrides?: PlaybackDiagnosticControl
): PlaybackDiagnosticControl | undefined => {
  let supplied: PlaybackDiagnosticControl | undefined;
  try {
    if (audio) supplied = controlProviders.get(audio)?.();
  } catch { /* diagnostics must not affect playback */ }
  if (supplied && !validControl(supplied)) supplied = undefined;
  if (!supplied && !overrides) return undefined;
  const merged = { ...(supplied || {}), ...(overrides || {}) };
  return validControl(merged) ? merged : undefined;
};

const environmentSnapshot = (): PlaybackDiagnosticSnapshot => {
  let mediaSession: MediaSession | null = null;
  let audioSession: { type?: unknown; state?: unknown } | null = null;
  try { mediaSession = typeof navigator !== 'undefined' ? navigator.mediaSession ?? null : null; } catch { /* optional */ }
  try { audioSession = typeof navigator !== 'undefined' ? (navigator as Navigator & {
    audioSession?: { type?: unknown; state?: unknown };
  }).audioSession ?? null : null; } catch { /* optional */ }
  let mediaPlaybackState: MediaPlaybackState | null = null;
  let hasMetadata: boolean | null = null;
  let audioSessionType: AudioSessionType | null = null;
  let audioSessionState: AudioSessionState | null = null;
  try { hasMetadata = mediaSession ? Boolean(mediaSession.metadata) : null; } catch { /* optional */ }
  try {
    const value = mediaSession?.playbackState;
    mediaPlaybackState = value && mediaStateSet.has(value as MediaPlaybackState) ? value as MediaPlaybackState : null;
  } catch { /* optional */ }
  try {
    const value = audioSession?.type;
    audioSessionType = typeof value === 'string' && audioTypeSet.has(value as AudioSessionType) ? value as AudioSessionType : null;
  } catch { /* optional */ }
  try {
    const value = audioSession?.state;
    audioSessionState = typeof value === 'string' && audioStateSet.has(value as AudioSessionState) ? value as AudioSessionState : null;
  } catch { /* optional */ }
  return {
    paused: null, ended: null, readyState: null, networkState: null, currentTime: null, errorCode: null,
    hasSrc: null, hasMetadata, mediaPlaybackState, audioSessionType, audioSessionState,
    audioContextState: null
  };
};
export const recordPwaPlaybackCategoryDiagnostic = (
  event: 'pwa_playback_category_acquire' | 'pwa_playback_category_release',
  status: NonNullable<PlaybackDiagnosticControl['pwaPlaybackCategory']>
) => recordPlaybackDiagnostic(event, undefined, undefined, { pwaPlaybackCategory: status });
export const snapshotPlaybackAudio = (audio: HTMLMediaElement | null | undefined, audioContext?: BaseAudioContext | null) => {
  if (!audio) return environmentSnapshot();
  const base = environmentSnapshot();
  try {
    return {
      ...base, paused: audio.paused, ended: audio.ended, readyState: audio.readyState,
      networkState: audio.networkState, currentTime: Number.isFinite(audio.currentTime) ? Math.round(audio.currentTime * 10) / 10 : 0,
      errorCode: audio.error?.code ?? null, hasSrc: Boolean(audio.currentSrc || audio.getAttribute('src')),
      audioContextState: audioContext?.state && contextStateSet.has(audioContext.state as AudioContextState)
        ? audioContext.state as AudioContextState : null
    } satisfies PlaybackDiagnosticSnapshot;
  } catch { return undefined; }
};
export const recordPlaybackDiagnostic = (
  event: PlaybackDiagnosticEvent,
  snapshot?: PlaybackDiagnosticSnapshot,
  visibility?: Visibility,
  control?: PlaybackDiagnosticControl
) => {
  try {
    const current = read();
    if (!current.enabled || current.expiresAt <= Date.now()) { if (current.enabled) expire(true); return; }
    if (snapshot && !validSnapshot(snapshot)) return;
    if (control && !validControl(control)) return;
    if (event === 'audio_progress') { if (Date.now() - lastProgressAt < 10_000) return; lastProgressAt = Date.now(); }
    state = { ...current, entries: [...current.entries, {
      at: Date.now(), event,
      ...(visibility ? { visibility } : {}),
      ...(snapshot ? { snapshot } : {}),
      ...(control ? { control } : {})
    }].slice(-PLAYBACK_DIAGNOSTICS_MAX_ENTRIES) };
    persist(); notify();
  } catch { /* diagnostics must never affect media commands */ }
};
const recordMainAudioDiagnostic = (event: PlaybackDiagnosticEvent, visibility?: Visibility) => {
  try {
    if (!getPlaybackDiagnosticsState().enabled) return;
    const audio = typeof document === 'undefined' ? null : document.querySelector<HTMLMediaElement>('audio.audio-hidden');
    recordPlaybackDiagnostic(event, snapshotPlaybackAudio(audio), visibility, readPlaybackControl(audio));
  } catch { /* diagnostics must never affect media commands */ }
};
export const recordAudioDiagnostic = (
  event: PlaybackDiagnosticEvent,
  audio: HTMLMediaElement | null | undefined,
  audioContext?: BaseAudioContext | null,
  control?: PlaybackDiagnosticControl
) => {
  try {
    if (!getPlaybackDiagnosticsState().enabled) return;
    recordPlaybackDiagnostic(event, snapshotPlaybackAudio(audio, audioContext), undefined, readPlaybackControl(audio, control));
  } catch { /* diagnostics must never affect audio */ }
};
export const recordMediaCommandDiagnostic = (
  event: Extract<PlaybackDiagnosticEvent, `media_${string}`>,
  control?: PlaybackDiagnosticControl
) => {
  try {
    if (!getPlaybackDiagnosticsState().enabled) return;
    const audio = typeof document === 'undefined'
      ? null
      : document.querySelector<HTMLMediaElement>('audio.audio-hidden');
    recordPlaybackDiagnostic(event, snapshotPlaybackAudio(audio), typeof document === 'undefined' ? undefined : document.visibilityState, readPlaybackControl(audio, control));
  } catch { /* diagnostics must never affect media commands */ }
};
export const recordMediaSessionUpdatedDiagnostic = (control?: PlaybackDiagnosticControl) => {
  try {
    if (!getPlaybackDiagnosticsState().enabled) return;
    const audio = typeof document === 'undefined' ? null : document.querySelector<HTMLMediaElement>('audio.audio-hidden');
    recordPlaybackDiagnostic('media_session_updated', snapshotPlaybackAudio(audio), typeof document === 'undefined' ? undefined : document.visibilityState, readPlaybackControl(audio, control));
  } catch { /* diagnostics must never affect MediaSession */ }
};
export const playbackDiagnosticsIsPersisted = () => persistence === 'persistent';
export const getPlaybackDiagnosticsReport = () => JSON.stringify({
  build: { version: APP_VERSION, commit: APP_COMMIT, builtAt: BUILD_TIME },
  userAgent: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
  standalone: typeof navigator !== 'undefined' &&
    (Boolean((navigator as Navigator & { standalone?: boolean }).standalone) ||
      (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches)),
  persistence, ...getPlaybackDiagnosticsState()
}, null, 2);
export const copyPlaybackDiagnostics = async () => {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
  try { await navigator.clipboard.writeText(getPlaybackDiagnosticsReport()); return true; } catch { return false; }
};
