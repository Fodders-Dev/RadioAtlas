import { useEffect, useRef, useState } from 'react';
import type { PlaybackCandidate, PlaybackFailure, PlaybackFailurePhase } from '../domain/contracts';
import type { StationLite } from '../types';
import { getApiBase } from './apiBase';
import { checkApiAvailability, markApiUnavailable } from './apiAvailability';
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
  spectrum: number[];
  waveform: number[];
};

type PlayStationResult = {
  ok: boolean;
  error?: string;
  station?: StationLite;
};

type PlayCandidateResult = {
  ok: boolean;
  error?: string;
  superseded?: boolean;
};

type ReconnectState = {
  timer: number | null;
  attempts: number;
};

type CandidatePlan = ReturnType<typeof buildCandidates>;

const EQ_CENTER = 50;
const EQ_RANGE_DB = 12;
const VISUALIZER_BARS = 24;
const VISUALIZER_WAVEFORM_SAMPLES = 24;
const PLAYBACK_SUPERSEDED = 'playback superseded';
const STARTUP_BUFFER_GRACE_MS = 15000;
const REBUFFER_GRACE_MS = 6000;

const normalizeBase = (value?: string) => (value ? value.replace(/\/+$/, '') : '');
const clampPercent = (value: number) => Math.min(100, Math.max(0, value));
const clampBalance = (value: number) => Math.min(100, Math.max(-100, value));
const sliderToDb = (value: number) => ((clampPercent(value) - EQ_CENTER) / EQ_CENTER) * EQ_RANGE_DB;
const dbToGain = (value: number) => 10 ** (value / 20);
const balanceToPan = (value: number) => clampBalance(value) / 100;
const createDefaultEqBands = () => EQ_BANDS.map(() => EQ_CENTER);
const createEmptySpectrum = () => Array.from({ length: VISUALIZER_BARS }, () => 0);
const createEmptyWaveform = () => Array.from({ length: VISUALIZER_WAVEFORM_SAMPLES }, () => 0);
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

export const useAudioPlayer = ({
  onEvent
}: {
  onEvent?: (message: string) => void;
} = {}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  const reconnectRef = useRef<ReconnectState>({ timer: null, attempts: 0 });
  const waitingTimeoutRef = useRef<number | null>(null);
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
  const playbackSessionRef = useRef(0);
  const candidateStartedAtRef = useRef(0);
  const candidateHasPlayedRef = useRef(false);

  const [current, setCurrent] = useState<StationLite | null>(null);
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
    available: false,
    spectrum: createEmptySpectrum(),
    waveform: createEmptyWaveform()
  });

  const pushEvent = (message: string) => {
    if (onEvent) onEvent(message);
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
      setVisualizer((prev) => ({
        ...prev,
        available: true
      }));
      return context;
    } catch (error) {
      audioGraphFailedRef.current = true;
      analyserRef.current = null;
      stereoPannerRef.current = null;
      setVisualizer({
        active: false,
        available: false,
        spectrum: createEmptySpectrum(),
        waveform: createEmptyWaveform()
      });
      pushEvent(`eq: graph failed (${error instanceof Error ? error.message : 'unknown'})`);
      return null;
    }
  };

  const resumeAudioContext = async () => {
    const context = audioContextRef.current;
    if (!context || context.state !== 'suspended') return;
    try {
      await context.resume();
    } catch (error) {
      pushEvent(`eq: resume failed (${error instanceof Error ? error.message : 'unknown'})`);
    }
  };

  const attachSource = async (url: string) => {
    const audio = audioRef.current;
    if (!audio) return;

    cleanupHls();
    clearWaitingTimeout();
    candidateStartedAtRef.current = Date.now();
    candidateHasPlayedRef.current = false;
    pushEvent(`source: ${url}`);

    if (isHls(url) && !audio.canPlayType('application/vnd.apple.mpegurl')) {
      const mod = await import('hls.js/dist/hls.light.mjs');
      const hls = new mod.default({
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
      });
      hls.loadSource(url);
      hls.attachMedia(audio);
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
    if (isHls(url)) {
      reportClientEvent('hls_error', `hls_error:${phase}:${url.split(/[?#]/, 1)[0]}`);
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
          await attachSource(nextUrl);
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
        await audio.play();
        if (!isSessionCurrent(sessionId)) {
          audio.pause();
          return { ok: false, error: PLAYBACK_SUPERSEDED, superseded: true };
        }
        activeUrlRef.current = nextUrl;
        activeCandidateRef.current = nextCandidate;
        setErrorMessage(null);
        setPlaybackFailure(null);
        lastErrorRef.current = null;
        return { ok: true };
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
    }

    const handlePlaying = () => {
      const requestedStation = requestedStationRef.current;
      candidateHasPlayedRef.current = true;
      if (requestedStation) {
        setCurrent((prev) =>
          prev?.stationuuid === requestedStation.stationuuid ? prev : requestedStation
        );
      }
      setStatus('playing');
      setIsPlaying(true);
      setErrorMessage(null);
      lastErrorRef.current = null;
      clearReconnect();
      clearWaitingTimeout();
      pushEvent('audio: playing');
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.setPositionState({
            duration: 0,
            playbackRate: 1,
            position: 0
          });
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
      setCurrentTime(audio.currentTime || 0);
    };
    const handleWaiting = () => {
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
          if ((requestedStationRef.current || currentRef.current) && isSessionCurrent(activeSession)) {
            tryNextCandidate(activeSession).then((switched) => {
              if ((!requestedStationRef.current && !currentRef.current) || !isSessionCurrent(activeSession)) {
                return;
              }
              if (switched) {
                pushEvent('audio: prolonged buffering, switched candidate');
                return;
              }
              pushEvent('audio: prolonged buffering, reconnecting...');
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
        scheduleReconnect(activeSession);
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

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden' && !audio.paused) {
        audio.play().catch(() => {});
      }
      pushEvent(`visibility: ${document.visibilityState}`);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    document.addEventListener('pointerdown', resumeAudioContext, { passive: true });
    document.addEventListener('keydown', resumeAudioContext);

    return () => {
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
      setVisualizer({
        active: false,
        available: false,
        spectrum: createEmptySpectrum(),
        waveform: createEmptyWaveform()
      });
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
    const audio = audioRef.current;
    if (!audio) return;
    audio.dataset.raVisualizerActive = visualizer.active ? 'true' : 'false';
    audio.dataset.raVisualizerAvailable = visualizer.available ? 'true' : 'false';
    audio.dataset.raVisualizerSpectrum = visualizer.spectrum
      .slice(0, 8)
      .map((value) => value.toFixed(2))
      .join(',');
  }, [visualizer]);

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

  useEffect(() => {
    if (shouldUseLeanPlaybackMode()) {
      setVisualizer({
        active: false,
        available: false,
        spectrum: createEmptySpectrum(),
        waveform: createEmptyWaveform()
      });
      return;
    }
    if (visualizerFrameRef.current !== null) {
      window.cancelAnimationFrame(visualizerFrameRef.current);
      visualizerFrameRef.current = null;
    }

    const analyser = analyserRef.current;
    if (!analyser || !isPlaying) {
      setVisualizer((prev) => ({
        ...prev,
        active: false,
        available: Boolean(analyser),
        spectrum: createEmptySpectrum(),
        waveform: createEmptyWaveform()
      }));
      return;
    }

    setVisualizer((prev) => ({
      ...prev,
      active: true,
      available: true
    }));

    const frequencyData = new Uint8Array(analyser.frequencyBinCount);
    const waveformData = new Uint8Array(analyser.fftSize);
    let lastFrameAt = 0;

    const updateFrame = (now: number) => {
      if (now - lastFrameAt < 32) {
        visualizerFrameRef.current = window.requestAnimationFrame(updateFrame);
        return;
      }
      lastFrameAt = now;

      analyser.getByteFrequencyData(frequencyData);
      analyser.getByteTimeDomainData(waveformData);

      const nextSpectrum = Array.from({ length: VISUALIZER_BARS }, (_, index) => {
        const start = Math.floor((index * frequencyData.length) / VISUALIZER_BARS);
        const end = Math.max(
          start + 1,
          Math.floor(((index + 1) * frequencyData.length) / VISUALIZER_BARS)
        );
        let peak = 0;
        for (let cursor = start; cursor < end; cursor += 1) {
          peak = Math.max(peak, frequencyData[cursor] ?? 0);
        }
        const normalizedPeak = peak / 255;
        const emphasized = Math.pow(normalizedPeak, 0.62);
        const lowBandBoost = 1 + Math.max(0, 0.28 - index * 0.012);
        return Number(Math.min(1, emphasized * lowBandBoost).toFixed(3));
      });

      const nextWaveform = Array.from({ length: VISUALIZER_WAVEFORM_SAMPLES }, (_, index) => {
        const sourceIndex = Math.floor(
          (index * waveformData.length) / VISUALIZER_WAVEFORM_SAMPLES
        );
        const centered = ((waveformData[sourceIndex] ?? 128) - 128) / 128;
        return Number(centered.toFixed(3));
      });

      setVisualizer({
        active: true,
        available: true,
        spectrum: nextSpectrum,
        waveform: nextWaveform
      });
      visualizerFrameRef.current = window.requestAnimationFrame(updateFrame);
    };

    visualizerFrameRef.current = window.requestAnimationFrame(updateFrame);
    return () => {
      if (visualizerFrameRef.current !== null) {
        window.cancelAnimationFrame(visualizerFrameRef.current);
        visualizerFrameRef.current = null;
      }
    };
  }, [isPlaying]);

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
    const shouldCheckApi = Boolean(apiBase) && needsApiAssist(station, sourceUrls);
    const apiAvailable = shouldCheckApi
      ? await checkApiAvailability(apiBase, { timeoutMs: 2_200 })
      : false;
    if (!isSessionCurrent(playbackSession)) {
      return { ok: false, error: PLAYBACK_SUPERSEDED };
    }
    if (shouldCheckApi && apiBase && !apiAvailable) {
      pushEvent('api: unavailable');
      markApiUnavailable(apiBase);
    }

    requestedStationRef.current = resolvedStation;
    setCurrent(null);
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

    return { ok: true, station: resolvedStation };
  };

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio || !current) return false;

    const nativeState = audio.getAttribute('data-ra-state');
    if (isPlaying || nativeState === 'playing' || !audio.paused) {
      clearReconnect();
      clearWaitingTimeout();
      audio.pause();
      return true;
    }

    try {
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
    lastErrorRef.current = null;
    requestedStationRef.current = null;
    setCurrent(null);
    setIsPlaying(false);
    setStatus('idle');
    setErrorMessage(null);
    setPlaybackFailure(null);
  };

  return {
    current,
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
    stop
  };
};
