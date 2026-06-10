import { describe, expect, it } from 'vitest';
import { contrastRatio, relativeLuminance, type Rgb } from './contrast';
import { DEFAULT_RADIOATLAS_THEMES } from './defaults';
import { THEME_DEFAULT_BACKGROUND, themeBackgroundToCss } from './runtime';
import { derivePreviewTextColors, parseCssColors, WCAG_AA_NORMAL } from './previewContrast';

const parseRgb = (css: string): Rgb => {
  const match = css.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!match) throw new Error(`not an rgb() string: ${css}`);
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
};

describe('parseCssColors', () => {
  it('extracts hex, rgba and hsl tokens from a layered gradient', () => {
    const colors = parseCssColors(
      'radial-gradient(circle at 10% 0%, rgba(140, 247, 230, 0.2), transparent 18%), linear-gradient(180deg, #07111c 0%, hsl(184 64% 68%) 100%)'
    );
    expect(colors).toHaveLength(3);
    expect(colors[0].alpha).toBeCloseTo(0.2, 5);
    expect(colors[1]).toEqual({ rgb: { r: 7, g: 17, b: 28 }, alpha: 1 });
  });

  it('returns nothing for image/asset backgrounds', () => {
    expect(parseCssColors('url("blob:https://app/abc-123")')).toHaveLength(0);
  });
});

describe('derivePreviewTextColors', () => {
  // The regression: the builder hardcoded near-white text for every dark
  // draft, so a pale custom gradient (composeGradient emits opaque hex stops)
  // rendered white-on-pale.
  it('pale custom gradient gets DARK text clearing AA against every stop', () => {
    const pale = 'linear-gradient(160deg, #e8e2d8 0%, #f4efe6 55%, #efe6da 100%)';
    const derived = derivePreviewTextColors(pale);
    expect(derived).not.toBeNull();
    const text = parseRgb(derived!.text);
    // Dark ink, not the old near-white hardcode.
    expect(relativeLuminance(text)).toBeLessThan(0.2);
    for (const stop of parseCssColors(pale)) {
      expect(contrastRatio(text, stop.rgb)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL);
    }
    expect(derived!.lowContrast).toBe(false);
    // Muted stays secondary but still clears AA on the pale surface.
    const muted = parseRgb(derived!.muted);
    for (const stop of parseCssColors(pale)) {
      expect(contrastRatio(muted, stop.rgb)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL);
    }
  });

  it('the bundled dark default background keeps light AA text and no warning', () => {
    const derived = derivePreviewTextColors(THEME_DEFAULT_BACKGROUND);
    expect(derived).not.toBeNull();
    const text = parseRgb(derived!.text);
    // Light text (readableTextColors blends white down to the AAA target, so
    // it lands around light-grey — well above any dark-ink luminance).
    expect(relativeLuminance(text)).toBeGreaterThan(0.35);
    expect(derived!.lowContrast).toBe(false);
  });

  it('flags a white-to-black gradient: no single text colour can clear AA on both ends', () => {
    const derived = derivePreviewTextColors('linear-gradient(90deg, #ffffff 0%, #000000 100%)');
    expect(derived).not.toBeNull();
    expect(derived!.lowContrast).toBe(true);
  });

  it('flags a mid-luminance surface where neither white nor ink reaches 4.5:1', () => {
    const derived = derivePreviewTextColors('linear-gradient(0deg, #777777 0%, #7a7a7a 100%)');
    expect(derived).not.toBeNull();
    expect(derived!.lowContrast).toBe(true);
  });

  it('composites translucent stops over the darkest opaque stop', () => {
    // A faint white radial over a dark base must not be treated as a white stop.
    const derived = derivePreviewTextColors(
      'radial-gradient(circle, rgba(255, 255, 255, 0.12), transparent 40%), linear-gradient(180deg, #08111c, #112437)'
    );
    expect(derived).not.toBeNull();
    expect(relativeLuminance(parseRgb(derived!.text))).toBeGreaterThan(0.35);
    expect(derived!.lowContrast).toBe(false);
  });

  it('returns null for an image background (caller keeps the fallback, no badge)', () => {
    expect(derivePreviewTextColors('url("blob:https://app/asset")')).toBeNull();
  });

  // Bundled-preview regression guard: every shipped dark preset (including the
  // decorative bloomed gradients — Sunset's sun, Neon's glow) derives cleanly
  // and never trips the warning.
  it('never flags a bundled dark preset', () => {
    for (const theme of DEFAULT_RADIOATLAS_THEMES) {
      if (theme.mode === 'light') continue;
      const css = themeBackgroundToCss(theme.layers.background, undefined);
      const derived = derivePreviewTextColors(css);
      expect(derived, theme.id).not.toBeNull();
      expect(derived!.lowContrast, theme.id).toBe(false);
    }
  });
});
