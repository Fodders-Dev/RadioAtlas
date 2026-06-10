// PR-4a: contrast derivation for the theme-editor PREVIEW. The live app is
// already guarded by themeTextVars (PR-1), but the builder preview hardcoded
// near-white text for every dark draft, ignoring the user-picked background —
// the root of the "text blends on skin change" regression. This module parses
// the draft's RESOLVED background CSS (the same string that becomes
// --preview-bg), flattens its colour stops, and derives preview text colours
// through the unit-tested WCAG math in contrast.ts (imported, never modified).
import {
  compositeRgb,
  contrastRatio,
  hslToRgb,
  readableTextColors,
  relativeLuminance,
  type Rgb
} from './contrast';

export type PreviewTextDerivation = {
  // CSS colours for --preview-text / --preview-muted, AA-derived against the
  // draft's actual background.
  text: string;
  muted: string;
  // True when even the best blend cannot reach WCAG AA (4.5:1) against every
  // background stop — the builder shows a non-blocking low-contrast badge.
  lowContrast: boolean;
};

// The historical dark shell base — the compositing floor for translucent
// gradient stops when a gradient carries no fully-opaque colour of its own.
const DARK_SHELL_BASE: Rgb = { r: 8, g: 17, b: 28 };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

type ParsedColor = { rgb: Rgb; alpha: number };

const parseHex = (raw: string): ParsedColor | null => {
  const hex = raw.slice(1);
  const expand = (s: string) => parseInt(s.length === 1 ? s + s : s, 16);
  if (hex.length === 3 || hex.length === 4) {
    return {
      rgb: { r: expand(hex[0]), g: expand(hex[1]), b: expand(hex[2]) },
      alpha: hex.length === 4 ? expand(hex[3]) / 255 : 1
    };
  }
  if (hex.length === 6 || hex.length === 8) {
    return {
      rgb: {
        r: expand(hex.slice(0, 2)),
        g: expand(hex.slice(2, 4)),
        b: expand(hex.slice(4, 6))
      },
      alpha: hex.length === 8 ? expand(hex.slice(6, 8)) / 255 : 1
    };
  }
  return null;
};

const parseFunctional = (fn: string, args: string): ParsedColor | null => {
  const parts = args
    .split(/[\s,\/]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 3) return null;
  const num = (value: string) => Number.parseFloat(value);
  const alphaPart = parts.length > 3 ? parts[3] : undefined;
  const alpha =
    alphaPart === undefined
      ? 1
      : alphaPart.endsWith('%')
        ? clamp01(num(alphaPart) / 100)
        : clamp01(num(alphaPart));
  if (!Number.isFinite(alpha)) return null;
  if (fn.startsWith('rgb')) {
    const channel = (value: string) =>
      value.endsWith('%') ? Math.round((num(value) / 100) * 255) : Math.round(num(value));
    const r = channel(parts[0]);
    const g = channel(parts[1]);
    const b = channel(parts[2]);
    if (![r, g, b].every(Number.isFinite)) return null;
    return { rgb: { r, g, b }, alpha };
  }
  // hsl/hsla
  const h = num(parts[0]);
  const s = num(parts[1]);
  const l = num(parts[2]);
  if (![h, s, l].every(Number.isFinite)) return null;
  return { rgb: hslToRgb(h, s, l), alpha };
};

// Extract every colour token from a CSS background value (gradient stops,
// layered gradients). Hex, rgb[a]() and hsl[a]() cover everything the builder
// and the bundled presets emit; url(...) image backgrounds yield nothing.
export const parseCssColors = (css: string): ParsedColor[] => {
  const colors: ParsedColor[] = [];
  const pattern = /#[0-9a-fA-F]{3,8}\b|(rgba?|hsla?)\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css)) !== null) {
    const parsed = match[0].startsWith('#')
      ? parseHex(match[0])
      : parseFunctional(match[1], match[2]);
    if (parsed) colors.push(parsed);
  }
  return colors;
};

// readableTextColors emits `rgb(r, g, b)` strings — parse one back for ratio
// checks without re-deriving its internals.
const parseRgbString = (css: string): Rgb | null => {
  const match = css.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!match) return null;
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
};

export const WCAG_AA_NORMAL = 4.5;

// Derive { text, muted, lowContrast } from a resolved background CSS string.
// Returns null when no colours can be extracted (image/asset backgrounds) —
// the caller keeps its historical fallback and shows no badge (we can't judge
// pixels we can't see).
export const derivePreviewTextColors = (
  backgroundCss: string
): PreviewTextDerivation | null => {
  const parsed = parseCssColors(backgroundCss);
  if (!parsed.length) return null;

  // Flatten: translucent stops composite over the darkest fully-opaque stop
  // (the gradient's own base); a gradient with no opaque stop sits on the dark
  // shell behind the preview.
  const opaque = parsed.filter((color) => color.alpha >= 0.99);
  const base = opaque.length
    ? opaque.reduce((darkest, color) =>
        relativeLuminance(color.rgb) < relativeLuminance(darkest.rgb) ? color : darkest
      ).rgb
    : DARK_SHELL_BASE;
  const stops = parsed.map((color) => compositeRgb(color.rgb, color.alpha, base));

  // Pick the text pair against the average surface, then judge readability
  // across the stops. The warning is a perception heuristic, not a strict
  // min-over-stops: bundled decorative gradients legitimately carry a small
  // bright bloom (Sunset's sun, Neon's glow) that a single-stop minimum would
  // false-flag, while a draft is genuinely unreadable when text fails on HALF
  // or more of its colour range (white→black) or on the representative
  // surface itself (uniform mid-grey, where neither white nor ink reaches AA).
  const average: Rgb = {
    r: Math.round(stops.reduce((sum, stop) => sum + stop.r, 0) / stops.length),
    g: Math.round(stops.reduce((sum, stop) => sum + stop.g, 0) / stops.length),
    b: Math.round(stops.reduce((sum, stop) => sum + stop.b, 0) / stops.length)
  };
  const { text, muted } = readableTextColors(average);
  const textRgb = parseRgbString(text);
  const failingStops = textRgb
    ? stops.filter((stop) => contrastRatio(textRgb, stop) < WCAG_AA_NORMAL).length
    : stops.length;
  const averageRatio = textRgb ? contrastRatio(textRgb, average) : 0;
  const lowContrast =
    averageRatio < WCAG_AA_NORMAL || failingStops / stops.length >= 0.5;

  return { text, muted, lowContrast };
};
