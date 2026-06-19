import { useEffect, useRef } from 'react';

// Pause-on-headphone-unplug.
//
// The web platform has NO direct "headphones removed" event. On iOS Safari the
// OS already auto-pauses HTMLAudioElement on an output-route change, but on
// Android Chromium (incl. the Telegram Mini App WebView) the audio just reroutes
// to the loud speaker and keeps playing — the annoyance we fix here.
//
// The only portable signal is `navigator.mediaDevices` 'devicechange'. To tell a
// REMOVAL (unplug / Bluetooth disconnect) from an ADDITION (plug-in) we compare
// the audio-OUTPUT device count across the event and only pause when it DROPS
// while playing. Where audiooutput devices are not enumerable (e.g. iOS Safari)
// the count stays flat and this no-ops — which is fine, iOS pauses natively.

export const shouldPauseOnDeviceChange = (
  previousOutputs: number,
  nextOutputs: number,
  isPlaying: boolean
): boolean => isPlaying && nextOutputs < previousOutputs;

// Count audio-output devices, or null when enumeration is unavailable/forbidden
// so the caller can distinguish "no signal" from "zero devices".
export const countAudioOutputs = async (
  mediaDevices: Pick<MediaDevices, 'enumerateDevices'> | undefined
): Promise<number | null> => {
  if (!mediaDevices?.enumerateDevices) return null;
  try {
    const devices = await mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'audiooutput').length;
  } catch {
    return null;
  }
};

export type OutputDeviceGuardParams = {
  enabled: boolean;
  isPlaying: boolean;
  onUnplug: () => void;
};

export const useOutputDeviceGuard = ({
  enabled,
  isPlaying,
  onUnplug
}: OutputDeviceGuardParams): void => {
  const isPlayingRef = useRef(isPlaying);
  const onUnplugRef = useRef(onUnplug);
  const lastCountRef = useRef<number | null>(null);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    onUnplugRef.current = onUnplug;
  }, [onUnplug]);

  useEffect(() => {
    if (!enabled) return undefined;
    const mediaDevices =
      typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!mediaDevices?.addEventListener || !mediaDevices.enumerateDevices) return undefined;

    let cancelled = false;

    const seedCount = async () => {
      const count = await countAudioOutputs(mediaDevices);
      if (!cancelled && count != null) lastCountRef.current = count;
    };

    const handleChange = async () => {
      const previous = lastCountRef.current;
      const next = await countAudioOutputs(mediaDevices);
      if (cancelled || next == null) return;
      if (previous != null && shouldPauseOnDeviceChange(previous, next, isPlayingRef.current)) {
        onUnplugRef.current();
      }
      lastCountRef.current = next;
    };

    void seedCount();
    mediaDevices.addEventListener('devicechange', handleChange);
    return () => {
      cancelled = true;
      mediaDevices.removeEventListener('devicechange', handleChange);
    };
  }, [enabled]);
};
