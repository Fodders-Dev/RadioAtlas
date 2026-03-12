import { useEffect, useRef, useState } from 'react';
import type { StationLite } from '../types';
import { getApiBase } from './apiBase';

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

type ReconnectState = {
  timer: number | null;
  attempts: number;
};

type ExtractAudioStream = {
  url: string;
  bitrate?: number;
  averageBitrate?: number;
};

type ExtractItem = {
  url?: string;
};

type ExtractResponse = {
  type: 'stream' | 'playlist' | 'error';
  audioStreams?: ExtractAudioStream[];
  items?: ExtractItem[];
  error?: string;
};

const EQ_CENTER = 50;
const EQ_RANGE_DB = 12;
const VISUALIZER_BARS = 24;
const VISUALIZER_WAVEFORM_SAMPLES = 24;

const isHls = (url: string) => url.toLowerCase().includes('.m3u8');
const isDirectAudioUrl = (url: string) =>
  /\.(mp3|aac|m4a|ogg|opus|flac|wav|aiff?|mp2)(\?|#|$)/i.test(url);
const normalizeBase = (value?: string) => (value ? value.replace(/\/+$/, '') : '');
const clampPercent = (value: number) => Math.min(100, Math.max(0, value));
const sliderToDb = (value: number) => ((clampPercent(value) - EQ_CENTER) / EQ_CENTER) * EQ_RANGE_DB;
const dbToGain = (value: number) => 10 ** (value / 20);
const createDefaultEqBands = () => EQ_BANDS.map(() => EQ_CENTER);
const createEmptySpectrum = () => Array.from({ length: VISUALIZER_BARS }, () => 0);
const createEmptyWaveform = () => Array.from({ length: VISUALIZER_WAVEFORM_SAMPLES }, () => 0);

const buildProxyUrl = (url: string) => {
  const base = normalizeBase(getApiBase());
  if (!base) return url;
  return `${base}/stream?url=${encodeURIComponent(url)}`;
};

const isExternalStation = (station: StationLite) =>
  station.stationuuid.startsWith('ext_') ||
  station.country === 'External' ||
  station.tags?.includes('external');

const pickBestStream = (streams: ExtractAudioStream[]) => {
  if (!streams.length) return null;
  return streams
    .filter((stream) => Boolean(stream.url))
    .sort((a, b) => {
      const score = (item: ExtractAudioStream) =>
        Math.max(item.averageBitrate || 0, item.bitrate || 0);
      return score(b) - score(a);
    })[0];
};

const resolveExternalStream = async (
  url: string,
  log: (message: string) => void,
  depth = 0
): Promise<string | null> => {
  if (depth > 1) {
    log('extract: depth limit reached');
    return null;
  }
  const base = normalizeBase(getApiBase());
  if (!base) {
    log('extract: api base missing');
    return null;
  }

  try {
    log(`extract: request ${url}`);
    const response = await fetch(`${base}/extract?url=${encodeURIComponent(url)}`);
    const data = (await response.json()) as ExtractResponse;
    if (!response.ok || data?.type === 'error') {
      const errorMsg = data?.error ? ` (${data.error})` : '';
      log(`extract: http ${response.status}${errorMsg}`);
      return null;
    }
    if (data.type === 'stream') {
      const best = pickBestStream(data.audioStreams || []);
      if (best?.url) {
        log(`extract: stream ${best.url}`);
        return best.url;
      }
      log('extract: no audio streams');
      return null;
    }
    const nextUrl = data.items?.find((item) => item.url)?.url;
    if (!nextUrl) {
      log('extract: playlist empty');
      return null;
    }
    log(`extract: playlist -> ${nextUrl}`);
    return resolveExternalStream(nextUrl, log, depth + 1);
  } catch (err) {
    log(`extract: failed (${err instanceof Error ? err.message : 'unknown'})`);
    return null;
  }
};

const buildCandidates = (url: string) => {
  const candidates: string[] = [];
  const apiBase = normalizeBase(getApiBase());
  const isLocal = typeof window !== 'undefined' && window.location.protocol === 'http:';
  const proxyPreferred =
    Boolean(apiBase) && (url.startsWith('http://') || isHls(url) || !isDirectAudioUrl(url));

  if (proxyPreferred) {
    candidates.push(buildProxyUrl(url));
  }

  if (url.startsWith('http://')) {
    const httpsUrl = url.replace(/^http:\/\//, 'https://');
    if (httpsUrl !== url) {
      candidates.push(httpsUrl);
    }
    if (apiBase && !proxyPreferred) {
      candidates.push(buildProxyUrl(url));
    }
    if (isLocal) {
      candidates.push(url);
    }
  } else {
    candidates.push(url);
    if (apiBase && !proxyPreferred && (isHls(url) || !isDirectAudioUrl(url))) {
      candidates.push(buildProxyUrl(url));
    }
  }
  return Array.from(new Set(candidates));
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
  const candidatesRef = useRef<string[]>([]);
  const candidateIndexRef = useRef(0);
  const activeUrlRef = useRef<string | null>(null);
  const lastErrorRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const preampGainRef = useRef<GainNode | null>(null);
  const eqFiltersRef = useRef<BiquadFilterNode[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const visualizerFrameRef = useRef<number | null>(null);
  const audioGraphFailedRef = useRef(false);

  const [current, setCurrent] = useState<StationLite | null>(null);
  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [volume, setVolume] = useState(0.8);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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

  const ensureAudioGraph = () => {
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
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.72;
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
      analyser.connect(context.destination);

      audioContextRef.current = context;
      mediaSourceRef.current = source;
      preampGainRef.current = preamp;
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
    activeUrlRef.current = url;
    setActiveUrl(url);
    pushEvent(`source: ${url}`);

    if (isHls(url) && !audio.canPlayType('application/vnd.apple.mpegurl')) {
      const mod = await import('hls.js');
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
      audio.src = url;
    }
  };

  const playCandidateAtIndex = async (startIndex: number) => {
    const audio = audioRef.current;
    if (!audio) {
      return { ok: false, error: 'Audio engine unavailable' };
    }

    const list = candidatesRef.current;
    if (startIndex < 0 || startIndex >= list.length) {
      return { ok: false, error: 'No playable stream candidates' };
    }

    let lastError = 'No playable stream candidates';
    for (let index = startIndex; index < list.length; index += 1) {
      const nextUrl = list[index];
      candidateIndexRef.current = index;
      try {
        await attachSource(nextUrl);
        await resumeAudioContext();
        await audio.play();
        activeUrlRef.current = nextUrl;
        setErrorMessage(null);
        lastErrorRef.current = null;
        return { ok: true };
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Playback failed';
        lastErrorRef.current = lastError;
        pushEvent(`playback: candidate failed (${nextUrl}) ${lastError}`);
      }
    }

    setStatus('error');
    setIsPlaying(false);
    setErrorMessage(lastError);
    return { ok: false, error: lastError };
  };

  const tryNextCandidate = async () => {
    const list = candidatesRef.current;
    if (candidateIndexRef.current >= list.length - 1) {
      return false;
    }
    const result = await playCandidateAtIndex(candidateIndexRef.current + 1);
    return result.ok;
  };

  const scheduleReconnect = () => {
    const audio = audioRef.current;
    if (!audio || !currentRef.current || reconnectRef.current.timer !== null) return;

    reconnectRef.current.attempts += 1;
    const delay = Math.min(15000, 2000 * reconnectRef.current.attempts);
    reconnectRef.current.timer = window.setTimeout(async () => {
      reconnectRef.current.timer = null;
      try {
        const url = activeUrlRef.current || currentRef.current?.url_resolved;
        if (!url) return;
        await attachSource(url);
        await resumeAudioContext();
        await audio.play();
      } catch {
        scheduleReconnect();
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
    audio.preload = 'auto';
    audio.controls = false;
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('webkit-playsinline', 'true');
    audio.setAttribute('autoplay', 'false');
    if (audio instanceof HTMLAudioElement) {
      audio.className = 'audio-hidden';
      document.body.appendChild(audio);
    }
    audioRef.current = audio;
    ensureAudioGraph();

    const handlePlaying = () => {
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
      if (currentRef.current) {
        setStatus((prev) => (prev === 'error' ? prev : 'paused'));
      }
      pushEvent('audio: pause');
    };
    const handleWaiting = () => {
      if (currentRef.current) {
        setStatus('buffering');
        clearWaitingTimeout();
        waitingTimeoutRef.current = window.setTimeout(() => {
          waitingTimeoutRef.current = null;
          if (currentRef.current) {
            pushEvent('audio: prolonged buffering, reconnecting...');
            scheduleReconnect();
          }
        }, 5000);
      }
      pushEvent('audio: waiting');
    };
    const handleError = () => {
      if (currentRef.current) {
        tryNextCandidate().then((switched) => {
          if (!switched) {
            setStatus('error');
            setIsPlaying(false);
            scheduleReconnect();
          }
        });
      }
      pushEvent('audio: error');
    };
    const handleEnded = () => {
      if (currentRef.current) {
        setStatus('buffering');
        setIsPlaying(false);
        scheduleReconnect();
      }
      pushEvent('audio: ended');
    };

    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('pause', handlePause);
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
      audio.src = '';
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('pause', handlePause);
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
    ensureAudioGraph();
    applyEqToGraph();
  }, [eqBands, eqEnabled, eqPreamp]);

  useEffect(() => {
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

    const frequencyData = new Uint8Array(analyser.frequencyBinCount);
    const waveformData = new Uint8Array(analyser.fftSize);
    let lastFrameAt = 0;

    const updateFrame = (now: number) => {
      if (now - lastFrameAt < 48) {
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
        return Number((peak / 255).toFixed(3));
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

    clearReconnect();
    cleanupHls();
    clearWaitingTimeout();
    activeUrlRef.current = null;
    setActiveUrl(null);
    lastErrorRef.current = null;
    setErrorMessage(null);

    audio.pause();
    audio.src = '';
    audio.currentTime = 0;
    audio.load();

    let resolvedStation = station;
    if (isExternalStation(station) && !isDirectAudioUrl(station.url_resolved)) {
      if (!normalizeBase(getApiBase())) {
        const error = 'API proxy required for this station';
        setCurrent(station);
        setIsPlaying(false);
        setStatus('error');
        setErrorMessage(error);
        return { ok: false, error };
      }
      pushEvent('extract: resolving external link');
      const extracted = await resolveExternalStream(station.url_resolved, pushEvent);
      if (extracted) {
        resolvedStation = { ...station, url_resolved: extracted };
      } else {
        const error = 'Unable to resolve a playable stream';
        setCurrent(station);
        setIsPlaying(false);
        setStatus('error');
        setErrorMessage(error);
        pushEvent('extract: failed');
        return { ok: false, error };
      }
    }

    setCurrent(resolvedStation);
    setStatus('buffering');
    setIsPlaying(false);
    candidatesRef.current = buildCandidates(resolvedStation.url_resolved);
    candidateIndexRef.current = 0;
    if (!candidatesRef.current.length) {
      const error = 'API proxy required for this stream';
      setStatus('error');
      setErrorMessage(error);
      return { ok: false, error };
    }

    const result = await playCandidateAtIndex(0);
    if (!result.ok) {
      return { ok: false, error: result.error, station: resolvedStation };
    }

    return { ok: true, station: resolvedStation };
  };

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio || !current) return false;

    const nativeState = audio.getAttribute('data-ra-state');
    if (isPlaying || nativeState === 'playing' || !audio.paused) {
      audio.pause();
      return true;
    }

    try {
      if (!audio.src) {
        const result = await playCandidateAtIndex(candidateIndexRef.current);
        return result.ok;
      }
      await resumeAudioContext();
      await audio.play();
      return true;
    } catch (error) {
      pushEvent(`audio: resume failed (${error instanceof Error ? error.message : 'unknown'})`);
      setStatus('error');
      setIsPlaying(false);
      setErrorMessage(error instanceof Error ? error.message : 'Playback failed');
      return false;
    }
  };

  const stop = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.src = '';
    audio.currentTime = 0;
    cleanupHls();
    clearReconnect();
    clearWaitingTimeout();
    activeUrlRef.current = null;
    lastErrorRef.current = null;
    setCurrent(null);
    setIsPlaying(false);
    setStatus('idle');
    setErrorMessage(null);
  };

  return {
    current,
    status,
    isPlaying,
    activeUrl,
    volume,
    eq: {
      enabled: eqEnabled,
      preamp: eqPreamp,
      bands: eqBands
    } as PlayerEqState,
    visualizer,
    errorMessage,
    setVolume,
    setEqBand,
    setEqEnabled,
    setEqPreamp: (value: number) => setEqPreamp(clampPercent(value)),
    resetEq,
    playStation,
    toggle,
    stop
  };
};
