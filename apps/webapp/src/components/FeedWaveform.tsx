import { useEffect, useRef } from 'react';
import { VISUALIZER_BARS, type VisualizerFrame } from '../lib/useAudioPlayer';

// The «Лента» card's cyan waveform strip. Modelled on FullPlayerVisualizer:
// subscribes to the audio pump and writes each bar's height through a
// `--ra-level` custom property via DIRECT DOM, so the card never re-renders at
// 30Hz.
//
// Deliberately NOT a reuse of FullPlayerVisualizer: that component's CSS lives
// in FullPlayerOverlay.css, i.e. inside the lazily-loaded full-player bundle, so
// importing it here would render it unstyled — and moving those rules into a
// shared file would change their cascade position and put the full-player visual
// baselines at risk. ~40 trivial duplicated lines against zero risk to another
// surface, and the feed wants a different object anyway (a wide strip spanning
// the info stack, not 24 centred bars in a 46px box).
//
// ⚠ TAKEN FROM THE PUMP, never hardcoded. `frame.spectrum` is a Float32Array of
// exactly VISUALIZER_BARS entries, so any extra bar reads `undefined`, falls
// back to 0, and sits at the 8% floor for the entire life of the strip. This
// shipped as 28 against a 24-band pump: the right ~14% of the waveform was a
// permanently dead flat tail whenever audio was playing, invisible to the
// visual baseline because that spec hides .station-feed-wave outright. The bars
// are `flex: 1 1 auto`, so the strip spans the full width at any count.
const BARS = VISUALIZER_BARS;

type FeedWaveformProps = {
  // True only when THIS card's station is the one currently playing. When false
  // the strip renders a flat resting state — never a fake animated amplitude,
  // which would be inventing audio data for a station nobody is listening to.
  active: boolean;
  subscribe: (callback: (frame: VisualizerFrame) => void) => () => void;
};

const prefersReducedMotion = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

export const FeedWaveform = ({ active, subscribe }: FeedWaveformProps) => {
  const barsRef = useRef<Array<HTMLSpanElement | null>>([]);

  useEffect(() => {
    if (!active) return undefined;
    // Reduced motion: don't subscribe at all. A JS-written custom property is
    // invisible to CSS `transition: none`, so declining the subscription is the
    // only way to actually still the bars — and it saves the 30Hz pump too.
    if (prefersReducedMotion()) return undefined;
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
      for (const bar of barsRef.current) bar?.style.removeProperty('--ra-level');
    };
  }, [active, subscribe]);

  return (
    <div
      className="station-feed-wave"
      data-active={active ? 'true' : 'false'}
      aria-hidden="true"
    >
      {Array.from({ length: BARS }, (_, index) => (
        <span
          className="station-feed-wave-bar"
          key={index}
          ref={(element) => {
            barsRef.current[index] = element;
          }}
        />
      ))}
    </div>
  );
};
