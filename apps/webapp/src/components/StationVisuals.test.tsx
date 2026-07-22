import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { StationLite } from '../types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const sceneMocks = vi.hoisted(() => ({
  resolveSceneArtworkUrl: vi.fn<() => Promise<string | null>>()
}));

vi.mock('../lib/sceneArtwork', () => ({
  resolveSceneArtworkUrl: sceneMocks.resolveSceneArtworkUrl
}));

import { StationArtwork } from './StationArtwork';
import { StationScene } from './StationScene';

const makeStation = (overrides: Partial<StationLite> = {}): StationLite =>
  ({
    stationuuid: 'station-visual-test',
    name: 'Tokyo Test Radio',
    url_resolved: 'https://radio.test/stream',
    homepage: '',
    favicon: '',
    country: 'Japan',
    state: 'Tokyo',
    tags: 'city pop',
    stationArtwork: '',
    description: '',
    websiteUrl: '',
    scheduleNote: '',
    isClaimed: false,
    isVerified: false,
    promoted: false,
    ...overrides
  }) as StationLite;

describe('station visual semantics', () => {
  let container: HTMLDivElement;
  let root: Root;

  const mount = async (node: ReactElement) => {
    await act(async () => {
      root.render(node);
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    sceneMocks.resolveSceneArtworkUrl.mockReset();
    sceneMocks.resolveSceneArtworkUrl.mockResolvedValue(null);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('keeps StationArtwork on owner artwork and never asks for an AI scene', async () => {
    await mount(
      createElement(StationArtwork, {
        station: makeStation({
          stationArtwork: 'https://images.test/owner-artwork.png',
          favicon: 'https://images.test/favicon.png'
        }),
        size: 'card'
      })
    );

    const artwork = container.querySelector<HTMLElement>('.station-artwork')!;
    expect(artwork.dataset.artworkSource).toBe('station-artwork');
    expect(artwork.querySelector('img')?.getAttribute('src')).toBe(
      'https://images.test/owner-artwork.png'
    );
    expect(sceneMocks.resolveSceneArtworkUrl).not.toHaveBeenCalled();
  });

  it('falls from broken stationArtwork to favicon, then keeps a procedural identity fallback', async () => {
    await mount(
      createElement(StationArtwork, {
        station: makeStation({
          name: 'Radio Alpha',
          stationArtwork: 'https://images.test/broken-owner.png',
          favicon: 'https://images.test/working-favicon.png'
        })
      })
    );

    act(() => {
      container.querySelector('img')!.dispatchEvent(new Event('error'));
    });
    expect(container.querySelector<HTMLElement>('.station-artwork')!.dataset.artworkSource).toBe(
      'favicon'
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://images.test/working-favicon.png'
    );

    act(() => {
      container.querySelector('img')!.dispatchEvent(new Event('error'));
    });
    const fallback = container.querySelector<HTMLElement>('.station-artwork')!;
    expect(fallback.dataset.artworkSource).toBe('generated');
    expect(fallback.dataset.hasImage).toBe('false');
    expect(fallback.querySelector('img')).toBeNull();
    expect(fallback.textContent).toBe('R');
  });

  it('renders a cached StationScene only as a decorative opt-in layer', async () => {
    sceneMocks.resolveSceneArtworkUrl.mockResolvedValue(
      'https://radioatlas.test/api/artwork/scenes/tokyo.jpg'
    );
    const station = makeStation({ stationArtwork: 'https://images.test/owner-logo.png' });

    await mount(createElement(StationScene, { station, priority: true }));

    const scene = container.querySelector<HTMLElement>('.station-scene')!;
    const image = scene.querySelector('img')!;
    expect(scene.getAttribute('aria-hidden')).toBe('true');
    expect(scene.dataset.sceneSource).toBe('scene');
    expect(image.getAttribute('src')).toBe(
      'https://radioatlas.test/api/artwork/scenes/tokyo.jpg'
    );
    expect(image.getAttribute('alt')).toBe('');
    expect(image.getAttribute('loading')).toBe('eager');
    expect(image.getAttribute('fetchpriority')).toBe('high');
    expect(image.getAttribute('src')).not.toBe(station.stationArtwork);
    expect(sceneMocks.resolveSceneArtworkUrl).toHaveBeenCalledOnce();
    expect(sceneMocks.resolveSceneArtworkUrl).toHaveBeenCalledWith(station.stationuuid);
  });

  it('keeps the procedural StationScene when the optional scene is missing or broken', async () => {
    sceneMocks.resolveSceneArtworkUrl.mockResolvedValue(
      'https://radioatlas.test/api/artwork/scenes/broken.jpg'
    );

    await mount(
      createElement(StationScene, {
        station: makeStation({ stationArtwork: 'https://images.test/owner-logo-2.png' })
      })
    );
    act(() => {
      container.querySelector('.station-scene img')!.dispatchEvent(new Event('error'));
    });

    const scene = container.querySelector<HTMLElement>('.station-scene')!;
    expect(scene.dataset.sceneSource).toBe('generated');
    expect(scene.querySelector('img')).toBeNull();
    expect(scene.querySelector('.station-artwork')).toBeNull();
  });

  it('defers non-priority scene lookup until the card approaches the viewport', async () => {
    let emitIntersection: ((isIntersecting: boolean) => void) | null = null;

    class MockIntersectionObserver {
      readonly root = null;
      readonly rootMargin = '320px 240px';
      readonly thresholds = [0];

      constructor(callback: IntersectionObserverCallback) {
        emitIntersection = (isIntersecting) =>
          callback(
            [{ isIntersecting } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver
          );
      }

      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    }

    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    await mount(createElement(StationScene, { station: makeStation() }));

    expect(sceneMocks.resolveSceneArtworkUrl).not.toHaveBeenCalled();

    await act(async () => {
      emitIntersection?.(false);
      await Promise.resolve();
    });
    expect(sceneMocks.resolveSceneArtworkUrl).not.toHaveBeenCalled();

    await act(async () => {
      emitIntersection?.(true);
      await Promise.resolve();
    });
    expect(sceneMocks.resolveSceneArtworkUrl).toHaveBeenCalledOnce();
    expect(sceneMocks.resolveSceneArtworkUrl).toHaveBeenCalledWith('station-visual-test');
  });
});
