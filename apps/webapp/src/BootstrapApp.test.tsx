import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Force the provider tree (AppProviders → RuntimeProviders → Session/Catalog/…)
// to throw during render, simulating a crash in a provider. If the top-level
// boundary in BootstrapApp genuinely wraps the provider tree, this lands on
// AppCrashFallback — NOT a white screen. (Stability lock-in for the audit:
// guards against a future refactor moving the boundary below the providers.)
vi.mock('./AppProviders', () => ({
  AppProviders: () => {
    throw new Error('provider-tree boom');
  }
}));
vi.mock('./lib/observability', () => ({ reportError: vi.fn() }));

import { BootstrapApp } from './BootstrapApp';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe('BootstrapApp provider error-boundary (stability lock-in)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    // React logs the caught render error to console.error; silence the noise.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('catches a throw in the provider tree and renders AppCrashFallback, not a white screen', () => {
    act(() => root.render(createElement(BootstrapApp)));

    // The crash fallback is shown (not an empty/white root).
    expect(container.querySelector('.app-crash-fallback')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain('Что-то пошло не так');
    // And a reload affordance exists.
    const reloadButton = Array.from(container.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('Перезагрузить')
    );
    expect(reloadButton).toBeTruthy();
  });
});
