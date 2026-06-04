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
  return `hsl(${normalizeHue(accent.hue)} ${Math.round(clamp(accent.sat, 0, 100))}% 68%)`;
};

export const themeAccentPairToCss = (accent: RadioAtlasTheme['layers']['accent']) => {
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
  accent2: themeAccentPairToCss(theme.layers.accent),
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
    surface: tint('rgba(17, 25, 38, 0.56)', 9),
    surface2: tint('rgba(28, 43, 63, 0.56)', 11),
    border: tint('rgba(236, 247, 255, 0.12)', 18)
  };
};
