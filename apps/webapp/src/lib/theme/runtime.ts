import { compositeRgb, hslToRgb, mixRgb, readableTextColors, type Rgb } from './contrast';
import type { RadioAtlasTheme, ThemeBackgroundLayer, ThemeFontLayer, ThemeIconLayer } from './types';

export const THEME_DEFAULT_ACCENT = '#94f0ea';
export const THEME_DEFAULT_ACCENT_2 = '#93b7ff';
export const THEME_DEFAULT_BACKGROUND =
  'radial-gradient(circle at 12% 8%, rgba(140, 247, 230, 0.2), transparent 18%), radial-gradient(circle at 82% 4%, rgba(150, 193, 255, 0.24), transparent 18%), radial-gradient(circle at 50% 78%, rgba(76, 137, 255, 0.16), transparent 28%), linear-gradient(180deg, #07111c 0%, #091824 34%, #0b1724 68%, #07111b 100%)';
export const THEME_DEFAULT_FONT =
  "'Manrope', 'Space Grotesk', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
export const THEME_DEFAULT_ICON_RADIUS = '999px';

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

const normalizeHue = (hue: number) => {
  if (!Number.isFinite(hue)) return 0;
  return ((Math.round(hue) % 360) + 360) % 360;
};

export const themeAccentToCss = (accent: RadioAtlasTheme['layers']['accent']) => {
  if (!accent) return THEME_DEFAULT_ACCENT;
  // P2-2d: honour an explicit lightness; absent keeps the historical 68%.
  const lightness = Math.round(clamp(accent.lightness ?? 68, 0, 100));
  return `hsl(${normalizeHue(accent.hue)} ${Math.round(clamp(accent.sat, 0, 100))}% ${lightness}%)`;
};

export const themeAccentPairToCss = (
  accent: RadioAtlasTheme['layers']['accent'],
  accent2?: RadioAtlasTheme['layers']['accent2']
) => {
  // P2-2d: an explicit secondary accent wins; otherwise derive from the primary
  // (hue+42, sat*0.74, 70%) exactly as before.
  if (accent2) {
    const lightness = Math.round(clamp(accent2.lightness ?? 70, 0, 100));
    return `hsl(${normalizeHue(accent2.hue)} ${Math.round(clamp(accent2.sat, 0, 100))}% ${lightness}%)`;
  }
  if (!accent) return THEME_DEFAULT_ACCENT_2;
  const hue = normalizeHue(accent.hue + 42);
  const sat = Math.round(clamp(accent.sat * 0.74, 0, 100));
  return `hsl(${hue} ${sat}% 70%)`;
};

export const themeFontToCss = (font?: ThemeFontLayer) => {
  switch (font?.family) {
    case 'mono':
      return "'SFMono-Regular', Consolas, 'Liberation Mono', monospace";
    case 'serif':
      return "Georgia, 'Times New Roman', serif";
    case 'rounded':
      return "'Manrope', 'Space Grotesk', 'Trebuchet MS', system-ui, sans-serif";
    case 'system':
    default:
      return THEME_DEFAULT_FONT;
  }
};

export const themeIconRadiusToCss = (icons?: ThemeIconLayer) => {
  switch (icons?.style) {
    case 'sharp':
      return '10px';
    case 'soft':
      return '18px';
    case 'round':
    default:
      return THEME_DEFAULT_ICON_RADIUS;
  }
};

export const themeBackgroundToCss = (
  background: ThemeBackgroundLayer | undefined,
  resolveAssetUrl?: (assetId: string) => string | null
) => {
  if (!background) return THEME_DEFAULT_BACKGROUND;
  if (background.kind === 'gradient') {
    return background.gradient || THEME_DEFAULT_BACKGROUND;
  }

  const assetUrl = resolveAssetUrl?.(background.assetId);
  return assetUrl ? `url(${JSON.stringify(assetUrl)})` : THEME_DEFAULT_BACKGROUND;
};

export const themeRuntimeVars = (
  theme: RadioAtlasTheme,
  resolveAssetUrl?: (assetId: string) => string | null
) => ({
  accent: themeAccentToCss(theme.layers.accent),
  accent2: themeAccentPairToCss(theme.layers.accent, theme.layers.accent2),
  background: themeBackgroundToCss(theme.layers.background, resolveAssetUrl),
  font: themeFontToCss(theme.layers.font),
  iconRadius: themeIconRadiusToCss(theme.layers.icons)
});

// P1b: dark-theme chrome that picks up the theme's own accent — the lever that
// makes each preset feel crafted (panels/border carry the accent hue) instead of
// every dark theme sharing one neutral chrome. Returns null for light themes so
// the :root[data-theme-mode='light'] surface block in styles.css applies instead
// (inline styles would otherwise override it). Percentages are small — a calm
// accent (clean-dark) stays near-neutral; a vivid one (neon) tints visibly.
export const themeSurfaceVars = (theme: RadioAtlasTheme) => {
  if (theme.mode === 'light') return null;
  const accent = themeAccentToCss(theme.layers.accent);
  // P1b: per-theme strength. A warm accent (Sunset/Signal Grid) washes toward
  // neutral when mixed into the cool base panel at the baseline %, so those crank
  // it up to read as warm; Neon dials it down a touch. Absent => ×1 (unchanged).
  const k = clamp(theme.chromeTint ?? 1, 0, 6);
  const tint = (base: string, pct: number) => {
    const mix = clamp(pct * k, 0, 100);
    return `color-mix(in srgb, ${base} ${100 - mix}%, ${accent} ${mix}%)`;
  };
  return {
    bg: tint('#08111c', 5),
    bg2: tint('#112437', 7),
    // P1: text-bearing panels are now near-opaque (0.85, was 0.56) so a bright
    // decorative gradient can't bleed through UNDER secondary text and sink its
    // contrast. The background still shows in the gaps / around tiles / behind
    // artwork, so the theme stays decorative. --theme-muted/-text are derived to
    // clear WCAG AA against exactly this surface (see themeTextVars).
    surface: tint('rgba(17, 25, 38, 0.85)', 9),
    surface2: tint('rgba(28, 43, 63, 0.85)', 11),
    border: tint('rgba(236, 247, 255, 0.12)', 18)
  };
};

// P1: the dark surface base (matches themeSurfaceVars' surface base, opaque form).
const DARK_SURFACE_BASE: Rgb = { r: 17, g: 25, b: 38 };
// The light surface base (matches the :root[data-theme-mode='light'] block).
const LIGHT_SURFACE_BASE: Rgb = { r: 255, g: 252, b: 248 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };
// How much of the decorative gradient can still bleed through the near-opaque
// panel — we size the surface alpha so this is small, then size the text colours
// for the worst case (brightest bleed on dark themes, darkest on light).
const BLEED = 0.15;

// P1: the WORST-CASE opaque surface the secondary text actually sits on — the
// near-opaque panel colour plus the small gradient bleed that still shows
// through (brightest bleed on dark themes, darkest on light, since that's the
// lowest-contrast case). Mirrors themeSurfaceVars' surface derivation; exported
// so tests can assert the derived colours clear AA against it.
export const themeSurfaceColor = (theme: RadioAtlasTheme): Rgb => {
  const accent = theme.layers.accent;
  // Matches themeAccentToCss: explicit lightness, else the historical 68%; no
  // accent falls back to THEME_DEFAULT_ACCENT (#94f0ea).
  const accentRgb = accent
    ? hslToRgb(accent.hue, accent.sat, accent.lightness ?? 68)
    : { r: 148, g: 240, b: 234 };

  if (theme.mode === 'light') {
    return compositeRgb(BLACK, BLEED, LIGHT_SURFACE_BASE);
  }

  const k = clamp(theme.chromeTint ?? 1, 0, 6);
  const surfaceTint = clamp(9 * k, 0, 100) / 100;
  const surfaceColor = mixRgb(DARK_SURFACE_BASE, accentRgb, surfaceTint);
  return compositeRgb(WHITE, BLEED, surfaceColor);
};

// P1: luminance-aware text colours, guaranteed to clear WCAG AA against the
// theme's actual surface — for every preset and for custom themes, since it
// derives from the same accent/mode/tint inputs (no trust in the author).
export const themeTextVars = (theme: RadioAtlasTheme): { text: string; muted: string } =>
  readableTextColors(themeSurfaceColor(theme));
