import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_RADIOATLAS_THEMES } from '../lib/theme/defaults';
import { hydrateGradientDraft } from '../lib/theme/gradientDraft';
import { useTheme, ThemeProvider } from '../state/ThemeContext';
import type { RadioAtlasTheme } from '../lib/theme/types';
import { ThemeBuilder } from './ThemeBuilder';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock('../state/LocaleContext', () => {
  const t = (key: string) => key;
  return { useLocale: () => ({ t }) };
});
vi.mock('../state/SessionContext', () => ({ useSession: () => ({ profile: null }) }));
vi.mock('../lib/useMobileLayout', () => ({ useMobileLayout: () => false }));

const setInputValue = (element: HTMLInputElement | HTMLSelectElement, value: string) => {
  const prototype = element instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  act(() => element.dispatchEvent(new Event('input', { bubbles: true })));
  act(() => element.dispatchEvent(new Event('change', { bubbles: true })));
};

const ThemeProbe = () => {
  const { currentTheme, currentThemeId } = useTheme();
  return createElement('output', {
    'data-theme-id': currentThemeId,
    'data-theme-background': currentTheme.layers.background?.kind === 'gradient'
      ? currentTheme.layers.background.gradient
      : ''
  });
};

const ThemeBuilderHarness = () => {
  const [seedTheme, setSeedTheme] = useState<RadioAtlasTheme | null>(null);
  return createElement(
    ThemeProvider,
    null,
    createElement(ThemeProbe),
    createElement(ThemeBuilder, {
      bundledThemes: DEFAULT_RADIOATLAS_THEMES,
      mode: seedTheme ? 'edit' : 'create',
      seedTheme,
      onSaved: setSeedTheme
    })
  );
};

describe('ThemeBuilder custom gradient persistence', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
  });

  it('keeps valid CSS outside the composer grammar exact until a control is edited', () => {
    const raw = 'radial-gradient(circle at 12% 8%, #d9f0e4, transparent 18%), linear-gradient(42.5deg, #f3d8bf, #e7d5ee)';
    const hydrated = hydrateGradientDraft(raw, [
      { color: '#10243a', position: 0 },
      { color: '#1d3f63', position: 52 },
      { color: '#080f1a', position: 100 }
    ]);
    expect(hydrated.exactGradient).toBe(raw);
    expect(hydrated.stops).toHaveLength(3);
  });

  it('applies a light three-stop gradient and keeps it when editing and saving the title', async () => {
    await act(async () => root.render(createElement(ThemeBuilderHarness)));

    const source = container.querySelector<HTMLSelectElement>('[data-theme-builder-background-source]')!;
    setInputValue(source, '__custom__');
    const lightMode = container.querySelector<HTMLButtonElement>('[data-theme-builder-mode="light"]')!;
    act(() => lightMode.click());

    const colors = ['#d9f0e4', '#f3d8bf', '#e7d5ee'];
    colors.forEach((color, index) => {
      const input = container.querySelector<HTMLInputElement>(`[data-theme-gradient-color="${index}"]`)!;
      setInputValue(input, color);
    });
    const expected = 'linear-gradient(160deg, #d9f0e4 0%, #f3d8bf 52%, #e7d5ee 100%)';
    const save = () => container.querySelector<HTMLButtonElement>('.settings-actions button')!.click();

    await act(async () => {
      save();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.documentElement.style.getPropertyValue('--theme-bg-image')).toBe(expected);
    expect(container.querySelector('[data-theme-background]')?.getAttribute('data-theme-background')).toBe(expected);
    expect(container.querySelector('[data-theme-builder-background]')?.getAttribute('data-theme-builder-background')).toBe('custom');
    expect(container.querySelector<HTMLButtonElement>('[data-theme-builder-mode="light"]')?.getAttribute('aria-pressed')).toBe('true');
    colors.forEach((color, index) => {
      expect(container.querySelector<HTMLInputElement>(`[data-theme-gradient-color="${index}"]`)?.value).toBe(color);
    });

    const name = container.querySelector<HTMLInputElement>('.theme-studio-builder-grid input[type="text"]')!;
    setInputValue(name, 'Mint editorial');
    await act(async () => {
      save();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.documentElement.style.getPropertyValue('--theme-bg-image')).toBe(expected);
    expect(container.querySelector('[data-theme-background]')?.getAttribute('data-theme-background')).toBe(expected);
  });
});
