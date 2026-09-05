import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlaybackCandidate, PlaybackFailure, PlaybackFailurePhase } from '../domain/contracts';
import type { StationLite } from '../types';
import { getApiBase } from './apiBase';
import { checkApiAvailability, markApiUnavailable } from './apiAvailability';
import { decideCandidateSwitch } from './candidateSwitchGuard';
import { reportClientEvent } from './observability';
import { buildStationStreamTargets } from './stationStreams';
import {
  buildCandidates,
  isDirectAudioUrl,
  isHls,
  needsApiAssist,
  toPlaybackFailure
} from './playbackTransport';

export type PlayerStatus = 'idle' | 'buffering' | 'playing' | 'paused' | 'error';

export const EQ_BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000] as const;

export type PlayerEqState = {
  enabled: boolean;
  preamp: number;
  bands: number[];
};

export type PlayerVisualizerState = {
  active: boolean;
  available: boolean;
};

// Live spectrum/waveform frame pushed to subscribers via
// subscribeVisualizer. The buffers are reused (filled in place) each
// frame, so a subscriber must read synchronously and not retain the
// arrays across ticks. (T2.1)
export type VisualizerFrame = {
  spectrum: Float32Array;
  waveform: Float32Array;
};

export type VisualizerSubscriber = (frame: VisualizerFrame) => void;

type PlayStationResult = {
  ok: boolean;
  error?: string;
  station?: StationLite;
  activeCandidate?: PlaybackCandidate | null;
  startupMs?: number | null;
};

type PlayCandidateResult = {
  ok: boolean;
  error?: string;
  superseded?: boolean;
  activeCandidate?: PlaybackCandidate | null;
  startupMs?: number | null;
};

type ReconnectState = {
  timer: number | null;
  attempts: number;
};

type CandidatePlan = ReturnType<typeof buildCandidates>;

const EQ_CENTER = 50;
const EQ_RANGE_DB = 12;
// Exported so visualiser components size themselves off the pump instead of
// guessing: `spectrum` is a Float32Array of exactly this length, and a consumer
// that renders more bars than this silently paints the extras at a dead zero
// forever (FeedWaveform shipped 28 against 24 and had a permanently flat tail).
export const VISUALIZER_BARS = 24;
const VISUALIZER_WAVEFORM_SAMPLES = 24;
const PLAYBACK_SUPERSEDED = 'playback superseded';
const STARTUP_BUFFER_GRACE_MS = 15000;
const REBUFFER_GRACE_MS = 6000;
const AUDIO_CONTEXT_RESUME_TIMEOUT_MS = 250;
// Silent-stall watchdog. Some live MP3/ICY streams (small self-hosted
// AzuraCast/Icecast boxes) stop sending audio WITHOUT firing 'stalled' /
// 'waiting' / 'error' / 'ended' — the element just goes quiet and currentTime
// stops advancing, so the event-driven recovery never triggers («играла минут
// 5-10 и стопнулась»). This watchdog polls currentTime progress and, if it hasn't
// advanced for the threshold while we believe we're playing and NOT paused,
// recovers the SAME station (tryNextCandidate → scheduleReconnect) — #86-safe, it
// never switches to a different station.
const STALL_WATCHDOG_INTERVAL_MS = 3000;
const STALL_WATCHDOG_THRESHOLD_MS = 9000;

// Below this, a trip to the background tells us nothing: flicking to another app
// and straight back can show no measurable position change even when playback was
// perfectly healthy, and counting that as a death would manufacture a problem.
const BACKGROUND_JUDGE_MIN_MS = 10_000;
// Position must advance by at least this share of the time spent hidden to count
// as alive. Deliberately generous — buffering, a reconnect and an inexact clock
// should all still read as survival; only real silence should not.
const BACKGROUND_ALIVE_RATIO = 0.5;

/**
 * Did playback survive a trip to the background, or die there quietly?
 *
 * Extracted as a pure function so the judgement is unit-testable without a DOM
 * audio element — the same reason `shouldRecoverFromSilentStall` is.
 *
 * Judged from POSITION MOVEMENT, never from wall clock: a hidden tab throttles
 * timers and withholds `timeupdate` while the audio keeps playing, so anything
 * clock-driven reports healthy playback as dead.
 */
export const judgeBackgroundPlayback = (input: {
  paused: boolean;
  hiddenMs: number;
  advancedMs: number;
}): 'survived' | 'died' | 'unknown' => {
  if (input.hiddenMs < BACKGROUND_JUDGE_MIN_MS) return 'unknown';
  if (input.paused) return 'died';
  return input.advancedMs > input.hiddenMs * BACKGROUND_ALIVE_RATIO ? 'survived' : 'died';
};

// Pure trigger decision for the silent-stall watchdog (extracted so the tricky
// false-positive/negative logic is unit-testable without a DOM audio element).
// Recover ONLY when we believe we're actively playing a station, aren't manually
// paused, aren't already recovering, and playback position hasn't advanced for the
// threshold. NOT during startup (before first audio), pause, error, or an in-flight
// rebuffer/reconnect — those are handled by the event-driven path.
export const shouldRecoverFromSilentStall = (state: {
  paused: boolean;
  hasPlayed: boolean;
  hasStation: boolean;
  recovering: boolean;
  status: PlayerStatus;
  msSinceProgress: number;
  /**
   * Has `currentTime` actually MOVED since the last check? This is the ground
   * truth, and `msSinceProgress` is not: that clock is refreshed by `timeupdate`
   * events, which a backgrounded tab throttles or withholds entirely while the
   * audio keeps playing perfectly well.
   *
   * Production, 2026-08-15 18:07:56 — the first turn of this data the app ever
   * recorded: a listener came back to a Mini App that had been hidden for almost
   * two minutes, and `audio_visibility_change` and `audio_silent_stall` landed in
   * the SAME second, followed by a reconnect. The stream was fine; the watchdog
   * tore it down because nobody had told it the clock stops when the screen does.
   * Four such stalls and six reconnects in one session, all on one listener.
   */
  positionMoved?: boolean;
  thresholdMs?: number;
}): boolean =>
  !state.positionMoved &&
  !state.paused &&
  state.hasPlayed &&
  state.hasStation &&
  !state.recovering &&
  state.status !== 'paused' &&
  state.status !== 'idle' &&
  state.status !== 'error' &&
  state.msSinceProgress >= (state.thresholdMs ?? STALL_WATCHDOG_THRESHOLD_MS);

const normalizeBase = (value?: string) => (value ? value.replace(/\/+$/, '') : '');
const clampPercent = (value: number) => Math.min(100, Math.max(0, value));
const clampBalance = (value: number) => Math.min(100, Math.max(-100, value));
const sliderToDb = (value: number) => ((clampPercent(value) - EQ_CENTER) / EQ_CENTER) * EQ_RANGE_DB;
const dbToGain = (value: number) => 10 ** (value / 20);
const balanceToPan = (value: number) => clampBalance(value) / 100;
const createDefaultEqBands = () => EQ_BANDS.map(() => EQ_CENTER);
const shouldForceAudioGraph = () =>
  typeof window !== 'undefined' && Boolean((window as typeof window & { __RA_FORCE_AUDIO_GRAPH__?: boolean }).__RA_FORCE_AUDIO_GRAPH__);
const isConstrainedApplePlayback = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const looksLikeIPad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const isAppleMobile = /iPhone|iPad|iPod/i.test(ua) || looksLikeIPad;
  const isAppleWebKit = /AppleWebKit/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua);
  return isAppleMobile && isAppleWebKit;
};
const shouldUseLeanPlaybackMode = () =>
  isConstrainedApplePlayback() && !shouldForceAudioGraph();

const pushUnique = (items: string[], value: string) => {
  if (!value) return;
  if (items.includes(value)) return;
  items.push(value);
};

const formatMediaError = (audio: HTMLAudioElement | null) => {
  const code = audio?.error?.code;
  if (!code) return null;
  switch (code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return 'media aborted';
    case MediaError.MEDIA_ERR_NETWORK:
      return 'media network error';
    case MediaError.MEDIA_ERR_DECODE:
      return 'media decode error';
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'media source not supported';
    default:
      return 'media error';
  }
};

// hls.js shape we depend on (loaded via dynamic import; typed structurally so
// the test can pass a fake without pulling the real module).
type HlsLike = {
  loadSource: (url: string) => void;
  attachMedia: (media: HTMLMediaElement) => void;
  destroy: () => void;
};
type HlsConstructor = new (config: Record<string, unknown>) => HlsLike;

// Tuned for live radio HLS (infinite stream, modest buffer). Module-level so the
// supersede helper and its test share one config.
const HLS_CONFIG: Record<string, unknown> = {
  enableWorker: true,
  lowLatencyMode: false,
  maxBufferLength: 30,
  maxMaxBufferLength: 60,
  maxBufferSize: 60 * 1000 * 1000,
  maxBufferHole: 0.5,
  liveSyncDurationCount: 3,
  liveMaxLatencyDurationCount: 10,
  liveDurationInfinity: true,
  highBufferWatchdogPeriod: 2
};

/**
 * Construct + attach an Hls instance ONLY if the playback session is still
 * current.
 *
 * attachSource awaits `import('hls.js')` before it can build the player. If the
 * user switched stations during that async gap, attaching now would call
 * attachMedia on the SHARED <audio> element — hijacking it from the newer
 * session — and overwrite hlsRef, orphaning the newer session's Hls (a leak).
 * Re-checking `isCurrent()` AFTER the import and bailing before we construct or
 * touch the element prevents both. Returns the attached Hls, or null when
 * superseded (the caller then leaves hlsRef / the element untouched).
 *
 * Pure + DI'd ctor for unit testing.
 */
export const attachHlsIfCurrent = (
  HlsCtor: HlsConstructor,
  audio: HTMLMediaElement,
  url: string,
  isCurrent: () => boolean,
  config: Record<string, unknown> = HLS_CONFIG
): HlsLike | null => {
  if (!isCurrent()) return null;
  const hls = new HlsCtor(config);
  hls.loadSource(url);
  hls.attachMedia(audio);
  return hls;
};

export const useAudioPlayer = ({
  onEvent
}: {
  onEvent?: (message: string) => void;
} = {}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  const reconnectRef = useRef<ReconnectState>({ timer: null, attempts: 0 });
  const waitingTimeoutRef = useRef<number | null>(null);
  // Last time audio playback position actually ADVANCED — the silent-stall
  // watchdog compares against this. Reset on each 'playing'; bumped on real
  // timeupdate progress.
  const lastProgressRef = useRef<{ time: number; at: number }>({ time: 0, at: 0 });
  // Set when the page is hidden while audio is playing, read when it comes back:
  // the only way to learn whether playback SURVIVED the background, rather than
  // just that we went there. See handleVisibility.
  const backgroundedRef = useRef<{
    position: number;
    at: number;
    session: number;
    /**
     * ⚠ EXPLICIT, even though the marker is only ever written while
     * `!audio.paused` and its mere existence therefore already means "was
     * playing". An invariant that lives in the shape of an `if` is exactly what
     * a later refactor deletes without knowing it was load bearing, and this
     * one is what keeps an intentional pause out of the resume path.
     */
    wasPlaying: boolean;
  } | null>(null);
  /**
   * Does THIS foreground return still owe the listener a reconnect?
   *
   * A positive, short-lived token rather than a global "the pause was not ours"
   * heuristic. The negative form works today and rots across several
   * pause/play/background cycles, because it has to be un-set correctly from
   * everywhere; this one is granted at exactly one place and surrendered at
   * three.
   *
   * ⚠ It cannot be derived from `backgroundedRef`, and that is measured:
   * `reportBackgroundOutcome` clears the marker unconditionally on its FIRST
   * line, before the verdict is even computed. On an `unknown` verdict — a
   * background shorter than 10s — the proof that we were playing is destroyed,
   * which is precisely the window where the OS can still have killed the
   * stream. Without this token the tap-path would fall back to a bare `.play()`
   * on a dead socket, the exact hole this lane exists to close.
   *
   * Granted:   a foreground return whose verdict is NOT `survived`.
   * Surrendered: the listener pauses on purpose; playback actually progresses;
   *              a reconnect has been attempted for it.
   */
  const backgroundResumeEligibleRef = useRef(false);
  const currentRef = useRef<StationLite | null>(null);
  const requestedStationRef = useRef<StationLite | null>(null);
  const candidatesRef = useRef<PlaybackCandidate[]>([]);
  const candidateIndexRef = useRef(0);
  const activeCandidateRef = useRef<PlaybackCandidate | null>(null);
  const activeUrlRef = useRef<string | null>(null);
  const apiBaseRef = useRef('');
  const candidatePlanRef = useRef<CandidatePlan>({
    candidates: [],
    blockedMixedContent: false,
    apiUnavailable: false
  });
  const candidateFailuresRef = useRef<PlaybackFailure[]>([]);
  const lastErrorRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const preampGainRef = useRef<GainNode | null>(null);
  const stereoPannerRef = useRef<StereoPannerNode | null>(null);
  const eqFiltersRef = useRef<BiquadFilterNode[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const visualizerFrameRef = useRef<number | null>(null);
  const audioGraphFailedRef = useRef(false);
  // Visualizer is pushed to subscribers via a ref-based rAF loop instead
  // of 30 Hz React state. The loop is demand-gated: it only runs while
  // there's at least one subscriber AND playback is live. (T2.1)
  const visualizerSubscribersRef = useRef<Set<VisualizerSubscriber>>(new Set());
  const visualizerControllerRef = useRef<{ start: () => void; stop: () => void }>({
    start: () => {},
    stop: () => {}
  });
  const playbackSessionRef = useRef(0);
  const candidateStartedAtRef = useRef(0);
  const candidateHasPlayedRef = useRef(false);
  // True between `audio.play()` and its promise settling. The buffering
  // watchdog reads it: calling load() for the next candidate during that window
  // rejects the pending play with AbortError, and the two of them then walk the
  // same candidate list in opposite directions until it is empty. See
  // candidateSwitchGuard.ts for the measurement behind this.
  const playPendingRef = useRef(false);
  const playPendingDeferralsRef = useRef(0);
  const statusRef = useRef<PlayerStatus>('idle');
  const isPlayingRef = useRef(false);

  const [current, setCurrent] = useState<StationLite | null>(null);
  /**
   * The station somebody has ASKED for but which has not produced audio yet.
   *
   * `current` deliberately means "on air": play() clears it and only
   * `handlePlaying` sets it, so nothing in the app can claim a station is
   * playing before it is. That is right, and it had one consequence nobody
   * intended — the dock is gated on `current`, so between the tap and the first
   * sound there was no station, and the player bar vanished and came back.
   * Reported as a bug, and it is one: "нажимаю следующую станцию и плеер
   * пропадает, пока станция не заиграет".
   *
   * So the wait gets its own state rather than `current` being loosened, which
   * would have quietly changed what "playing" means for metadata, analytics and
   * the never-auto-switch rule.
   */
  const [pending, setPending] = useState<StationLite | null>(null);
  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [balance, setBalance] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [playbackFailure, setPlaybackFailure] = useState<PlaybackFailure | null>(null);
  const [eqEnabled, setEqEnabled] = useState(true);
  const [eqPreamp, setEqPreamp] = useState(EQ_CENTER);
  const [eqBands, setEqBands] = useState<number[]>(createDefaultEqBands);
  const [visualizer, setVisualizer] = useState<PlayerVisualizerState>({
    active: false,
    available: false
  });

  const pushEvent = (message: string) => {
    if (onEvent) onEvent(message);
  };

  const reportPlaybackEvent = (
    name: string,
    {
      detail = null,
      dedupeKey = null,
      dedupeMs,
      meta
    }: {
      detail?: string | null;
      dedupeKey?: string | null;
      dedupeMs?: number;
      meta?: Record<string, unknown>;
    } = {}
  ) => {
    const station = requestedStationRef.current || currentRef.current;
    const activeCandidate = activeCandidateRef.current;
    reportClientEvent(name, {
      detail,
      dedupeKey,
      dedupeMs,
      meta: {
        playbackSession: playbackSessionRef.current,
        stationId: station?.stationuuid || null,
        stationName: station?.name || null,
        status: statusRef.current,
        isPlaying: isPlayingRef.current,
        activeCandidateMode: activeCandidate?.mode || null,
        activeCandidateFallback: Boolean(activeCandidate?.isFallback),
        candidateCount: candidatesRef.current.length,
        candidateIndex: candidateIndexRef.current,
        failureCount: candidateFailuresRef.current.length,
        ...(meta || {})
      }
    });
  };

  const clearReconnect = () => {
    if (reconnectRef.current.timer !== null) {
      window.clearTimeout(reconnectRef.current.timer);
    }
    reconnectRef.current = { timer: null, attempts: 0 };
  };

  const beginPlaybackSession = () => {
    playbackSessionRef.current += 1;
    return playbackSessionRef.current;
  };

  const isSessionCurrent = (sessionId: number) => playbackSessionRef.current === sessionId;

  const clearWaitingTimeout = () => {
    if (waitingTimeoutRef.current !== null) {
      window.clearTimeout(waitingTimeoutRef.current);
      waitingTimeoutRef.current = null;
    }
  };

  const syncAudioDiagnosticsData = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const activeCandidate = activeCandidateRef.current;
    audio.dataset.raTransportMode = activeCandidate?.mode || '';
    audio.dataset.raTransportFallback = activeCandidate?.isFallback ? 'true' : 'false';
    audio.dataset.raTransportUrl = activeCandidate?.sourceUrl || '';
    audio.dataset.raTransportCandidateCount = String(candidatesRef.current.length || 0);
    audio.dataset.raTransportCandidateIndex = String(candidateIndexRef.current);
  };

  const cleanupHls = () => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  };

  const applyEqToGraph = () => {
    const preampNode = preampGainRef.current;
    if (preampNode) {
      preampNode.gain.value = dbToGain(eqEnabled ? sliderToDb(eqPreamp) : 0);
    }
    eqFiltersRef.current.forEach((filter, index) => {
      filter.gain.value = eqEnabled ? sliderToDb(eqBands[index] ?? EQ_CENTER) : 0;
    });
  };

  const applyBalanceToGraph = () => {
    const pannerNode = stereoPannerRef.current;
    if (pannerNode) {
      pannerNode.pan.value = balanceToPan(balance);
    }
  };

  const ensureAudioGraph = () => {
    if (shouldUseLeanPlaybackMode()) return null;
    if (audioGraphFailedRef.current) return null;
    if (audioContextRef.current) return audioContextRef.current;

    const audio = audioRef.current;
    const AudioCtx =
      typeof window !== 'undefined'
        ? (window.AudioContext ||
            // @ts-expect-error legacy Safari
            window.webkitAudioContext)
        : undefined;

    if (!audio || !AudioCtx) {
      return null;
    }

    try {
      const context = new AudioCtx();
      const source = context.createMediaElementSource(audio);
      const preamp = context.createGain();
      const analyser = context.createAnalyser();
      const panner =
        typeof context.createStereoPanner === 'function' ? context.createStereoPanner() : null;
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.58;
      const filters = EQ_BANDS.map((frequency, index) => {
        const filter = context.createBiquadFilter();
        filter.frequency.value = frequency;
        filter.gain.value = 0;
        filter.Q.value = index === 0 || index === EQ_BANDS.length - 1 ? 0.7 : 1.05;
        filter.type =
          index === 0 ? 'lowshelf' : index === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
        return filter;
      });

      source.connect(preamp);
      let currentNode: AudioNode = preamp;
      filters.forEach((filter) => {
        currentNode.connect(filter);
        currentNode = filter;
      });
      currentNode.connect(analyser);
      if (panner) {
        analyser.connect(panner);
        panner.connect(context.destination);
      } else {
        analyser.connect(context.destination);
      }

      audioContextRef.current = context;
      mediaSourceRef.current = source;
      preampGainRef.current = preamp;
      stereoPannerRef.current = panner;
      eqFiltersRef.current = filters;
      analyserRef.current = analyser;
      // Graph can come up lazily mid-playback; reflect active immediately
      // and (re)start the demand-gated pump.
      setVisualizer({ active: isPlayingRef.current, available: true });
      visualizerControllerRef.current.start();
      return context;
    } catch (error) {
      audioGraphFailedRef.current = true;
      analyserRef.current = null;
      stereoPannerRef.current = null;
      setVisualizer({ active: false, available: false });
      visualizerControllerRef.current.stop();
      pushEvent(`eq: graph failed (${error instanceof Error ? error.message : 'unknown'})`);
      return null;
    }
  };

  const resumeAudioContext = async () => {
    const context = audioContextRef.current;
    if (!context || context.state !== 'suspended') return;
    try {
      await Promise.race([
        context.resume(),
        new Promise<void>((resolve) => window.setTimeout(resolve, AUDIO_CONTEXT_RESUME_TIMEOUT_MS))
      ]);
    } catch (error) {
      pushEvent(`eq: resume failed (${error instanceof Error ? error.message : 'unknown'})`);
    }
  };

  const attachSource = async (url: string, sessionId = playbackSessionRef.current) => {
    const audio = audioRef.current;
    if (!audio) return;

    cleanupHls();
    clearWaitingTimeout();
    candidateStartedAtRef.current = Date.now();
    candidateHasPlayedRef.current = false;
    pushEvent(`source: ${url}`);

    if (isHls(url) && !audio.canPlayType('application/vnd.apple.mpegurl')) {
      const mod = await import('hls.js/dist/hls.light.mjs');
      // The await above is the danger window: a station switch during the
      // import must NOT let this (now-stale) call attach to the shared <audio>.
      const hls = attachHlsIfCurrent(
        mod.default as unknown as HlsConstructor,
        audio,
        url,
        () => isSessionCurrent(sessionId)
      );
      if (!hls) {
        pushEvent('hls: superseded before attach');
        return;
      }
      hlsRef.current = hls;
      pushEvent('hls: attached');
    } else {
      if ('srcObject' in audio) {
        try {
          (audio as HTMLAudioElement & { srcObject?: MediaStream | null }).srcObject = null;
        } catch {
          // ignore browsers that do not allow resetting srcObject here
        }
      }
      audio.src = url;
      audio.load();
    }
  };

  const recordCandidateFailure = (
    url: string,
    error: string,
    phase: PlaybackFailurePhase
  ) => {
    const nextFailure = toPlaybackFailure(error, { url, phase });
    candidateFailuresRef.current = [...candidateFailuresRef.current, nextFailure].slice(-8);
    lastErrorRef.current = error;
    pushEvent(`playback: candidate failed (${phase}) ${url} :: ${error}`);
    reportPlaybackEvent('audio_candidate_failed', {
      detail: error,
      dedupeKey: `audio_candidate_failed:${playbackSessionRef.current}:${phase}:${url.split(/[?#]/, 1)[0]}`,
      dedupeMs: 15_000,
      meta: {
        phase,
        url: url.split(/[?#]/, 1)[0],
        failureKind: nextFailure.kind
      }
    });
    if (isHls(url)) {
      reportClientEvent('hls_error', {
        detail: error,
        dedupeKey: `hls_error:${phase}:${url.split(/[?#]/, 1)[0]}`,
        dedupeMs: 15_000,
        meta: {
          phase,
          url: url.split(/[?#]/, 1)[0]
        }
      });
    }
  };

  const playCandidateAtIndex = async (
    startIndex: number,
    sessionId = playbackSessionRef.current
  ): Promise<PlayCandidateResult> => {
    const audio = audioRef.current;
    if (!audio) {
      return { ok: false, error: 'Audio engine unavailable' };
    }

    if (!isSessionCurrent(sessionId)) {
      return { ok: false, error: PLAYBACK_SUPERSEDED, superseded: true };
    }

    const list = candidatesRef.current;
    if (startIndex < 0 || startIndex >= list.length) {
      return { ok: false, error: 'no playable candidate' };
    }

    let lastError = 'no playable candidate';
    for (let index = startIndex; index < list.length; index += 1) {
      if (!isSessionCurrent(sessionId)) {
        return { ok: false, error: PLAYBACK_SUPERSEDED, superseded: true };
      }
      const nextCandidate = list[index];
      const nextUrl = nextCandidate.url;
      candidateIndexRef.current = index;
      try {
        try {
          await attachSource(nextUrl, sessionId);
        } catch (error) {
          const attachError =
            error instanceof Error ? error.message : formatMediaError(audio) || 'attach failed';
          lastError = attachError;
          recordCandidateFailure(nextUrl, attachError, 'attach');
          continue;
        }
        if (!isSessionCurrent(sessionId)) {
          audio.pause();
          return { ok: false, error: PLAYBACK_SUPERSEDED, superseded: true };
        }
        if (!shouldUseLeanPlaybackMode() || shouldForceAudioGraph()) {
          ensureAudioGraph();
          applyEqToGraph();
          applyBalanceToGraph();
          await resumeAudioContext();
        }
        if (!isSessionCurrent(sessionId)) {
          audio.pause();
          return { ok: false, error: PLAYBACK_SUPERSEDED, superseded: true };
        }
        playPendingRef.current = true;
        try {
          await audio.play();
        } finally {
          playPendingRef.current = false;
          playPendingDeferralsRef.current = 0;
        }
        if (!isSessionCurrent(sessionId)) {
          audio.pause();
          return { ok: false, error: PLAYBACK_SUPERSEDED, superseded: true };
        }
        activeUrlRef.current = nextUrl;
        activeCandidateRef.current = nextCandidate;
        syncAudioDiagnosticsData();
        setErrorMessage(null);
        setPlaybackFailure(null);
        lastErrorRef.current = null;
        if (index > startIndex || nextCandidate.isFallback) {
          reportPlaybackEvent('audio_fallback_candidate', {
            detail: nextCandidate.label,
            dedupeKey: `audio_fallback_candidate:${sessionId}:${nextUrl.split(/[?#]/, 1)[0]}`,
            dedupeMs: 10_000,
            meta: {
              candidateIndex: index,
              candidateMode: nextCandidate.mode,
              fallback: nextCandidate.isFallback,
              sourceUrl: nextCandidate.sourceUrl.split(/[?#]/, 1)[0]
            }
          });
        }
        return {
          ok: true,
          activeCandidate: nextCandidate,
          startupMs: candidateStartedAtRef.current
            ? Date.now() - candidateStartedAtRef.current
            : null
        };
      } catch (error) {
        if (!isSessionCurrent(sessionId)) {
          return { ok: false, error: PLAYBACK_SUPERSEDED, superseded: true };
        }
        lastError =
          error instanceof Error ? error.message : formatMediaError(audio) || 'Playback failed';
        recordCandidateFailure(nextUrl, lastError, 'play');
      }
    }

    const normalizedFailure = toPlaybackFailure('no playable candidate', {
      blockedMixedContent: candidatePlanRef.current.blockedMixedContent,
      apiUnavailable: candidatePlanRef.current.apiUnavailable
    });
    setStatus('error');
    setIsPlaying(false);
    setPlaybackFailure(normalizedFailure);
    setErrorMessage(normalizedFailure.message);
    return { ok: false, error: normalizedFailure.message };
  };

  const tryNextCandidate = async (sessionId = playbackSessionRef.current) => {
    if (!isSessionCurrent(sessionId)) {
      return false;
    }
    const list = candidatesRef.current;
    if (candidateIndexRef.current >= list.length - 1) {
      return false;
    }
    const result = await playCandidateAtIndex(candidateIndexRef.current + 1, sessionId);
    return result.ok;
  };

  const scheduleReconnect = (sessionId = playbackSessionRef.current) => {
    const audio = audioRef.current;
    if (
      !audio ||
      (!requestedStationRef.current && !currentRef.current) ||
      reconnectRef.current.timer !== null ||
      !isSessionCurrent(sessionId)
    ) {
      return;
    }

    reconnectRef.current.attempts += 1;
    const delay = Math.min(15000, 2000 * reconnectRef.current.attempts);
    reportPlaybackEvent('audio_reconnect_scheduled', {
      detail: String(reconnectRef.current.attempts),
      dedupeKey: `audio_reconnect_scheduled:${sessionId}:${reconnectRef.current.attempts}`,
      dedupeMs: 2_000,
      meta: {
        attempt: reconnectRef.current.attempts,
        delayMs: delay
      }
    });
    reconnectRef.current.timer = window.setTimeout(async () => {
      reconnectRef.current.timer = null;
      if (!isSessionCurrent(sessionId)) {
        return;
      }
      try {
        const result = await playCandidateAtIndex(0, sessionId);
        if (!result.ok) {
          throw new Error(result.error || 'reconnect failed');
        }
        reportPlaybackEvent('audio_reconnect_recovered', {
          dedupeKey: `audio_reconnect_recovered:${sessionId}:${reconnectRef.current.attempts}`,
          dedupeMs: 5_000,
          meta: {
            attempt: reconnectRef.current.attempts
          }
        });
      } catch {
        if (isSessionCurrent(sessionId)) {
          scheduleReconnect(sessionId);
        }
      }
    }, delay);
  };

  const setEqBand = (index: number, value: number) => {
    setEqBands((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const nextValue = clampPercent(value);
      if (Math.abs((prev[index] ?? EQ_CENTER) - nextValue) < 0.01) {
        return prev;
      }
      const next = [...prev];
      next[index] = nextValue;
      return next;
    });
  };

  const resetEq = () => {
    setEqEnabled(true);
    setEqPreamp(EQ_CENTER);
    setEqBands(createDefaultEqBands());
  };

  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    const audio =
      typeof document !== 'undefined' ? document.createElement('audio') : new Audio();
    const leanPlayback = shouldUseLeanPlaybackMode();
    audio.preload = leanPlayback ? 'none' : 'auto';
    audio.controls = false;
    if (!leanPlayback) {
      audio.crossOrigin = 'anonymous';
    }
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('webkit-playsinline', 'true');
    audio.setAttribute('autoplay', 'false');
    if (audio instanceof HTMLAudioElement) {
      audio.className = 'audio-hidden';
      document.body.appendChild(audio);
    }
    audioRef.current = audio;
    if (shouldForceAudioGraph()) {
      ensureAudioGraph();
    }
    if (leanPlayback) {
      pushEvent('audio: lean playback mode enabled');
      reportPlaybackEvent('audio_lean_playback_mode', {
        dedupeKey: 'audio_lean_playback_mode'
      });
    }

    const handlePlaying = () => {
      const requestedStation = requestedStationRef.current;
      candidateHasPlayedRef.current = true;
      lastProgressRef.current = { time: audio.currentTime || 0, at: Date.now() };
      if (requestedStation) {
        setCurrent((prev) =>
          prev?.stationuuid === requestedStation.stationuuid ? prev : requestedStation
        );
      }
      // On air now, so the waiting state has nothing left to hold.
      setPending(null);
      setStatus('playing');
      setIsPlaying(true);
      setErrorMessage(null);
      lastErrorRef.current = null;
      clearReconnect();
      clearWaitingTimeout();
      pushEvent('audio: playing');
      reportPlaybackEvent('audio_playing', {
        dedupeKey: `audio_playing:${playbackSessionRef.current}:${requestedStation?.stationuuid || currentRef.current?.stationuuid || 'unknown'}`,
        dedupeMs: 4_000
      });
      if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
        try {
          // Live radio streams report Infinity/NaN duration — never advertise a
          // finite length to the OS, or the lock screen renders a bogus seek bar
          // (and the old hardcoded `duration: 0` did exactly that). Publish a
          // position state ONLY for genuinely finite media; for live streams,
          // leave it unset.
          if (Number.isFinite(audio.duration) && audio.duration > 0) {
            navigator.mediaSession.setPositionState({
              duration: audio.duration,
              playbackRate: audio.playbackRate || 1,
              position: audio.currentTime || 0
            });
          }
        } catch {
          // ignore
        }
      }
    };
    const handlePause = () => {
      setIsPlaying(false);
      if (requestedStationRef.current || currentRef.current) {
        setStatus((prev) => (prev === 'error' ? prev : 'paused'));
      }
      pushEvent('audio: pause');
    };
    const handleTimeUpdate = () => {
      const now = audio.currentTime || 0;
      // Surrender: the stream is demonstrably producing audio, so nothing is
      // owed. Position movement, not a `playing` event — an event fires when
      // the element THINKS it started, which is the distinction that made two
      // production checks lie tonight.
      if (backgroundResumeEligibleRef.current && now > lastProgressRef.current.time) {
        backgroundResumeEligibleRef.current = false;
      }
      // Any real position MOVEMENT means the stream is alive (abs, not just >, so
      // an HLS live-edge reset still counts). Flat currentTime while unpaused for
      // STALL_WATCHDOG_THRESHOLD_MS is a silent stall the watchdog recovers.
      if (Math.abs(now - lastProgressRef.current.time) > 0.05) {
        lastProgressRef.current = { time: now, at: Date.now() };
      }
      setCurrentTime(now);
    };
    const handleWaiting = () => {
      // A manually paused element (user pause, sleep-timer, or headphone-unplug —
      // all call pause() without bumping the session or clearing the refs) can
      // still emit 'waiting'/'stalled' when its buffer goes idle. Without this
      // guard the rebuffer timer below would fire tryNextCandidate → audio.play()
      // and silently RESUME the stream the user just paused (and, after a
      // headphone unplug, blast it through the phone speaker). Mirror the
      // `!audio.paused` guard handleVisibility already uses: never act on a
      // buffering event while paused. After audio.play() the element is NOT
      // paused even during startup buffering, so this only bails on a real pause.
      if (audio.paused) {
        pushEvent('audio: waiting (ignored, paused)');
        return;
      }
      const activeSession = playbackSessionRef.current;
      if (requestedStationRef.current || currentRef.current) {
        setStatus('buffering');
        clearWaitingTimeout();
        const elapsedSinceAttach = candidateStartedAtRef.current
          ? Date.now() - candidateStartedAtRef.current
          : 0;
        const timeoutMs = candidateHasPlayedRef.current
          ? REBUFFER_GRACE_MS
          : Math.max(4000, STARTUP_BUFFER_GRACE_MS - elapsedSinceAttach);
        waitingTimeoutRef.current = window.setTimeout(() => {
          waitingTimeoutRef.current = null;
          // Never tear down a play() that is still in flight — that is the
          // AbortError which used to be reported as a dead station.
          const decision = decideCandidateSwitch({
            playPending: playPendingRef.current,
            deferrals: playPendingDeferralsRef.current
          });
          if (decision.action === 'defer') {
            playPendingDeferralsRef.current = decision.deferrals;
            pushEvent('audio: play still pending, holding the candidate switch');
            waitingTimeoutRef.current = window.setTimeout(
              () => audio.dispatchEvent(new Event('waiting')),
              decision.recheckMs
            );
            return;
          }
          playPendingDeferralsRef.current = 0;
          if ((requestedStationRef.current || currentRef.current) && isSessionCurrent(activeSession)) {
            tryNextCandidate(activeSession).then((switched) => {
              if ((!requestedStationRef.current && !currentRef.current) || !isSessionCurrent(activeSession)) {
                return;
              }
              if (switched) {
                pushEvent('audio: prolonged buffering, switched candidate');
                reportPlaybackEvent('audio_buffering_candidate_switch', {
                  dedupeKey: `audio_buffering_candidate_switch:${activeSession}`,
                  dedupeMs: 5_000
                });
                return;
              }
              pushEvent('audio: prolonged buffering, reconnecting...');
              reportPlaybackEvent('audio_buffering_reconnect', {
                dedupeKey: `audio_buffering_reconnect:${activeSession}`,
                dedupeMs: 5_000
              });
              scheduleReconnect(activeSession);
            });
          }
        }, timeoutMs);
      }
      pushEvent('audio: waiting');
    };
    const handleError = () => {
      const activeSession = playbackSessionRef.current;
      const activeUrl =
        activeUrlRef.current || candidatesRef.current[candidateIndexRef.current]?.url || 'unknown';
      recordCandidateFailure(
        activeUrl,
        formatMediaError(audio) || 'runtime playback error',
        'runtime'
      );
      if (requestedStationRef.current || currentRef.current) {
        tryNextCandidate(activeSession).then((switched) => {
          if (!isSessionCurrent(activeSession)) {
            return;
          }
          if (!switched) {
            requestedStationRef.current = null;
            setCurrent(null);
            setPending(null);
            setStatus('error');
            setIsPlaying(false);
            const finalFailure = toPlaybackFailure('no playable candidate', {
              blockedMixedContent: candidatePlanRef.current.blockedMixedContent,
              apiUnavailable: candidatePlanRef.current.apiUnavailable
            });
            setPlaybackFailure(finalFailure);
            setErrorMessage(finalFailure.message);
            if (finalFailure.kind === 'no-playable-candidate') {
              scheduleReconnect(activeSession);
            }
          }
        });
      }
      pushEvent('audio: error');
    };
    const handleEnded = () => {
      const activeSession = playbackSessionRef.current;
      if (requestedStationRef.current || currentRef.current) {
        setStatus('buffering');
        setIsPlaying(false);
        tryNextCandidate(activeSession).then((switched) => {
          if (!isSessionCurrent(activeSession) || (!requestedStationRef.current && !currentRef.current)) {
            return;
          }
          if (!switched) {
            scheduleReconnect(activeSession);
          }
        });
      }
      pushEvent('audio: ended');
    };

    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('stalled', handleWaiting);
    audio.addEventListener('error', handleError);
    audio.addEventListener('ended', handleEnded);

    // Silent-stall watchdog (see STALL_WATCHDOG_* above): catches streams that go
    // quiet WITHOUT firing waiting/stalled/error/ended, which the event-driven
    // recovery would otherwise miss entirely.
    const stallWatchdog = window.setInterval(() => {
      const position = audio.currentTime || 0;
      // Same epsilon and reasoning as handleTimeUpdate: real position MOVEMENT
      // means the stream is alive. Reading it here rather than trusting the
      // `timeupdate`-driven clock is what makes the watchdog safe across a
      // backgrounded tab, where those events stop arriving but playback does not.
      const positionMoved = Math.abs(position - lastProgressRef.current.time) > 0.05;
      if (positionMoved) {
        lastProgressRef.current = { time: position, at: Date.now() };
      }
      const shouldRecover = shouldRecoverFromSilentStall({
        paused: audio.paused,
        hasPlayed: candidateHasPlayedRef.current,
        hasStation: Boolean(requestedStationRef.current || currentRef.current),
        recovering: waitingTimeoutRef.current !== null || reconnectRef.current.timer !== null,
        status: statusRef.current,
        positionMoved,
        msSinceProgress: Date.now() - lastProgressRef.current.at
      });
      if (!shouldRecover) return;
      const activeSession = playbackSessionRef.current;
      // Re-arm so we don't re-fire every tick while recovery is in flight.
      lastProgressRef.current = { time: audio.currentTime || 0, at: Date.now() };
      pushEvent('audio: silent stall (no progress) — recovering same station');
      reportPlaybackEvent('audio_silent_stall', {
        dedupeKey: `audio_silent_stall:${activeSession}`,
        dedupeMs: 5_000
      });
      setStatus('buffering');
      tryNextCandidate(activeSession).then((switched) => {
        if (!isSessionCurrent(activeSession) || (!requestedStationRef.current && !currentRef.current)) return;
        if (!switched) scheduleReconnect(activeSession);
      });
    }, STALL_WATCHDOG_INTERVAL_MS);

    /*
     * `audio_background_resume_attempt` only ever recorded that we WENT to the
     * background. Whether playback then survived was never recorded at all —
     * which is why "how well does the web build hold background playback" has
     * been unanswerable, and that is the one question deciding whether a native
     * app is worth building (a TWA would not change it: it is the same web
     * engine). Prod, 24 h to 2026-08-26: 11 backgroundings, 3 silent stalls, and
     * nothing linking the two.
     */
    const reportBackgroundOutcome = () => {
      const marker = backgroundedRef.current;
      backgroundedRef.current = null;
      if (!marker) return;
      // Somebody started a different station while we were away; the question no
      // longer has an answer, and guessing one would poison the counter.
      if (marker.session !== playbackSessionRef.current) return;

      const hiddenMs = Date.now() - marker.at;
      const advancedMs = ((audio.currentTime || 0) - marker.position) * 1000;
      const verdict = judgeBackgroundPlayback({ paused: audio.paused, hiddenMs, advancedMs });

      // The token is granted BEFORE the `unknown` early-return, which is the
      // whole point: `unknown` only means the background was too short to
      // classify, NOT that the stream is healthy. The OS can kill a socket in
      // five seconds, and this is the only place that still knows we were
      // playing when the app went away.
      //
      // `survived` is the one verdict that surrenders it: the audio measurably
      // advanced, so there is nothing to recover.
      if (marker.wasPlaying && verdict !== 'survived') {
        backgroundResumeEligibleRef.current = true;
      } else if (verdict === 'survived') {
        backgroundResumeEligibleRef.current = false;
      }

      if (verdict === 'unknown') return;

      // Two call sites rather than one with a ternary name, and that is load
      // bearing. The API's allow-list guard scans these sources for a quoted
      // event name sitting directly inside the report call, so a computed name
      // reads as "not emitted by the web app" and fails the build. Do not tidy
      // this into one call: the events would then be answered 400 and lost.
      // (Nor spell the scanned pattern out in a comment — it gets picked up as
      // an event name of its own. Both mistakes were made getting this in.)
      const outcome = {
        dedupeKey: `audio_background_outcome:${marker.session}:${marker.at}`,
        dedupeMs: 5_000,
        meta: {
          hiddenSeconds: Math.round(hiddenMs / 1000),
          advancedSeconds: Math.round(advancedMs / 1000)
        }
      };
      if (verdict === 'survived') {
        reportPlaybackEvent('audio_background_survived', outcome);
      } else {
        reportPlaybackEvent('audio_background_died', outcome);
      }

      // ⚠ Deliberately NOT forcing a pause here on `died`.
      //
      // When the OS paused the element, `handlePause` has already produced the
      // honest state — status 'paused', a play control pointing at the same
      // station — which is exactly the UI this lane wants. Nothing to add.
      //
      // When the element still reports playing, `died` is a HEURISTIC: position
      // advanced less than half the hidden time. Tearing down audio on that
      // reading is what the silent-stall watchdog already did once, on a stream
      // that was fine, because nobody had told it the clock stops when the
      // screen does (see `shouldRecoverFromSilentStall`). That watchdog now
      // judges from position movement and is the right owner of a genuinely
      // stalled stream. Doing it a second time from here would re-create the
      // same bug with a new name.
      //
      // So the recovery is offered, never imposed: the token above lets the
      // listener's own next tap reconnect.
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden' && !audio.paused) {
        // Remember where the stream was, so the return can tell whether it kept
        // going. Position and not wall clock, for the reason above.
        backgroundedRef.current = {
          position: audio.currentTime || 0,
          at: Date.now(),
          session: playbackSessionRef.current,
          wasPlaying: true
        };
        reportPlaybackEvent('audio_background_resume_attempt', {
          dedupeKey: `audio_background_resume_attempt:${playbackSessionRef.current}`,
          dedupeMs: 5_000,
          meta: {
            visibility: 'hidden'
          }
        });
        audio.play().catch(() => {});
      } else {
        if (document.visibilityState === 'visible') reportBackgroundOutcome();
        reportPlaybackEvent('audio_visibility_change', {
          dedupeKey: `audio_visibility_change:${playbackSessionRef.current}:${document.visibilityState}`,
          dedupeMs: 5_000,
          meta: {
            visibility: document.visibilityState
          }
        });
      }
      pushEvent(`visibility: ${document.visibilityState}`);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    document.addEventListener('pointerdown', resumeAudioContext, { passive: true });
    document.addEventListener('keydown', resumeAudioContext);

    return () => {
      window.clearInterval(stallWatchdog);
      audio.pause();
      if ('srcObject' in audio) {
        try {
          (audio as HTMLAudioElement & { srcObject?: MediaStream | null }).srcObject = null;
        } catch {
          // ignore
        }
      }
      audio.src = '';
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('stalled', handleWaiting);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('ended', handleEnded);
      document.removeEventListener('visibilitychange', handleVisibility);
      document.removeEventListener('pointerdown', resumeAudioContext);
      document.removeEventListener('keydown', resumeAudioContext);
      cleanupHls();
      mediaSourceRef.current?.disconnect();
      mediaSourceRef.current = null;
      preampGainRef.current?.disconnect();
      preampGainRef.current = null;
      eqFiltersRef.current.forEach((filter) => filter.disconnect());
      eqFiltersRef.current = [];
      stereoPannerRef.current?.disconnect();
      stereoPannerRef.current = null;
      analyserRef.current?.disconnect();
      analyserRef.current = null;
      if (visualizerFrameRef.current !== null) {
        window.cancelAnimationFrame(visualizerFrameRef.current);
        visualizerFrameRef.current = null;
      }
      if (audioContextRef.current) {
        void audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      setVisualizer({ active: false, available: false });
      if (audio instanceof HTMLAudioElement) {
        audio.remove();
      }
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.dataset.raBalance = String(Math.round(balance));
  }, [balance]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.dataset.raEqEnabled = eqEnabled ? 'true' : 'false';
    audio.dataset.raEqPreamp = String(Math.round(eqPreamp));
    audio.dataset.raEqBands = eqBands.map((value) => Math.round(value)).join(',');
    audio.dataset.raEqFrequencies = EQ_BANDS.join(',');
  }, [eqBands, eqEnabled, eqPreamp]);

  useEffect(() => {
    if (shouldUseLeanPlaybackMode()) {
      return;
    }
    if (!audioContextRef.current && !shouldForceAudioGraph()) {
      return;
    }
    ensureAudioGraph();
    applyEqToGraph();
  }, [eqBands, eqEnabled, eqPreamp]);

  useEffect(() => {
    if (shouldUseLeanPlaybackMode()) {
      return;
    }
    if (!audioContextRef.current && !shouldForceAudioGraph()) {
      return;
    }
    ensureAudioGraph();
    applyBalanceToGraph();
  }, [balance]);

  // Ref-based visualizer pump. Buffers are allocated once and filled in
  // place each frame, then pushed to subscribers directly — no React
  // state per frame, so PlaybackRuntime no longer re-renders ~30x/s. The
  // loop is demand-gated: it runs only while a subscriber is attached and
  // playback is live. With no subscriber (the current default — the
  // milkdrop overlay is dormant) it never starts. (T2.1)
  useEffect(() => {
    const spectrum = new Float32Array(VISUALIZER_BARS);
    const waveform = new Float32Array(VISUALIZER_WAVEFORM_SAMPLES);
    const frame: VisualizerFrame = { spectrum, waveform };
    // Reused in place across frames; reallocated only if the analyser
    // resolution changes (it doesn't — fftSize is fixed at graph build).
    let frequencyBytes = new Uint8Array(0);
    let waveformBytes = new Uint8Array(0);
    let lastFrameAt = 0;

    const draw = (now: number) => {
      const analyser = analyserRef.current;
      if (!analyser || !isPlayingRef.current || visualizerSubscribersRef.current.size === 0) {
        visualizerFrameRef.current = null;
        return;
      }
      if (now - lastFrameAt >= 32) {
        lastFrameAt = now;
        if (frequencyBytes.length !== analyser.frequencyBinCount) {
          frequencyBytes = new Uint8Array(analyser.frequencyBinCount);
        }
        if (waveformBytes.length !== analyser.fftSize) {
          waveformBytes = new Uint8Array(analyser.fftSize);
        }
        analyser.getByteFrequencyData(frequencyBytes);
        analyser.getByteTimeDomainData(waveformBytes);

        for (let index = 0; index < VISUALIZER_BARS; index += 1) {
          const start = Math.floor((index * frequencyBytes.length) / VISUALIZER_BARS);
          const end = Math.max(
            start + 1,
            Math.floor(((index + 1) * frequencyBytes.length) / VISUALIZER_BARS)
          );
          let peak = 0;
          for (let cursor = start; cursor < end; cursor += 1) {
            peak = Math.max(peak, frequencyBytes[cursor] ?? 0);
          }
          const normalizedPeak = peak / 255;
          const emphasized = Math.pow(normalizedPeak, 0.62);
          const lowBandBoost = 1 + Math.max(0, 0.28 - index * 0.012);
          spectrum[index] = Math.min(1, emphasized * lowBandBoost);
        }
        for (let index = 0; index < VISUALIZER_WAVEFORM_SAMPLES; index += 1) {
          const sourceIndex = Math.floor(
            (index * waveformBytes.length) / VISUALIZER_WAVEFORM_SAMPLES
          );
          waveform[index] = ((waveformBytes[sourceIndex] ?? 128) - 128) / 128;
        }
        visualizerSubscribersRef.current.forEach((callback) => callback(frame));
      }
      visualizerFrameRef.current = window.requestAnimationFrame(draw);
    };

    const start = () => {
      if (visualizerFrameRef.current !== null) return;
      if (
        !analyserRef.current ||
        !isPlayingRef.current ||
        visualizerSubscribersRef.current.size === 0
      ) {
        return;
      }
      lastFrameAt = 0;
      visualizerFrameRef.current = window.requestAnimationFrame(draw);
    };
    const stop = () => {
      if (visualizerFrameRef.current !== null) {
        window.cancelAnimationFrame(visualizerFrameRef.current);
        visualizerFrameRef.current = null;
      }
    };

    visualizerControllerRef.current = { start, stop };
    return () => stop();
  }, []);

  // active/available is low-frequency state (play/pause, graph ready), not
  // per-frame. This effect also (re)starts or stops the pump.
  useEffect(() => {
    const available = Boolean(analyserRef.current);
    const active = available && isPlaying;
    setVisualizer({ active, available });
    if (active) {
      visualizerControllerRef.current.start();
    } else {
      visualizerControllerRef.current.stop();
    }
  }, [isPlaying]);

  const subscribeVisualizer = useCallback((callback: VisualizerSubscriber) => {
    visualizerSubscribersRef.current.add(callback);
    visualizerControllerRef.current.start();
    return () => {
      visualizerSubscribersRef.current.delete(callback);
      if (visualizerSubscribersRef.current.size === 0) {
        visualizerControllerRef.current.stop();
      }
    };
  }, []);

  const playStation = async (station: StationLite): Promise<PlayStationResult> => {
    const audio = audioRef.current;
    if (!audio) {
      return {
        ok: false,
        error: 'Audio engine unavailable'
      };
    }
    const playbackSession = beginPlaybackSession();

    clearReconnect();
    cleanupHls();
    clearWaitingTimeout();
    activeUrlRef.current = null;
    activeCandidateRef.current = null;
    lastErrorRef.current = null;
    candidateFailuresRef.current = [];
    requestedStationRef.current = null;
    setErrorMessage(null);
    setPlaybackFailure(null);

    audio.pause();
    if ('srcObject' in audio) {
      try {
        (audio as HTMLAudioElement & { srcObject?: MediaStream | null }).srcObject = null;
      } catch {
        // ignore
      }
    }
    audio.removeAttribute('src');
    audio.currentTime = 0;
    setCurrentTime(0);
    audio.load();

    let resolvedStation = station;
    const sourceUrls: string[] = [];
    buildStationStreamTargets(station).forEach((url) => pushUnique(sourceUrls, url));
    const apiBase = normalizeBase(getApiBase());
    apiBaseRef.current = apiBase;
    // T_share_fix: an http:// stream on a secure page can only play via the
    // proxy, which buildCandidates now always includes when apiBase is set. So
    // the 2.2s availability check can't change the outcome for this case —
    // skip the await so a shared deep-link plays instantly instead of stalling
    // on a cold-mount race against /health (the prod symptom: launch → 2.2s →
    // [or never]). https streams still run the check (proxy-vs-direct pref).
    const isSecureContext = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const httpProxyMandatory =
      Boolean(apiBase) && isSecureContext && sourceUrls.some((url) => url.startsWith('http://'));
    const shouldCheckApi =
      Boolean(apiBase) && !httpProxyMandatory && needsApiAssist(station, sourceUrls);
    const apiAvailable = shouldCheckApi
      ? await checkApiAvailability(apiBase, { timeoutMs: 2_200 })
      : false;
    if (!isSessionCurrent(playbackSession)) {
      return { ok: false, error: PLAYBACK_SUPERSEDED };
    }
    if (shouldCheckApi && apiBase && !apiAvailable) {
      pushEvent('api: unavailable');
      markApiUnavailable(apiBase);
      reportPlaybackEvent('audio_api_unavailable', {
        dedupeKey: `audio_api_unavailable:${apiBase}`,
        dedupeMs: 30_000,
        meta: {
          apiBase
        }
      });
    }

    requestedStationRef.current = resolvedStation;
    setCurrent(null);
    // The bar keeps showing THIS station while it connects.
    setPending(resolvedStation);
    setStatus('buffering');
    setIsPlaying(false);
    const plans = sourceUrls.map((sourceUrl) =>
      buildCandidates({
        url: sourceUrl,
        apiBase,
        apiAvailable: shouldCheckApi ? apiAvailable : false
      })
    );
    const mergedCandidates: PlaybackCandidate[] = [];
    plans.forEach((plan) => {
      plan.candidates.forEach((candidate) => {
        if (!mergedCandidates.some((item) => item.url === candidate.url)) {
          mergedCandidates.push(candidate);
        }
      });
    });
    const candidatePlan: CandidatePlan = {
      candidates: mergedCandidates,
      blockedMixedContent:
        mergedCandidates.length === 0 && plans.some((plan) => plan.blockedMixedContent),
      apiUnavailable: mergedCandidates.length === 0 && plans.some((plan) => plan.apiUnavailable)
    };
    candidatePlanRef.current = candidatePlan;
    candidatesRef.current = candidatePlan.candidates;
    candidateIndexRef.current = 0;
    syncAudioDiagnosticsData();
    if (!candidatesRef.current.length) {
      if (!isSessionCurrent(playbackSession)) {
        return { ok: false, error: PLAYBACK_SUPERSEDED };
      }
      requestedStationRef.current = null;
      const failure = toPlaybackFailure('no playable candidate', {
        blockedMixedContent: candidatePlan.blockedMixedContent,
        apiUnavailable: candidatePlan.apiUnavailable
      });
      setStatus('error');
      setPlaybackFailure(failure);
      setErrorMessage(failure.message);
      reportPlaybackEvent('audio_no_playable_candidate', {
        detail: failure.message,
        dedupeKey: `audio_no_playable_candidate:${playbackSession}:${candidatePlan.blockedMixedContent ? 'mixed' : 'direct'}:${candidatePlan.apiUnavailable ? 'api' : 'online'}`,
        dedupeMs: 10_000,
        meta: {
          blockedMixedContent: candidatePlan.blockedMixedContent,
          apiUnavailable: candidatePlan.apiUnavailable,
          sourceCount: sourceUrls.length
        }
      });
      return { ok: false, error: failure.message };
    }

    const result = await playCandidateAtIndex(0, playbackSession);
    if (result.superseded || result.error === PLAYBACK_SUPERSEDED) {
      return { ok: false, error: PLAYBACK_SUPERSEDED };
    }
    if (!result.ok) {
      requestedStationRef.current = null;
      const failure = toPlaybackFailure(result.error || lastErrorRef.current || 'no playable candidate', {
        blockedMixedContent: candidatePlan.blockedMixedContent,
        apiUnavailable: candidatePlan.apiUnavailable
      });
      setStatus('error');
      setPlaybackFailure(failure);
      setErrorMessage(failure.message);
      return { ok: false, error: failure.message, station: resolvedStation };
    }

    return {
      ok: true,
      station: resolvedStation,
      activeCandidate: result.activeCandidate ?? activeCandidateRef.current,
      startupMs: result.startupMs ?? null
    };
  };

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio || !current) return false;

    const nativeState = audio.getAttribute('data-ra-state');
    if (isPlaying || nativeState === 'playing' || !audio.paused) {
      clearReconnect();
      clearWaitingTimeout();
      // Surrender: pausing on purpose cancels any recovery this return owed.
      // Stated positively here rather than inferred later from "the pause was
      // not ours", which is the same fact carried by a flag that has to stay
      // correct across every future cycle.
      backgroundResumeEligibleRef.current = false;
      audio.pause();
      return true;
    }

    try {
      // ⚠ A resume that this foreground return owes must RECONNECT, not
      // `.play()`. The branch below only reattaches when `audio.src` is empty,
      // and after a background death the src string is still set while the
      // socket is gone — so a bare `.play()` resumes a corpse, which is the
      // defect this lane was opened for.
      //
      // Same station, always: `playCandidateAtIndex` walks the CURRENT
      // station's own stream candidates. It cannot reach the queue, the feed,
      // or another station.
      if (backgroundResumeEligibleRef.current) {
        backgroundResumeEligibleRef.current = false;
        const resumed = await playCandidateAtIndex(
          candidateIndexRef.current,
          playbackSessionRef.current
        );
        return resumed.ok;
      }
      if (!audio.src) {
        const result = await playCandidateAtIndex(
          candidateIndexRef.current,
          playbackSessionRef.current
        );
        return result.ok;
      }
      if (!shouldUseLeanPlaybackMode() || shouldForceAudioGraph()) {
        ensureAudioGraph();
        applyEqToGraph();
        applyBalanceToGraph();
        await resumeAudioContext();
      }
      await audio.play();
      return true;
    } catch (error) {
      pushEvent(`audio: resume failed (${error instanceof Error ? error.message : 'unknown'})`);
      setStatus('error');
      setIsPlaying(false);
      setErrorMessage('no playable candidate');
      return false;
    }
  };

  // Pause without tearing down the stream — keeps the current station loaded so a
  // tap on play resumes it. Used by the sleep timer and the headphone-unplug guard
  // (an explicit, intent-revealing pause vs. the toggle()/stop() paths).
  const pause = () => {
    const audio = audioRef.current;
    if (!audio) return;
    clearReconnect();
    clearWaitingTimeout();
    audio.pause();
  };

  const stop = () => {
    const audio = audioRef.current;
    if (!audio) return;
    beginPlaybackSession();
    audio.pause();
    if ('srcObject' in audio) {
      try {
        (audio as HTMLAudioElement & { srcObject?: MediaStream | null }).srcObject = null;
      } catch {
        // ignore
      }
    }
    audio.removeAttribute('src');
    audio.currentTime = 0;
    setCurrentTime(0);
    cleanupHls();
    clearReconnect();
    clearWaitingTimeout();
    activeUrlRef.current = null;
    activeCandidateRef.current = null;
    syncAudioDiagnosticsData();
    lastErrorRef.current = null;
    requestedStationRef.current = null;
    setCurrent(null);
    setPending(null);
    setIsPlaying(false);
    setStatus('idle');
    setErrorMessage(null);
    setPlaybackFailure(null);
  };

  return {
    current,
    pending,
    status,
    isPlaying,
    failure: playbackFailure,
    volume,
    balance,
    currentTime,
    eq: {
      enabled: eqEnabled,
      preamp: eqPreamp,
      bands: eqBands
    } as PlayerEqState,
    visualizer,
    subscribeVisualizer,
    errorMessage,
    transport: {
      activeCandidate: activeCandidateRef.current,
      recentFailures: candidateFailuresRef.current
    } as {
      activeCandidate: PlaybackCandidate | null;
      recentFailures: PlaybackFailure[];
    },
    setVolume,
    setBalance: (value: number) => setBalance(clampBalance(value)),
    setEqBand,
    setEqEnabled,
    setEqPreamp: (value: number) => setEqPreamp(clampPercent(value)),
    resetEq,
    playStation,
    toggle,
    pause,
    stop
  };
};
