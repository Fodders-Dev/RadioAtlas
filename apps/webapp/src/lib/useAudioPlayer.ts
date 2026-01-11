import { useEffect, useRef, useState } from 'react';
import type { StationLite } from '../types';

export type PlayerStatus = 'idle' | 'buffering' | 'playing' | 'paused' | 'error';

type ReconnectState = {
  timer: number | null;
  attempts: number;
};

const isHls = (url: string) => url.toLowerCase().includes('.m3u8');

export const useAudioPlayer = () => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  const reconnectRef = useRef<ReconnectState>({ timer: null, attempts: 0 });
  const currentRef = useRef<StationLite | null>(null);

  const [current, setCurrent] = useState<StationLite | null>(null);
  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);

  const clearReconnect = () => {
    if (reconnectRef.current.timer !== null) {
      window.clearTimeout(reconnectRef.current.timer);
    }
    reconnectRef.current = { timer: null, attempts: 0 };
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

    if (isHls(url) && !audio.canPlayType('application/vnd.apple.mpegurl')) {
      const mod = await import('hls.js');
      const hls = new mod.default({
        enableWorker: true,
        lowLatencyMode: true
      });
      hls.loadSource(url);
      hls.attachMedia(audio);
      hlsRef.current = hls;
    } else {
      audio.src = url;
    }
  };

  const scheduleReconnect = () => {
    const audio = audioRef.current;
    const station = currentRef.current;
    if (!audio || !station || reconnectRef.current.timer !== null) return;

    reconnectRef.current.attempts += 1;
    const delay = Math.min(15000, 2000 * reconnectRef.current.attempts);
    reconnectRef.current.timer = window.setTimeout(async () => {
      reconnectRef.current.timer = null;
      try {
        await attachSource(station.url_resolved);
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
    const audio = new Audio();
    audio.preload = 'none';
    audio.crossOrigin = 'anonymous';
    audioRef.current = audio;

    const handlePlaying = () => {
      setStatus('playing');
      setIsPlaying(true);
      clearReconnect();
    };
    const handlePause = () => {
      setIsPlaying(false);
      if (currentRef.current) {
        setStatus((prev) => (prev === 'error' ? prev : 'paused'));
      }
    };
    const handleWaiting = () => {
      if (currentRef.current) {
        setStatus('buffering');
        scheduleReconnect();
      }
    };
    const handleError = () => {
      if (currentRef.current) {
        setStatus('error');
        scheduleReconnect();
      }
    };
    const handleEnded = () => {
      if (currentRef.current) {
        setStatus('buffering');
        scheduleReconnect();
      }
    };

    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('stalled', handleWaiting);
    audio.addEventListener('error', handleError);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.pause();
      audio.src = '';
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('stalled', handleWaiting);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('ended', handleEnded);
      cleanupHls();
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

    clearReconnect();
    setCurrent(station);
    setStatus('buffering');

    try {
      await attachSource(station.url_resolved);
      await audio.play();
    } catch {
      setStatus('error');
      scheduleReconnect();
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
    cleanupHls();
    clearReconnect();
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
