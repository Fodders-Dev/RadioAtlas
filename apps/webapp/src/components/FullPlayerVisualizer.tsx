import { useEffect, useRef, type CSSProperties } from 'react';
import type { VisualizerFrame } from '../lib/useAudioPlayer';

// P3-3a: a theme-driven spectrum for the canonical full player. It subscribes to
// the (previously dead-wired) audio pump and writes each bar's height through a
// `--ra-level` custom property via DIRECT DOM — no React state per frame, so the
// overlay never re-renders at 30Hz. Bars are coloured by the theme-derived
// --visualizer-* / --accent vars (styles.css), so the spectrum picks up the
// active theme for free. When playback isn't producing analyser data (paused,
// or a stream with no readable audio — iOS lean mode / direct cross-origin) the
// bars fall back to a calm idle shimmer instead of sitting dead-flat.
const BARS = 24;

type FullPlayerVisualizerProps = {
  active: boolean;
  subscribe: (callback: (frame: VisualizerFrame) => void) => () => void;
};

export const FullPlayerVisualizer = ({ active, subscribe }: FullPlayerVisualizerProps) => {
  const barsRef = useRef<Array<HTMLSpanElement | null>>([]);

  useEffect(() => {
    if (!active) return undefined;
    const unsubscribe = subscribe((frame) => {
      const bars = barsRef.current;
      const { spectrum } = frame;
      for (let index = 0; index < bars.length; index += 1) {
        const bar = bars[index];
        if (bar) bar.style.setProperty('--ra-level', (spectrum[index] ?? 0).toFixed(3));
      }
    });
    return () => {
      unsubscribe();
      // Hand back to the idle shimmer (CSS) by clearing the driven levels.
      for (const bar of barsRef.current) bar?.style.removeProperty('--ra-level');
    };
  }, [active, subscribe]);

  return (
    <div
      className="full-player-visualizer"
      data-active={active ? 'true' : 'false'}
      data-full-player-visualizer
      aria-hidden="true"
    >
      {Array.from({ length: BARS }, (_, index) => (
        <span
          className="full-player-visualizer-bar"
          key={index}
          ref={(element) => {
            barsRef.current[index] = element;
          }}
          style={{ '--bar-index': index } as CSSProperties}
        />
      ))}
    </div>
  );
};
