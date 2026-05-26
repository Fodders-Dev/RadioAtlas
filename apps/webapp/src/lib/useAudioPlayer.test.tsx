import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useAudioPlayer, type VisualizerFrame } from './useAudioPlayer';

// T2.1: visualizer is pushed via subscribeVisualizer (ref-based rAF),
// NOT 30 Hz React state. These tests force the audio graph up (via the
// __RA_FORCE_AUDIO_GRAPH__ hook), mock AudioContext + a manually-driven
// requestAnimationFrame, and assert the pump's contract.

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// --- Minimal Web Audio mock --------------------------------------------
const makeAnalyser = () => ({
  fftSize: 256,
  frequencyBinCount: 128,
  smoothingTimeConstant: 0.58,
  getByteFrequencyData: (array: Uint8Array) => {
    for (let i = 0; i < array.length; i += 1) array[i] = 180;
  },
  getByteTimeDomainData: (array: Uint8Array) => {
    for (let i = 0; i < array.length; i += 1) array[i] = 140;
  },
  connect: () => {},
  disconnect: () => {}
});
const makeNode = () => ({ connect: () => {}, disconnect: () => {}, pan: { value: 0 }, gain: { value: 0 } });
const makeFilter = () => ({
  frequency: { value: 0 },
  gain: { value: 0 },
  Q: { value: 0 },
  type: 'peaking',
  connect: () => {},
  disconnect: () => {}
});
class FakeAudioContext {
  state = 'running';
  destination = makeNode();
  createMediaElementSource = () => makeNode();
  createGain = () => makeNode();
  createAnalyser = makeAnalyser;
  createBiquadFilter = makeFilter;
  createStereoPanner = () => makeNode();
  resume = () => Promise.resolve();
  close = () => Promise.resolve();
}

// --- Manually-driven requestAnimationFrame -----------------------------
let rafCallbacks = new Map<number, FrameRequestCallback>();
let rafSeq = 0;
let rafScheduleCount = 0;
const flushRaf = (timestamp: number) => {
  const pending = [...rafCallbacks.entries()];
  rafCallbacks = new Map();
  pending.forEach(([, cb]) => cb(timestamp));
};

describe('useAudioPlayer visualizer pump (T2.1)', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let createdAudio: HTMLAudioElement | null = null;
  const origCreateElement = document.createElement.bind(document);
  const origRaf = window.requestAnimationFrame;
  const origCancel = window.cancelAnimationFrame;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    // jsdom leaves these unimplemented (they throw); stub so the hook's
    // play/pause/load calls don't spam stderr during mount/unmount.
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    (window as typeof window & { __RA_FORCE_AUDIO_GRAPH__?: boolean }).__RA_FORCE_AUDIO_GRAPH__ = true;
    window.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
    rafCallbacks = new Map();
    rafSeq = 0;
    rafScheduleCount = 0;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafScheduleCount += 1;
      const id = (rafSeq += 1);
      rafCallbacks.set(id, cb);
      return id;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((id: number) => {
      rafCallbacks.delete(id);
    }) as typeof window.cancelAnimationFrame;
    // Capture the <audio> element the hook creates so the test can drive
    // playback events.
    createdAudio = null;
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string, opts?: unknown) => {
      const el = origCreateElement(tag as 'audio', opts as undefined);
      if (tag === 'audio') createdAudio = el as HTMLAudioElement;
      return el;
    }) as typeof document.createElement);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    vi.restoreAllMocks();
    window.requestAnimationFrame = origRaf;
    window.cancelAnimationFrame = origCancel;
    container.remove();
    delete (window as typeof window & { __RA_FORCE_AUDIO_GRAPH__?: boolean }).__RA_FORCE_AUDIO_GRAPH__;
  });

  type Captured = {
    visualizer: { active: boolean; available: boolean };
    subscribeVisualizer: (cb: (frame: VisualizerFrame) => void) => () => void;
  };
  let latest: Captured;
  let renderCount = 0;
  const Host = () => {
    const player = useAudioPlayer({});
    latest = player;
    renderCount += 1;
    return null;
  };

  const mount = () => {
    act(() => {
      root = createRoot(container);
      root.render(createElement(Host));
    });
  };
  const startPlayback = () => {
    act(() => {
      createdAudio?.dispatchEvent(new Event('playing'));
    });
  };

  it('exposes subscribeVisualizer and a boolean-only visualizer state', () => {
    mount();
    expect(typeof latest.subscribeVisualizer).toBe('function');
    expect(latest.visualizer).toEqual({ active: false, available: true });
    expect(latest.visualizer).not.toHaveProperty('spectrum');
  });

  it('does not run the rAF pump while there are no subscribers (demand-gated)', () => {
    mount();
    startPlayback();
    expect(latest.visualizer.active).toBe(true);
    // Playing + graph up, but nobody subscribed -> loop never scheduled.
    expect(rafScheduleCount).toBe(0);
  });

  it('pushes frames to a subscriber, reusing the same buffers, without per-frame React state', () => {
    mount();
    startPlayback();

    const frames: VisualizerFrame[] = [];
    let unsubscribe = () => {};
    act(() => {
      unsubscribe = latest.subscribeVisualizer((frame) => frames.push(frame));
    });
    expect(rafScheduleCount).toBeGreaterThan(0); // pump started on subscribe

    const rendersBeforeTicks = renderCount;
    const visualizerRefBefore = latest.visualizer;

    // Drive several frames (>32ms apart so the throttle lets them through).
    act(() => flushRaf(1000));
    act(() => flushRaf(1100));
    act(() => flushRaf(1200));

    expect(frames.length).toBeGreaterThanOrEqual(3);
    // Buffers are reused: every frame is the same object/typed arrays.
    expect(frames[0]).toBe(frames[1]);
    expect(frames[1]).toBe(frames[2]);
    expect(frames[0]?.spectrum).toBeInstanceOf(Float32Array);
    expect(frames[0]?.spectrum).toBe(frames[2]?.spectrum);
    // No per-frame React state: host did not re-render, visualizer ref stable.
    expect(renderCount).toBe(rendersBeforeTicks);
    expect(latest.visualizer).toBe(visualizerRefBefore);
    // No dataset.raVisualizer* writes remain.
    expect(createdAudio?.dataset.raVisualizerActive).toBeUndefined();
    expect(createdAudio?.dataset.raVisualizerSpectrum).toBeUndefined();

    act(() => unsubscribe());
  });

  it('stops the pump when the last subscriber leaves', () => {
    mount();
    startPlayback();
    let unsubscribe = () => {};
    act(() => {
      unsubscribe = latest.subscribeVisualizer(() => {});
    });
    act(() => flushRaf(1000));
    act(() => unsubscribe());
    // After unsubscribe the in-flight frame callback returns without
    // rescheduling -> the queue drains and stays empty.
    act(() => flushRaf(1100));
    expect(rafCallbacks.size).toBe(0);
  });
});
