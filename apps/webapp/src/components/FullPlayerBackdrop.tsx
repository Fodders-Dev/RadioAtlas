import { useEffect, useRef } from 'react';
import type { VisualizerFrame } from '../lib/useAudioPlayer';

// P3-3c: a full-bleed, accent-tinted reactive backdrop for the canonical full
// player (the fullPlayerBackdrop slot, types.ts). It subscribes to the same
// audio pump as the 3a spectrum and writes a smoothed low-mid "energy" scalar to
// --ra-energy via DIRECT DOM — no React state per frame, so the overlay never
// re-renders at 30Hz. The CSS uses --ra-energy to swell the accent glow with the
// music; theme accent/mode drive the colour. With no live data (paused, iOS lean
// mode, or a direct cross-origin stream) it falls back to a slow ambient drift —
// pretty on its own, not an error state.
type FullPlayerBackdropProps = {
  active: boolean;
  subscribe: (callback: (frame: VisualizerFrame) => void) => () => void;
};

export const FullPlayerBackdrop = ({ active, subscribe }: FullPlayerBackdropProps) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return undefined;
    let smoothed = 0;
    const unsubscribe = subscribe((frame) => {
      const node = ref.current;
      if (!node) return;
      const { spectrum } = frame;
      // The felt "energy" lives in the low-mid bands.
      const count = Math.min(spectrum.length, 16);
      let sum = 0;
      for (let index = 0; index < count; index += 1) sum += spectrum[index] ?? 0;
      const energy = count > 0 ? sum / count : 0;
      // Ease toward the target so the swell is smooth, not jittery.
      smoothed += (energy - smoothed) * 0.28;
      node.style.setProperty('--ra-energy', smoothed.toFixed(3));
    });
    return () => {
      unsubscribe();
      ref.current?.style.removeProperty('--ra-energy');
    };
  }, [active, subscribe]);

  return (
    <div
      ref={ref}
      className="full-player-backdrop"
      data-active={active ? 'true' : 'false'}
      data-full-player-backdrop
      aria-hidden="true"
    />
  );
};
