import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ErrorInfo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ErrorBoundary } from './ErrorBoundary';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let shouldThrow = true;
const Thrower = () => {
  if (shouldThrow) throw new Error('boom');
  return createElement('div', { id: 'ok' }, 'recovered');
};

describe('ErrorBoundary (T1.7)', () => {
  let container: HTMLDivElement;
  let root: Root;

  const renderBoundary = (
    fallback: (retry: () => void) => ReactNode,
    onError: (error: Error, info: ErrorInfo) => void = () => {}
  ) =>
    act(() =>
      root.render(
        createElement(ErrorBoundary, { fallback, onError, children: createElement(Thrower) })
      )
    );

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    shouldThrow = true;
    // React logs caught errors to console.error in dev; silence the noise.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('renders the fallback and reports the error when a child throws', () => {
    const onError = vi.fn();
    renderBoundary(
      (retry) => createElement('button', { id: 'retry', onClick: retry }, 'fallback shown'),
      onError
    );
    expect(document.getElementById('retry')?.textContent).toBe('fallback shown');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0]?.[1]).toHaveProperty('componentStack');
  });

  it('recovers on retry when the child no longer throws', () => {
    renderBoundary((retry) =>
      createElement('button', { id: 'retry', onClick: retry }, 'fallback')
    );
    expect(document.getElementById('ok')).toBeNull();
    shouldThrow = false; // the remount on retry will render cleanly
    act(() => document.getElementById('retry')?.click());
    expect(document.getElementById('ok')?.textContent).toBe('recovered');
  });

  it('renders children untouched when nothing throws', () => {
    shouldThrow = false;
    renderBoundary(() => createElement('div', { id: 'fb' }, 'fb'));
    expect(document.getElementById('ok')?.textContent).toBe('recovered');
    expect(document.getElementById('fb')).toBeNull();
  });
});
