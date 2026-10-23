import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useAudioPlayer } from './useAudioPlayer';
import type { StationLite } from '../types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('./apiAvailability', () => ({ checkApiAvailability: () => Promise.resolve(false), markApiUnavailable: () => {} }));
vi.mock('./observability', () => ({ reportClientEvent: () => {} }));
vi.mock('./apiBase', () => ({ getApiBase: () => '' }));

const station = { stationuuid: 'pwa-session', name: 'PWA Radio', url_resolved: 'https://stream.test/live', url: 'https://stream.test/live' } as StationLite;

describe('main player playback category wiring', () => {
  let root: Root | null = null;
  let container: HTMLDivElement;
  let audio: HTMLAudioElement | null = null;
  const originalCreateElement = document.createElement.bind(document);
  const originalAudioSession = Object.getOwnPropertyDescriptor(navigator, 'audioSession');
  const originalStandalone = Object.getOwnPropertyDescriptor(navigator, 'standalone');
  const originalUserAgent = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
  let category: string;
  let order: string[];

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = null;
    vi.restoreAllMocks();
    for (const [key, descriptor] of [['audioSession', originalAudioSession], ['standalone', originalStandalone], ['userAgent', originalUserAgent]] as const) {
      if (descriptor) Object.defineProperty(navigator, key, descriptor);
      else delete (navigator as Navigator & Record<string, unknown>)[key];
    }
    container?.remove();
  });

  it('writes synchronously before native play and restores only on hook cleanup', async () => {
    category = 'auto';
    order = [];
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'iPhone AppleWebKit/605.1.15' });
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    Object.defineProperty(navigator, 'audioSession', { configurable: true, value: {
      get type() { return category; },
      set type(value: string) { order.push(`category:${value}`); category = value; }
    } });
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string, options?: unknown) => {
      const element = originalCreateElement(tag as 'audio', options as undefined);
      if (tag === 'audio') {
        audio = element as HTMLAudioElement;
        element.load = () => {};
        let paused = true;
        Object.defineProperty(element, 'paused', { configurable: true, get: () => paused });
        element.play = () => { paused = false; order.push('audio:play'); return Promise.resolve(); };
        element.pause = () => { paused = true; order.push('audio:pause'); };
      }
      return element;
    }) as typeof document.createElement);

    let api!: ReturnType<typeof useAudioPlayer>;
    const Host = () => { api = useAudioPlayer({}); return null; };
    act(() => { root = createRoot(container); root.render(createElement(Host)); });
    expect(category).toBe('auto');
    await act(async () => { await api.playStation(station); });
    expect(order[0]).toBe('category:playback');
    expect(order.indexOf('audio:play')).toBeGreaterThan(0);
    expect(order.filter((item) => item.startsWith('category:'))).toEqual(['category:playback']);
    const pauseResumeStart = order.length;
    await act(async () => { api.pause(); await api.resume(); });
    expect(order.slice(pauseResumeStart)).toContain('audio:pause');
    expect(order.slice(pauseResumeStart).indexOf('audio:play')).toBeGreaterThan(order.slice(pauseResumeStart).indexOf('audio:pause'));
    await act(async () => { await api.playStation({ ...station, stationuuid: 'pwa-session-next', name: 'Next' }); });
    expect(order.filter((item) => item.startsWith('category:'))).toEqual(['category:playback']);
    expect(order.lastIndexOf('audio:pause')).toBeLessThan(order.lastIndexOf('audio:play'));
    act(() => api.stop());
    expect(order.lastIndexOf('audio:pause')).toBeLessThan(order.lastIndexOf('category:auto'));
    expect(category).toBe('auto');
    expect(order.filter((item) => item.startsWith('category:'))).toEqual(['category:playback', 'category:auto']);
    await act(async () => { await api.playStation(station); });
    expect(category).toBe('playback');
    expect(order.filter((item) => item.startsWith('category:'))).toEqual(['category:playback', 'category:auto', 'category:playback']);
    act(() => root?.unmount());
    root = null;
    expect(category).toBe('auto');
    expect(order.lastIndexOf('audio:pause')).toBeLessThan(order.lastIndexOf('category:auto'));
    expect(order.at(-1)).toBe('category:auto');
  });

  it.each([
    { userAgent: 'iPhone AppleWebKit/605.1.15', standalone: false, label: 'ordinary iPhone tab' },
    { userAgent: 'Android AppleWebKit/537.36', standalone: true, label: 'Android standalone app' }
  ])('keeps audio usable without category writes in $label', async ({ userAgent, standalone }) => {
    category = 'auto';
    order = [];
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: userAgent });
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: standalone });
    Object.defineProperty(navigator, 'audioSession', { configurable: true, value: {
      get type() { return category; },
      set type(value: string) { order.push(`category:${value}`); category = value; }
    } });
    container = document.createElement('div');
    document.body.appendChild(container);
    let playCalls = 0;
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string, options?: unknown) => {
      const element = originalCreateElement(tag as 'audio', options as undefined);
      if (tag === 'audio') {
        audio = element as HTMLAudioElement;
        element.load = () => {};
        element.play = () => { playCalls += 1; return Promise.resolve(); };
        element.pause = () => {};
      }
      return element;
    }) as typeof document.createElement);
    let api!: ReturnType<typeof useAudioPlayer>;
    const Host = () => { api = useAudioPlayer({}); return null; };
    act(() => { root = createRoot(container); root.render(createElement(Host)); });
    await act(async () => { await api.playStation(station); });
    expect(playCalls).toBeGreaterThan(0);
    expect(category).toBe('auto');
    expect(order.filter((item) => item.startsWith('category:'))).toEqual([]);
  });

  it.each(['stop', 'unmount'] as const)('does not retain category ownership when %s invalidates pending native play', async (termination) => {
    category = 'auto';
    order = [];
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'iPhone AppleWebKit/605.1.15' });
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    Object.defineProperty(navigator, 'audioSession', { configurable: true, value: {
      get type() { return category; },
      set type(value: string) { order.push(`category:${value}`); category = value; }
    } });
    container = document.createElement('div');
    document.body.appendChild(container);
    let finishNativePlay!: () => void;
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string, options?: unknown) => {
      const element = originalCreateElement(tag as 'audio', options as undefined);
      if (tag === 'audio') {
        audio = element as HTMLAudioElement;
        element.load = () => {};
        let paused = true;
        Object.defineProperty(element, 'paused', { configurable: true, get: () => paused });
        element.play = () => {
          paused = false;
          order.push('audio:play');
          return new Promise<void>((resolve) => { finishNativePlay = resolve; });
        };
        element.pause = () => { paused = true; order.push('audio:pause'); };
      }
      return element;
    }) as typeof document.createElement);
    let api!: ReturnType<typeof useAudioPlayer>;
    const Host = () => { api = useAudioPlayer({}); return null; };
    act(() => { root = createRoot(container); root.render(createElement(Host)); });
    let attempt!: ReturnType<typeof api.playStation>;
    act(() => { attempt = api.playStation(station); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(order).toContain('audio:play');
    expect(category).toBe('playback');
    const nativePlayIndex = order.indexOf('audio:play');
    if (termination === 'stop') act(() => api.stop());
    else {
      act(() => root?.unmount());
      root = null;
    }
    expect(category).toBe('auto');
    expect(order.lastIndexOf('audio:pause')).toBeLessThan(order.lastIndexOf('category:auto'));
    finishNativePlay();
    await act(async () => { await attempt; });
    expect(order.slice(nativePlayIndex + 1).filter((item) => item === 'category:playback')).toEqual([]);
    expect(category).toBe('auto');
  });
});
