import type { RadioAtlasTheme, ThemeBackgroundLayer, ThemeFontLayer } from './types';

export const THEME_DEFAULT_ACCENT = '#94f0ea';
export const THEME_DEFAULT_ACCENT_2 = '#93b7ff';
export const THEME_DEFAULT_BACKGROUND =
  'radial-gradient(circle at 12% 8%, rgba(140, 247, 230, 0.2), transparent 18%), radial-gradient(circle at 82% 4%, rgba(150, 193, 255, 0.24), transparent 18%), radial-gradient(circle at 50% 78%, rgba(76, 137, 255, 0.16), transparent 28%), linear-gradient(180deg, #07111c 0%, #091824 34%, #0b1724 68%, #07111b 100%)';
export const THEME_DEFAULT_FONT =
  "'Manrope', 'Space Grotesk', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

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
  font: themeFontToCss(theme.layers.font)
});
