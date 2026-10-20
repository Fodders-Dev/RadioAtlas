import {
  AUDIO_LAB_JOURNAL_KEY,
  AUDIO_LAB_TTL_MS,
  appendAudioLabEntry,
  loadAudioLabJournal,
  persistAudioLabJournal,
  startAudioLabJournal,
  type AudioLabEntry,
  type AudioLabCommandSource,
  type AudioLabSessionType,
  type AudioLabEventName,
  type AudioLabJournal,
  type AudioLabTrialMode,
  type AudioLabTrialStatus
} from './lib/audioLabJournal';

declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __BUILD_TIME__: string;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const audio = $('lab-audio') as HTMLAudioElement;
const status = $('status');
const recording = $('recording');
const report = $('report') as HTMLTextAreaElement;
const copyStatus = $('copy-status');
const playButton = $('play') as HTMLButtonElement;
const pauseButton = $('pause') as HTMLButtonElement;
const freshButton = $('fresh') as HTMLButtonElement;
const isRu = (() => {
  try { return localStorage.getItem('radio:locale') !== 'en'; } catch { return true; }
})();
const copy = isRu
  ? { recording: 'Запись активна', expired: 'Запись завершена. Новая запись не начнётся сама.', standalone: 'Установленное приложение', tab: 'Вкладка браузера', visible: 'виден', hidden: 'скрыт', unknown: 'неизвестно' }
  : { recording: 'Recording active', expired: 'Recording ended. A new recording will not start automatically.', standalone: 'Installed app', tab: 'Browser tab', visible: 'visible', hidden: 'hidden', unknown: 'unknown' };
if (!isRu) {
  document.documentElement.lang = 'en';
  $('title').textContent = 'Minimal native player';
  $('intro').textContent = 'One station, one native audio element. This is a diagnostic screen, not a background-audio fix.';
  $('controls').setAttribute('aria-label', 'Controls');
  $('station-title').textContent = 'NoLife-Radio';
  $('trial-label').textContent = 'AudioSession playback (experiment)';
  $('trial-description').textContent = 'Enable before Play. The category remains set through Pause; this is an experiment, not a proven fix.';
  $('pwa-warning').textContent = 'Opened in a browser tab. Open this screen from the installed app to test its PWA context.';
  $('heard').textContent = 'I hear sound'; $('silent').textContent = 'I hear no sound';
  $('copy').textContent = 'Copy journal'; $('return').textContent = 'Return to RadioAtlas';
  $('fresh').textContent = 'Start a new recording';
  const label = document.querySelector('label[for="report"]');
  if (label) label.textContent = 'Local report. Copy it or select the text manually.';
}
document.documentElement.lang = isRu ? 'ru' : 'en';

audio.autoplay = false;
const upstream = 'https://listen.nolife-radio.com/';
audio.src = `/api/stream?url=${encodeURIComponent(upstream)}`;
audio.preload = 'none';
audio.setAttribute('playsinline', '');

const standalone = (() => {
  try { return window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone); }
  catch { return false; }
})();
$('pwa-warning').hidden = standalone;

const session = (() => {
  try { return (navigator as Navigator & { audioSession?: { type?: string; state?: string; addEventListener?: (name: string, cb: EventListener) => void; removeEventListener?: (name: string, cb: EventListener) => void } }).audioSession ?? null; }
  catch { return null; }
})();
const sessionTypes = new Set<AudioLabSessionType>(['ambient', 'auto', 'play-and-record', 'playback', 'transient', 'transient-solo']);
const safeType = () => {
  try { const v = session?.type; return sessionTypes.has(v as AudioLabSessionType) ? v as AudioLabSessionType : null; }
  catch { return null; }
};
const safeState = () => {
  try { const v = session?.state; return ['active', 'inactive', 'interrupted'].includes(String(v)) ? v as AudioLabEntry['sessionState'] : null; }
  catch { return null; }
};
const mediaSession = (() => { try { return navigator.mediaSession ?? null; } catch { return null; } })();
const storage = (() => { try { return window.localStorage; } catch { return null; } })();
const trialCheckbox = $('audio-session-playback') as HTMLInputElement;
let trialMode: AudioLabTrialMode = 'automatic';
let trialStatus: AudioLabTrialStatus = 'automatic';
let trialChoiceLocked = false;
let trialOriginalType: AudioLabSessionType | null = null;
let ownsTrialOverride = false;
type HandlerStatus = 'success' | 'failure' | 'unavailable';
const mediaActionNames = ['play', 'pause', 'stop', 'nexttrack', 'previoustrack', 'seekbackward', 'seekforward', 'seekto'] as const;
type MediaActionName = (typeof mediaActionNames)[number];
const mediaActionStatus: Record<MediaActionName, HandlerStatus> = Object.fromEntries(mediaActionNames.map((name) => [name, 'unavailable'])) as Record<MediaActionName, HandlerStatus>;

let journal: AudioLabJournal = loadAudioLabJournal(storage);
let lastProgressAt = 0;
let sourceReleased = false;
let lastEvent = '';
let commandGeneration = 0;
const hasSavedJournal = (() => { try { return Boolean(storage?.getItem(AUDIO_LAB_JOURNAL_KEY)); } catch { return false; } })();
if (!hasSavedJournal) {
  journal = startAudioLabJournal(storage);
  journal = appendAudioLabEntry(journal, snapshot('recording_started'), storage);
}
if (journal.active) journal = appendAudioLabEntry(journal, snapshot('lab_opened'), storage);

function snapshot(event: AudioLabEventName, commandSource?: AudioLabCommandSource): AudioLabEntry {
  const visibility = document.visibilityState;
  const error = (() => { try { return audio.error?.code ?? null; } catch { return null; } })();
  return {
    at: Date.now(), event, standalone,
    visibility: ['visible', 'hidden', 'prerender'].includes(visibility) ? visibility as AudioLabEntry['visibility'] : 'unloaded',
    paused: (() => { try { return audio.paused; } catch { return null; } })(),
    readyState: (() => { try { return Number.isInteger(audio.readyState) ? audio.readyState : null; } catch { return null; } })(),
    currentTime: (() => { try { const n = audio.currentTime; return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : null; } catch { return null; } })(),
    errorCode: typeof error === 'number' && Number.isInteger(error) && error >= 1 && error <= 4 ? error : null,
    sessionType: safeType(), sessionState: safeState(),
    sessionTrialMode: trialMode,
    sessionTrialStatus: trialStatus,
    ...(commandSource ? { commandSource } : {})
  };
}

function record(event: AudioLabEventName, commandSource?: AudioLabCommandSource) {
  if (!journal.active) { render(); return; }
  if (Date.now() - journal.startedAt >= AUDIO_LAB_TTL_MS || Date.now() < journal.startedAt) {
    const terminal = { ...journal, active: false, entries: [...journal.entries, snapshot('recording_expired')].slice(-200) };
    while (terminal.entries.length && new TextEncoder().encode(JSON.stringify(terminal)).byteLength > 128 * 1024) terminal.entries.shift();
    persistAudioLabJournal(terminal, storage);
    journal = terminal;
    render();
    return;
  }
  journal = appendAudioLabEntry(journal, snapshot(event, commandSource), storage);
  lastEvent = event;
  render();
}

function render() {
  const state = snapshot('lab_opened');
  const mode = standalone ? copy.standalone : copy.tab;
  status.textContent = [
    `${mode} · ${document.visibilityState === 'visible' ? copy.visible : copy.hidden}`,
    `paused=${String(state.paused)} · readyState=${String(state.readyState)} · currentTime=${String(state.currentTime)}`,
    `AudioSession type=${String(state.sessionType ?? copy.unknown)} · state=${String(state.sessionState ?? copy.unknown)}`,
    `build=${typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown'} · commit=${typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'unknown'} · ${typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : 'unknown'}`,
    sourceReleased ? (isRu ? 'Плеер остановлен. Вернитесь в RadioAtlas, чтобы открыть новый сеанс.' : 'Player stopped. Return to RadioAtlas to open a fresh session.') : '',
    'Progress does not prove audible sound.'
  ].join('\n');
  trialCheckbox.disabled = trialChoiceLocked;
  const trialStatusCopy: Record<AudioLabTrialStatus, string> = isRu ? {
    automatic: 'Авто: тип не переопределяется', selected: 'Выбрано: будет проверена категория playback', applied: 'Категория playback прочитана после записи',
    'already-playback': 'Тип уже playback; запись не выполнялась', unavailable: 'AudioSession недоступна', 'original-unknown': 'Исходный тип неизвестен; запись пропущена',
    'write-failed': 'Запись типа завершилась ошибкой', 'write-ignored': 'Запись проигнорирована: тип не изменился', 'readback-unknown': 'Не удалось проверить тип после записи',
    restored: 'Исходный тип восстановлен', 'restore-skipped-changed': 'Тип изменён извне; восстановление пропущено', 'restore-unknown': 'Не удалось прочитать тип перед восстановлением', 'restore-failed': 'Восстановление типа завершилось ошибкой'
  } : {
    automatic: 'Automatic: no category override', selected: 'Selected: playback category will be checked', applied: 'Playback category confirmed by readback',
    'already-playback': 'Type was already playback; no write made', unavailable: 'AudioSession unavailable', 'original-unknown': 'Original type unknown; write skipped',
    'write-failed': 'Category write failed', 'write-ignored': 'Write was ignored: type did not change', 'readback-unknown': 'Could not verify category after write',
    restored: 'Original category restored', 'restore-skipped-changed': 'Type changed elsewhere; restore skipped', 'restore-unknown': 'Could not read type before restore', 'restore-failed': 'Restore failed'
  };
  $('trial-status').textContent = `${trialStatusCopy[trialStatus]} · ${String(safeType() ?? copy.unknown)}`;
  recording.textContent = journal.active ? copy.recording : copy.expired;
  freshButton.hidden = journal.active;
  playButton.disabled = sourceReleased;
  pauseButton.disabled = sourceReleased;
  report.value = makeReport();
}

function makeReport() {
  return JSON.stringify({
    version: 1,
    build: { version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown', commit: typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'unknown', builtAt: typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : 'unknown' },
    userAgent: (() => { try { return navigator.userAgent.slice(0, 300); } catch { return 'unknown'; } })(),
    sessionTrial: { mode: trialMode, status: trialStatus, choiceLocked: trialChoiceLocked, originalType: trialOriginalType },
    mediaSessionHandlerRegistration: { ...mediaActionStatus },
    journal: journal.entries,
    lastEvent
  }, null, 2);
}

function safePlaybackState(value: MediaSessionPlaybackState) {
  try { if (mediaSession) mediaSession.playbackState = value; } catch { /* partial MediaSession */ }
}
function stopNative() {
  try { audio.pause(); } catch { /* partial media element */ }
  safePlaybackState('paused');
}
function onSystemStop() { record('stop_requested', 'media-session'); release('media-session'); render(); }
function applyTrialBeforePlay(source: AudioLabCommandSource) {
  if (trialChoiceLocked) return;
  trialChoiceLocked = true;
  trialMode = trialCheckbox.checked ? 'playback' : 'automatic';
  trialStatus = trialMode === 'playback' ? 'selected' : 'automatic';
  if (trialMode === 'playback') {
    if (!session) {
      trialStatus = 'unavailable';
    } else {
      let original: string | undefined;
      try { original = session.type; } catch { trialStatus = 'original-unknown'; }
      if (trialStatus === 'selected') {
        if (!original || !sessionTypes.has(original as AudioLabSessionType)) {
          trialStatus = 'original-unknown';
        } else {
          trialOriginalType = original as AudioLabSessionType;
          if (trialOriginalType === 'playback') {
            trialStatus = 'already-playback';
          } else {
            try { session.type = 'playback'; } catch { trialStatus = 'write-failed'; }
            if (trialStatus === 'selected') {
              let actual: AudioLabSessionType | null;
              try {
                const value = session.type;
                actual = sessionTypes.has(value as AudioLabSessionType) ? value as AudioLabSessionType : null;
              } catch { actual = null; }
              if (actual === 'playback') {
                ownsTrialOverride = true;
                trialStatus = 'applied';
              } else {
                trialStatus = actual === null ? 'readback-unknown' : 'write-ignored';
              }
            }
          }
        }
      }
    }
  }
  record('audio_session_trial_attempt', source);
  if (trialStatus === 'applied') record('audio_session_trial_applied', source);
  render();
}
function registerMediaHandlers() {
  if (!mediaSession || sourceReleased) return;
  const actions: Array<[MediaSessionAction, MediaSessionActionHandler | null]> = [
    ['play', () => { void play('media-session'); }], ['pause', () => pause('media-session')], ['stop', () => onSystemStop()],
    ['nexttrack', null], ['previoustrack', null], ['seekbackward', null], ['seekforward', null], ['seekto', null]
  ];
  for (const [action, handler] of actions) {
    try { mediaSession.setActionHandler(action, handler); mediaActionStatus[action as MediaActionName] = 'success'; }
    catch { mediaActionStatus[action as MediaActionName] = 'failure'; }
  }
  try { mediaSession.metadata = new MediaMetadata({ title: 'Minimal PWA player', artist: 'NoLife-Radio', artwork: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }] }); } catch { /* optional API */ }
  try { mediaSession.setPositionState(); } catch { /* live radio has no seek position */ }
}
function removeMediaHandlers() {
  if (!mediaSession) return;
  for (const action of mediaActionNames) {
    if (mediaActionStatus[action] !== 'success') continue;
    try { mediaSession.setActionHandler(action, null); } catch { /* cleanup is best effort */ }
  }
  try { mediaSession.metadata = null; } catch { /* cleanup is best effort */ }
  try { mediaSession.setPositionState(); } catch { /* cleanup is best effort */ }
  safePlaybackState('none');
}

async function play(source: 'ui' | 'media-session' = 'ui') {
  if (sourceReleased) return;
  applyTrialBeforePlay(source);
  const generation = ++commandGeneration;
  record('play_requested', source);
  try {
    await audio.play();
    if (generation !== commandGeneration || sourceReleased) return;
    record('play_resolved', source);
    safePlaybackState('playing');
  } catch {
    if (generation !== commandGeneration || sourceReleased) return;
    record('play_rejected', source);
  }
}
function pause(source: 'ui' | 'media-session' = 'ui') {
  commandGeneration += 1;
  record('pause_requested', source);
  stopNative();
}
function restoreTrial(source: AudioLabCommandSource) {
  if (!ownsTrialOverride || !trialOriginalType || !session) return;
  let current: AudioLabSessionType | null;
  try {
    const value = session.type;
    current = sessionTypes.has(value as AudioLabSessionType) ? value as AudioLabSessionType : null;
  } catch { current = null; }
  if (current === null) trialStatus = 'restore-unknown';
  else if (current !== 'playback') trialStatus = 'restore-skipped-changed';
  else {
    try { session.type = trialOriginalType; } catch { trialStatus = 'restore-failed'; }
    if (trialStatus === 'applied' || trialStatus === 'restored') {
      let readback: string | undefined;
      try { readback = session.type; } catch { readback = undefined; }
      trialStatus = readback === trialOriginalType ? 'restored' : 'restore-failed';
    }
  }
  ownsTrialOverride = false;
  record('audio_session_trial_release', source);
}
function release(source: AudioLabCommandSource = 'pagehide') {
  if (sourceReleased) return;
  commandGeneration += 1;
  sourceReleased = true;
  restoreTrial(source);
  try { audio.pause(); } catch { /* best effort */ }
  removeMediaHandlers();
  for (const [event, listener] of audioEventListeners) audio.removeEventListener(event, listener);
  audio.removeEventListener('timeupdate', onTimeUpdate);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  try { session?.removeEventListener?.('statechange', onSessionChange); } catch { /* optional API */ }
  try { audio.removeAttribute('src'); } catch { /* best effort */ }
  try { audio.load(); } catch { /* best effort */ }
}

const audioEventListeners = new Map<string, EventListener>();
for (const event of ['play', 'pause', 'emptied', 'playing', 'waiting', 'stalled', 'ended', 'error'] as const) {
  const diagnosticEvent = event === 'play' ? 'audio_play' : event === 'pause' ? 'audio_pause' : event === 'emptied' ? 'audio_emptied' : event;
  const listener: EventListener = () => {
    record(diagnosticEvent);
    if (event === 'playing' && !sourceReleased && !audio.paused) safePlaybackState('playing');
    if (event === 'pause') safePlaybackState('paused');
    if (event === 'ended' || event === 'error') safePlaybackState('paused');
  };
  audioEventListeners.set(event, listener);
  audio.addEventListener(event, listener);
}
const onTimeUpdate = () => {
  const now = Date.now();
  if (now - lastProgressAt >= 10_000) { lastProgressAt = now; record('time_progress'); }
};
audio.addEventListener('timeupdate', onTimeUpdate);
const onVisibilityChange = () => { record('visibilitychange'); render(); };
document.addEventListener('visibilitychange', onVisibilityChange);
window.addEventListener('pagehide', () => {
  record('pagehide');
  try { audio.pause(); } catch { /* best effort */ }
  release('pagehide');
});
window.addEventListener('pageshow', () => { record('pageshow'); render(); });
const onSessionChange = () => record('audio_session_statechange');
try { session?.addEventListener?.('statechange', onSessionChange); } catch { /* optional API */ }

$('play').addEventListener('click', () => { void play('ui'); });
$('pause').addEventListener('click', () => pause('ui'));
$('audio-session-playback').addEventListener('change', () => {
  if (trialChoiceLocked) return;
  trialMode = trialCheckbox.checked ? 'playback' : 'automatic';
  trialStatus = trialMode === 'playback' ? 'selected' : 'automatic';
  record('audio_session_trial_selected', 'ui');
  render();
});
$('heard').addEventListener('click', () => record('manual_heard'));
$('silent').addEventListener('click', () => record('manual_silence'));
$('fresh').addEventListener('click', () => {
  if (sourceReleased) return;
  journal = startAudioLabJournal(storage);
  journal = appendAudioLabEntry(journal, snapshot('recording_started'), storage);
  record('lab_opened');
  render();
});
$('copy').addEventListener('click', async () => {
  report.value = makeReport();
  let copied = false;
  try { await navigator.clipboard.writeText(report.value); copied = true; } catch { /* selectable fallback below */ }
  copyStatus.textContent = copied ? (isRu ? 'Скопировано' : 'Copied') : (isRu ? 'Не удалось скопировать. Выделите текст ниже.' : 'Copy failed. Select the text below.');
  if (!copied) { report.focus(); report.select(); }
});
$('return').addEventListener('click', () => {
  record('stop_requested', 'return');
  release('return');
  window.location.assign('/');
});
registerMediaHandlers();
render();

// Export only for isolated contract tests; no app runtime reads this surface.
export { AUDIO_LAB_JOURNAL_KEY, AUDIO_LAB_TTL_MS, persistAudioLabJournal };
