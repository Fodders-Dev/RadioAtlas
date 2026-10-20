import {
  AUDIO_LAB_JOURNAL_KEY,
  AUDIO_LAB_TTL_MS,
  appendAudioLabEntry,
  loadAudioLabJournal,
  persistAudioLabJournal,
  startAudioLabJournal,
  type AudioLabEntry,
  type AudioLabEventName,
  type AudioLabJournal
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
const safeType = () => {
  try { const v = session?.type; return ['ambient', 'auto', 'play-and-record', 'playback', 'transient', 'transient-solo'].includes(String(v)) ? v as AudioLabEntry['sessionType'] : null; }
  catch { return null; }
};
const safeState = () => {
  try { const v = session?.state; return ['active', 'inactive', 'interrupted'].includes(String(v)) ? v as AudioLabEntry['sessionState'] : null; }
  catch { return null; }
};
const mediaSession = (() => { try { return navigator.mediaSession ?? null; } catch { return null; } })();
const storage = (() => { try { return window.localStorage; } catch { return null; } })();

let journal: AudioLabJournal = loadAudioLabJournal(storage);
let lastProgressAt = 0;
let sourceReleased = false;
let handlersAttached = false;
let lastEvent = '';
let commandGeneration = 0;
const hasSavedJournal = (() => { try { return Boolean(storage?.getItem(AUDIO_LAB_JOURNAL_KEY)); } catch { return false; } })();
if (!hasSavedJournal) {
  journal = startAudioLabJournal(storage);
  journal = appendAudioLabEntry(journal, snapshot('recording_started'), storage);
}
if (journal.active) journal = appendAudioLabEntry(journal, snapshot('lab_opened'), storage);

function snapshot(event: AudioLabEventName): AudioLabEntry {
  const visibility = document.visibilityState;
  const error = (() => { try { return audio.error?.code ?? null; } catch { return null; } })();
  return {
    at: Date.now(), event, standalone,
    visibility: ['visible', 'hidden', 'prerender'].includes(visibility) ? visibility as AudioLabEntry['visibility'] : 'unloaded',
    paused: (() => { try { return audio.paused; } catch { return null; } })(),
    readyState: (() => { try { return Number.isInteger(audio.readyState) ? audio.readyState : null; } catch { return null; } })(),
    currentTime: (() => { try { const n = audio.currentTime; return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : null; } catch { return null; } })(),
    errorCode: typeof error === 'number' && Number.isInteger(error) && error >= 1 && error <= 4 ? error : null,
    sessionType: safeType(), sessionState: safeState()
  };
}

function record(event: AudioLabEventName) {
  if (!journal.active) { render(); return; }
  if (Date.now() - journal.startedAt >= AUDIO_LAB_TTL_MS || Date.now() < journal.startedAt) {
    const terminal = { ...journal, active: false, entries: [...journal.entries, snapshot('recording_expired')].slice(-200) };
    while (terminal.entries.length && new TextEncoder().encode(JSON.stringify(terminal)).byteLength > 128 * 1024) terminal.entries.shift();
    persistAudioLabJournal(terminal, storage);
    journal = terminal;
    render();
    return;
  }
  journal = appendAudioLabEntry(journal, snapshot(event), storage);
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
function onSystemStop() { record('stop_requested'); release(); render(); }
function registerMediaHandlers() {
  if (!mediaSession || handlersAttached || sourceReleased) return;
  const actions: Array<[MediaSessionAction, MediaSessionActionHandler | null]> = [
    ['play', () => { void play(); }], ['pause', () => pause()], ['stop', () => onSystemStop()],
    ['nexttrack', null], ['previoustrack', null], ['seekbackward', null], ['seekforward', null], ['seekto', null]
  ];
  for (const [action, handler] of actions) {
    try { mediaSession.setActionHandler(action, handler); } catch { /* individual actions may be unsupported */ }
  }
  try { mediaSession.metadata = new MediaMetadata({ title: 'Minimal PWA player', artist: 'NoLife-Radio', artwork: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }] }); } catch { /* optional API */ }
  try { mediaSession.setPositionState(); } catch { /* live radio has no seek position */ }
  handlersAttached = true;
}
function removeMediaHandlers() {
  if (!mediaSession || !handlersAttached) return;
  for (const action of ['play', 'pause', 'stop', 'nexttrack', 'previoustrack', 'seekbackward', 'seekforward', 'seekto'] as MediaSessionAction[]) {
    try { mediaSession.setActionHandler(action, null); } catch { /* cleanup is best effort */ }
  }
  try { mediaSession.metadata = null; } catch { /* cleanup is best effort */ }
  try { mediaSession.setPositionState(); } catch { /* cleanup is best effort */ }
  safePlaybackState('none');
  handlersAttached = false;
}

async function play() {
  if (sourceReleased) return;
  const generation = ++commandGeneration;
  record('play_requested');
  try {
    await audio.play();
    if (generation !== commandGeneration || sourceReleased) return;
    record('play_resolved');
    safePlaybackState('playing');
  } catch {
    if (generation !== commandGeneration || sourceReleased) return;
    record('play_rejected');
  }
}
function pause() {
  commandGeneration += 1;
  record('pause_requested');
  stopNative();
}
function release() {
  if (sourceReleased) return;
  commandGeneration += 1;
  sourceReleased = true;
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
  release();
});
window.addEventListener('pageshow', () => { record('pageshow'); render(); });
const onSessionChange = () => record('audio_session_statechange');
try { session?.addEventListener?.('statechange', onSessionChange); } catch { /* optional API */ }

$('play').addEventListener('click', () => { void play(); });
$('pause').addEventListener('click', pause);
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
  record('stop_requested');
  release();
  window.location.assign('/');
});
registerMediaHandlers();
render();

// Export only for isolated contract tests; no app runtime reads this surface.
export { AUDIO_LAB_JOURNAL_KEY, AUDIO_LAB_TTL_MS, persistAudioLabJournal };
