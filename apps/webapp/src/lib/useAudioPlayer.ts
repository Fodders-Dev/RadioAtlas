import { useEffect, useRef, useState } from 'react';
import type { StationLite } from '../types';
import { getApiBase } from './apiBase';

export type PlayerStatus = 'idle' | 'buffering' | 'playing' | 'paused' | 'error';

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

const isHls = (url: string) => url.toLowerCase().includes('.m3u8');
const isDirectAudioUrl = (url: string) =>
  /\.(mp3|aac|m4a|ogg|opus|flac|wav|aiff?|mp2)(\?|#|$)/i.test(url);
const normalizeBase = (value?: string) => (value ? value.replace(/\/+$/, '') : '');

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
  depth = 0
): Promise<string | null> => {
  if (depth > 1) return null;
  const base = normalizeBase(getApiBase());
  if (!base) return null;

  try {
    const response = await fetch(
      `${base}/extract?url=${encodeURIComponent(url)}`
    );
    const data = (await response.json()) as ExtractResponse;
    if (!response.ok || data?.type === 'error') {
      return null;
    }
    if (data.type === 'stream') {
      const best = pickBestStream(data.audioStreams || []);
      return best?.url || null;
    }
    const nextUrl = data.items?.find((item) => item.url)?.url;
    if (!nextUrl) return null;
    return resolveExternalStream(nextUrl, depth + 1);
  } catch {
    return null;
  }
};

const buildCandidates = (url: string) => {
  const candidates: string[] = [];
  const apiBase = getApiBase();
  const isLocal = typeof window !== 'undefined' && window.location.protocol === 'http:';
  if (url.startsWith('http://')) {
    const httpsUrl = url.replace(/^http:\/\//, 'https://');
    if (httpsUrl !== url) {
      candidates.push(httpsUrl);
    }
    if (apiBase) {
      candidates.push(buildProxyUrl(url));
    } else if (isLocal) {
      candidates.push(url);
    }
  } else {
    candidates.push(url);
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

  const [current, setCurrent] = useState<StationLite | null>(null);
  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);

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

  const attachSource = async (url: string) => {
    const audio = audioRef.current;
    if (!audio) return;

    cleanupHls();
    activeUrlRef.current = url;
    pushEvent(`source: ${url}`);

    if (isHls(url) && !audio.canPlayType('application/vnd.apple.mpegurl')) {
      const mod = await import('hls.js');
      const hls = new mod.default({
        enableWorker: true,
        lowLatencyMode: false, // Disabled for stable playback without stuttering
        maxBufferLength: 30, // Buffer up to 30 seconds
        maxMaxBufferLength: 60, // Max buffer 60 seconds
        maxBufferSize: 60 * 1000 * 1000, // 60MB buffer
        maxBufferHole: 0.5, // Allow small gaps
        liveSyncDurationCount: 3, // Keep 3 segments behind live edge
        liveMaxLatencyDurationCount: 10, // Max latency 10 segments
        liveDurationInfinity: true,
        highBufferWatchdogPeriod: 2 // Check buffer every 2 seconds
      });
      hls.loadSource(url);
      hls.attachMedia(audio);
      hlsRef.current = hls;
      pushEvent('hls: attached');
    } else {
      audio.src = url;
    }
  };

  const tryNextCandidate = async () => {
    const audio = audioRef.current;
    if (!audio) return false;
    const list = candidatesRef.current;
    if (candidateIndexRef.current >= list.length - 1) {
      return false;
    }
    candidateIndexRef.current += 1;
    const nextUrl = list[candidateIndexRef.current];
    try {
      await attachSource(nextUrl);
      await audio.play();
      return true;
    } catch {
      return false;
    }
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
        await audio.play();
      } catch {
        scheduleReconnect();
      }
    }, delay);
  };

  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  useEffect(() => {
    const audio =
      typeof document !== 'undefined' ? document.createElement('audio') : new Audio();
    audio.preload = 'auto'; // Enable automatic buffering for smoother playback
    // Note: crossOrigin removed - some streams don't support CORS and it can cause issues
    audio.controls = false; // Hidden element, no controls needed
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('webkit-playsinline', 'true');
    audio.setAttribute('autoplay', 'false');
    if (audio instanceof HTMLAudioElement) {
      audio.className = 'audio-hidden';
      document.body.appendChild(audio);
    }
    audioRef.current = audio;

    const handlePlaying = () => {
      setStatus('playing');
      setIsPlaying(true);
      clearReconnect();
      clearWaitingTimeout(); // Clear any pending reconnect from buffering
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
        // Only schedule reconnect if buffering persists for more than 5 seconds
        // Short buffering is normal and resolves itself
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
            scheduleReconnect();
          }
        });
      }
      pushEvent('audio: error');
    };
    const handleEnded = () => {
      if (currentRef.current) {
        setStatus('buffering');
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
        audio.play().catch(() => { });
      }
      pushEvent(`visibility: ${document.visibilityState}`);
    };

    document.addEventListener('visibilitychange', handleVisibility);

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
      cleanupHls();
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

  const playStation = async (station: StationLite) => {
    const audio = audioRef.current;
    if (!audio) return;

    // Clean up previous state
    clearReconnect();
    cleanupHls();
    clearWaitingTimeout();
    activeUrlRef.current = null;

    // Stop current playback and reset
    audio.pause();
    audio.src = '';
    audio.currentTime = 0;
    audio.load(); // Reset the audio element

    let resolvedStation = station;
    if (isExternalStation(station) && !isDirectAudioUrl(station.url_resolved)) {
      pushEvent('extract: resolving external link');
      const extracted = await resolveExternalStream(station.url_resolved);
      if (extracted) {
        resolvedStation = { ...station, url_resolved: extracted };
      } else {
        pushEvent('extract: failed, using original link');
      }
    }

    setCurrent(resolvedStation);
    setStatus('buffering');
    candidatesRef.current = buildCandidates(resolvedStation.url_resolved);
    candidateIndexRef.current = 0;

    try {
      const url = candidatesRef.current[0];
      await attachSource(url);
      await audio.play();
    } catch {
      const switched = await tryNextCandidate();
      if (!switched) {
        setStatus('error');
        scheduleReconnect();
      }
    }
  };

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio || !current) return;

    if (isPlaying) {
      audio.pause();
      return;
    }

    try {
      await audio.play();
    } catch {
      setStatus('error');
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
    setCurrent(null);
    setStatus('idle');
  };

  return {
    current,
    status,
    isPlaying,
    volume,
    setVolume,
    playStation,
    toggle,
    stop
  };
};
