import { describe, expect, it } from 'vitest';
import {
  MUTED_TARGET,
  TEXT_TARGET,
  compositeRgb,
  contrastRatio,
  hslToRgb,
  readableTextColors,
  relativeLuminance,
  type Rgb
} from './contrast';
import { DEFAULT_RADIOATLAS_THEMES } from './defaults';
import { themeSurfaceColor, themeTextVars } from './runtime';

const parseRgb = (css: string): Rgb => {
  const match = css.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!match) throw new Error(`not an rgb() string: ${css}`);
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
};

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

describe('contrast primitives', () => {
  it('relativeLuminance bounds: white = 1, black = 0', () => {
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 5);
    expect(relativeLuminance(BLACK)).toBeCloseTo(0, 5);
  });

  it('contrastRatio of black vs white is the WCAG maximum 21:1', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 4);
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 4);
  });

  it('hslToRgb produces the expected primaries', () => {
    expect(hslToRgb(0, 100, 50)).toEqual({ r: 255, g: 0, b: 0 });
    expect(hslToRgb(120, 100, 50)).toEqual({ r: 0, g: 255, b: 0 });
    expect(hslToRgb(240, 100, 50)).toEqual({ r: 0, g: 0, b: 255 });
    expect(hslToRgb(0, 0, 100)).toEqual(WHITE);
  });

  it('compositeRgb blends a translucent foreground over a background', () => {
    expect(compositeRgb(WHITE, 0, BLACK)).toEqual(BLACK);
    expect(compositeRgb(WHITE, 1, BLACK)).toEqual(WHITE);
    expect(compositeRgb(WHITE, 0.5, BLACK)).toEqual({ r: 128, g: 128, b: 128 });
  });
});

describe('readableTextColors', () => {
  // A spread of surfaces: deep navy, bright amber-tinted mid, magenta-tinted mid,
  // near-white cream — text/muted must clear AA against each.
  const surfaces: Rgb[] = [
    { r: 17, g: 25, b: 38 },
    { r: 120, g: 96, b: 30 },
    { r: 110, g: 40, b: 110 },
    { r: 60, g: 60, b: 60 },
    { r: 230, g: 228, b: 224 }
  ];

  for (const surface of surfaces) {
    it(`muted clears AA (4.5:1) and text is at least as readable on rgb(${surface.r},${surface.g},${surface.b})`, () => {
      const { text, muted } = readableTextColors(surface);
      const mutedRatio = contrastRatio(parseRgb(muted), surface);
      const textRatio = contrastRatio(parseRgb(text), surface);
      // muted always clears the AA threshold for normal text. (The 4.6 TARGET is
      // what we aim for; on a mid-luminance surface where neither white nor black
      // can reach it, it's capped at the max achievable, which is still > 4.5.)
      expect(mutedRatio).toBeGreaterThanOrEqual(4.5);
      // primary text is at least as readable as muted, and aims for TEXT_TARGET
      // where the surface allows it.
      expect(textRatio).toBeGreaterThanOrEqual(mutedRatio);
    });
  }

  it('text reaches the high target on a dark surface that allows it', () => {
    const { text } = readableTextColors({ r: 17, g: 25, b: 38 });
    expect(contrastRatio(parseRgb(text), { r: 17, g: 25, b: 38 })).toBeGreaterThanOrEqual(TEXT_TARGET);
  });
});

describe('themeTextVars guarantees WCAG AA on every bundled theme', () => {
  for (const theme of DEFAULT_RADIOATLAS_THEMES) {
    it(`${theme.name} muted clears 4.5:1 against its surface`, () => {
      const surface = themeSurfaceColor(theme);
      const { text, muted } = themeTextVars(theme);
      // 4.5:1 is the WCAG AA threshold for normal-size secondary text.
      expect(contrastRatio(parseRgb(muted), surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(parseRgb(text), surface)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('a hostile bright custom theme still gets AA secondary text', () => {
    // The 2d editor lets an author pick anything — e.g. a near-white accent with
    // a cranked chrome tint. The derived muted must still clear AA automatically.
    const hostile = {
      ...DEFAULT_RADIOATLAS_THEMES[0],
      id: 'custom-hostile',
      name: 'Custom Hostile',
      chromeTint: 6,
      layers: {
        ...DEFAULT_RADIOATLAS_THEMES[0].layers,
        accent: { hue: 52, sat: 100, lightness: 92 }
      }
    };
    const surface = themeSurfaceColor(hostile);
    const { muted } = themeTextVars(hostile);
    expect(contrastRatio(parseRgb(muted), surface)).toBeGreaterThanOrEqual(4.5);
  });
});
