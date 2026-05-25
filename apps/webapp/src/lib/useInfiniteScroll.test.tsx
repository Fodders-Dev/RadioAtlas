import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useInfiniteScroll } from './useInfiniteScroll';

// Regression coverage for the T1.2-followup "Bug B" arm-guard. T2.11b
// retired StationTable's client-side reveal (now window-virtualized), so
// scroll-jitter.spec.ts — which exercised the arm-guard through that path
// — was removed. The hook itself stays in use by useStationSearch for
// SERVER-side pagination, where a cascade-fire would re-trigger the same
// scroll jitter. This unit test locks the arm-guard contract directly,
// independent of any caller.

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// jsdom has no IntersectionObserver; install a controllable shim that
// captures the callback so the test can drive intersection entries.
class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  private elements = new Set<Element>();

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  observe(element: Element) {
    this.elements.add(element);
  }
  unobserve(element: Element) {
    this.elements.delete(element);
  }
  disconnect() {
    this.elements.clear();
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  emit(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
}

const Host = ({ enabled, onLoadMore }: { enabled: boolean; onLoadMore: () => void }) => {
  const ref = useRef<HTMLDivElement>(null);
  useInfiniteScroll(ref, { enabled, onLoadMore });
  return createElement('div', { ref });
};

describe('useInfiniteScroll arm-guard (Bug B regression)', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  const originalIO = globalThis.IntersectionObserver;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    MockIntersectionObserver.instances = [];
    (globalThis as { IntersectionObserver: unknown }).IntersectionObserver =
      MockIntersectionObserver;
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    container.remove();
    (globalThis as { IntersectionObserver: unknown }).IntersectionObserver = originalIO;
  });

  const latestObserver = () =>
    MockIntersectionObserver.instances[MockIntersectionObserver.instances.length - 1];

  it('fires onLoadMore once per sentinel re-entry, never cascading', () => {
    const onLoadMore = vi.fn();
    act(() => {
      root = createRoot(container);
      root.render(createElement(Host, { enabled: true, onLoadMore }));
    });

    const observer = latestObserver();
    expect(observer).toBeTruthy();

    // First intersection → exactly one fire, then disarmed.
    act(() => observer.emit(true));
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    // Still intersecting (the freshly revealed batch keeps the sentinel
    // inside rootMargin): the guard must NOT fire again. This is the
    // cascade that Bug B introduced.
    act(() => observer.emit(true));
    act(() => observer.emit(true));
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    // Sentinel leaves the viewport → re-arm. No fire on leaving.
    act(() => observer.emit(false));
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    // Re-entry → exactly one more fire.
    act(() => observer.emit(true));
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it('does not observe when disabled', () => {
    const onLoadMore = vi.fn();
    act(() => {
      root = createRoot(container);
      root.render(createElement(Host, { enabled: false, onLoadMore }));
    });

    // enabled:false short-circuits before constructing an observer.
    expect(MockIntersectionObserver.instances).toHaveLength(0);
    expect(onLoadMore).not.toHaveBeenCalled();
  });
});
