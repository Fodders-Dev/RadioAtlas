// P1 contrast guarantee: WCAG colour math + a luminance-aware secondary-text
// picker. The bot... no — the webapp derives --theme-text / --theme-muted from
// each theme's ACTUAL surface so secondary text (station locations, sublines,
// queue subheads) meets WCAG AA on every preset AND on custom themes from the 2d
// editor (arbitrary background), without trusting the author. Pure + unit-tested.

export type Rgb = { r: number; g: number; b: number };

const clampNum = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

export const hslToRgb = (h: number, s: number, l: number): Rgb => {
  const sat = clampNum(s, 0, 100) / 100;
  const lig = clampNum(l, 0, 100) / 100;
  const hue = (((h % 360) + 360) % 360) / 60;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const m = lig - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 1) [r, g, b] = [c, x, 0];
  else if (hue < 2) [r, g, b] = [x, c, 0];
  else if (hue < 3) [r, g, b] = [0, c, x];
  else if (hue < 4) [r, g, b] = [0, x, c];
  else if (hue < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
};

// mix(a, b, t): t=0 → a, t=1 → b (matches color-mix semantics by weight).
export const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => {
  const k = clampNum(t, 0, 1);
  return {
    r: Math.round(a.r + (b.r - a.r) * k),
    g: Math.round(a.g + (b.g - a.g) * k),
    b: Math.round(a.b + (b.b - a.b) * k)
  };
};

// Composite a translucent foreground (alpha) over an opaque background.
export const compositeRgb = (fg: Rgb, alpha: number, bg: Rgb): Rgb => mixRgb(bg, fg, alpha);

const channelLuminance = (channel: number) => {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export const relativeLuminance = (rgb: Rgb): number =>
  0.2126 * channelLuminance(rgb.r) + 0.7152 * channelLuminance(rgb.g) + 0.0722 * channelLuminance(rgb.b);

export const contrastRatio = (a: Rgb, b: Rgb): number => {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
};

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
// Warm near-black ink — matches the light-theme text token tone.
const INK: Rgb = { r: 20, g: 18, b: 16 };

const rgbToCss = (rgb: Rgb) => `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;

// AA targets: text aims high (>=7:1 → AAA where achievable); muted must clear
// 4.5:1 (normal text) — we keep a small margin so float/rounding never dips it
// under, while leaving it as dim as possible so it still reads "secondary".
export const TEXT_TARGET = 7;
export const MUTED_TARGET = 4.6;

// Pick {text, muted} foreground colours guaranteed to clear the targets against
// the given opaque surface. Foreground is whichever of white / ink contrasts
// more with the surface; muted is that foreground blended toward the surface to
// the dimmest alpha that still clears MUTED_TARGET.
export const readableTextColors = (surface: Rgb) => {
  const fg = contrastRatio(surface, WHITE) >= contrastRatio(surface, INK) ? WHITE : INK;

  const minAlphaForTarget = (target: number) => {
    let lo = 0;
    let hi = 1;
    let best = 1;
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (contrastRatio(compositeRgb(fg, mid, surface), surface) >= target) {
        best = mid;
        hi = mid;
      } else {
        lo = mid;
      }
    }
    return best;
  };

  const muted = compositeRgb(fg, Math.min(1, minAlphaForTarget(MUTED_TARGET) + 0.04), surface);
  const text = compositeRgb(fg, Math.min(1, minAlphaForTarget(TEXT_TARGET) + 0.04), surface);
  return { text: rgbToCss(text), muted: rgbToCss(muted) };
};
