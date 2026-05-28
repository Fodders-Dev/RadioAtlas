import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ErrorInfo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ErrorBoundary } from './ErrorBoundary';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let shouldThrow = true;
let throwMessage = 'boom';
const Thrower = () => {
  if (shouldThrow) throw new Error(throwMessage);
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

  // jsdom marks window.location.reload as non-configurable, so vi.spyOn fails
  // with "Cannot redefine property: reload". Stash/replace the whole location
  // object — restored in afterEach.
  let originalLocation: Location;
  let reloadSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    shouldThrow = true;
    throwMessage = 'boom';
    window.sessionStorage.clear();
    originalLocation = window.location;
    reloadSpy = vi.fn();
    delete (window as { location?: Location }).location;
    (window as { location: Location }).location = {
      ...originalLocation,
      reload: reloadSpy as unknown as Location['reload']
    };
    // React logs caught errors to console.error in dev; silence the noise.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    (window as { location: Location }).location = originalLocation;
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

  // T_audit_6: stale-chunk recovery (timestamp-guarded reload).
  const CHUNK_ERR = "Failed to fetch dynamically imported module: assets/Home-abc123.js";
  const RELOAD_KEY = 'radioatlas:chunkReloadAt';

  it('T_audit_6: reloads once on a stale-chunk error and records the timestamp', () => {
    throwMessage = CHUNK_ERR;
    renderBoundary((retry) => createElement('div', { id: 'fb' }, 'fb'));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    const stored = Number(window.sessionStorage.getItem(RELOAD_KEY));
    expect(stored).toBeGreaterThan(Date.now() - 5_000);
  });

  it('T_audit_6: a recent reload timestamp suppresses further reloads (loop safeguard)', () => {
    throwMessage = CHUNK_ERR;
    // Simulate: the previous reload set this 2s ago — still inside the cooldown.
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now() - 2_000));
    renderBoundary((retry) => createElement('div', { id: 'fb' }, 'fb'));
    expect(reloadSpy).not.toHaveBeenCalled();
    // The fallback UI takes over — the user sees the error, no infinite reload.
    expect(document.getElementById('fb')?.textContent).toBe('fb');
  });

  it('T_audit_6: an old timestamp (outside the cooldown) allows recovery on a later deploy', () => {
    throwMessage = CHUNK_ERR;
    // Last reload happened 20s ago — outside the 10s cooldown window.
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now() - 20_000));
    renderBoundary((retry) => createElement('div', { id: 'fb' }, 'fb'));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('T_audit_6: non-chunk errors do NOT trigger a reload', () => {
    throwMessage = 'Cannot read properties of undefined (reading "x")';
    renderBoundary((retry) => createElement('div', { id: 'fb' }, 'fb'));
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(RELOAD_KEY)).toBeNull();
  });
});
