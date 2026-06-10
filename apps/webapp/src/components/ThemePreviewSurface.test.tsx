import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { contrastRatio, type Rgb } from '../lib/theme/contrast';
import { parseCssColors } from '../lib/theme/previewContrast';
import { DEFAULT_RADIOATLAS_THEMES } from '../lib/theme/defaults';
import type { RadioAtlasTheme } from '../lib/theme/types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock('../state/LocaleContext', () => ({
  useLocale: () => ({ t: (key: string) => key })
}));

import { ThemePreviewSurface } from './ThemePreviewSurface';

const darkBase = DEFAULT_RADIOATLAS_THEMES[0];
const lightBase = DEFAULT_RADIOATLAS_THEMES.find((theme) => theme.mode === 'light')!;

const withGradient = (base: RadioAtlasTheme, gradient: string): RadioAtlasTheme => ({
  ...base,
  id: 'test-theme',
  name: 'Test theme',
  layers: {
    ...base.layers,
    background: { kind: 'gradient', gradient }
  }
});

// The builder's composeGradient output shape for a deliberately pale draft —
// the exact case that used to render the hardcoded near-white text on a pale
// background.
const PALE_GRADIENT = 'linear-gradient(160deg, #e8e2d8 0%, #f4efe6 55%, #efe6da 100%)';
const HOSTILE_GRADIENT = 'linear-gradient(90deg, #ffffff 0%, #000000 100%)';

const parseRgb = (css: string): Rgb => {
  const match = css.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!match) throw new Error(`not an rgb() string: ${css}`);
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
};

describe('ThemePreviewSurface contrast derivation (PR-4a)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (theme: RadioAtlasTheme) => {
    act(() => {
      root.render(createElement(ThemePreviewSurface, { theme }));
    });
    const surface = container.querySelector<HTMLElement>('.theme-preview-surface');
    if (!surface) throw new Error('preview surface did not render');
    return surface;
  };

  it('derives AA text (not the old hardcode) for a pale custom gradient, no badge', () => {
    const surface = render(withGradient(darkBase, PALE_GRADIENT));
    const text = surface.style.getPropertyValue('--preview-text').trim();
    expect(text).not.toBe('#f5fbff');
    const textRgb = parseRgb(text);
    for (const stop of parseCssColors(PALE_GRADIENT)) {
      expect(contrastRatio(textRgb, stop.rgb)).toBeGreaterThanOrEqual(4.5);
    }
    expect(surface.querySelector('[data-theme-preview-low-contrast]')).toBeNull();
  });

  it('shows the non-blocking badge on a gradient no text colour can survive', () => {
    const surface = render(withGradient(darkBase, HOSTILE_GRADIENT));
    const badge = surface.querySelector('[data-theme-preview-low-contrast]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('theme.lowContrastWarning');
  });

  it('keeps bundled dark presets badge-free with readable text', () => {
    for (const theme of DEFAULT_RADIOATLAS_THEMES) {
      if (theme.mode === 'light') continue;
      const surface = render(theme);
      expect(surface.querySelector('[data-theme-preview-low-contrast]')).toBeNull();
      expect(surface.style.getPropertyValue('--preview-text').trim()).not.toBe('');
    }
  });

  it('light mode keeps the LIGHT constants (no derivation, no badge)', () => {
    const surface = render(withGradient({ ...lightBase }, PALE_GRADIENT));
    expect(surface.dataset.previewMode).toBe('light');
    expect(surface.style.getPropertyValue('--preview-text').trim()).toBe('#241a17');
    expect(surface.querySelector('[data-theme-preview-low-contrast]')).toBeNull();
  });
});
