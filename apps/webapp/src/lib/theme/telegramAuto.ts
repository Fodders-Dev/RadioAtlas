// T1.3: synthetic "Telegram-auto" theme. Slots into the existing
// ThemeContext resolution chain as a render-time override when the
// user has NOT picked an explicit Theme Studio theme and is inside
// the Telegram client.
//
// Per PB-2 mapping (3 keys, no inventing):
//   bg_color           → --theme-bg-image (wrapped as a flat gradient
//                        so the CSS var contract "gradient or url()"
//                        holds)
//   accent_text_color  → --theme-accent     (with link_color fallback)
//   button_color       → --theme-accent-2
//
// Per PB-4 floor: synthesis is suppressed when none of the 4 source
// keys (bg_color, accent_text_color, link_color, button_color) is
// present. Without that floor an inside-Telegram client with an
// empty themeParams payload would synthesise a theme that is
// pixel-identical to Classic, adding render-time noise and a stale
// dataset.theme="telegram-auto" attribute with no visible effect.
//
// CSS variables hold strings; the browser parses them at use-site.
// Telegram colours arrive as hex (e.g. "#1a1a1a"); RadioAtlas
// natively writes hsl(). Both forms are valid CSS — no conversion
// needed at the var-write boundary.

import type { TelegramThemeParams } from '../telegram';
import { DEFAULT_RADIOATLAS_THEMES } from './defaults';
import {
  THEME_DEFAULT_ACCENT,
  THEME_DEFAULT_ACCENT_2,
  THEME_DEFAULT_BACKGROUND,
  THEME_DEFAULT_FONT,
  THEME_DEFAULT_ICON_RADIUS,
  themeFontToCss,
  themeIconRadiusToCss
} from './runtime';
import type { RadioAtlasTheme } from './types';

export const TELEGRAM_AUTO_THEME_ID = 'telegram-auto';

const SOURCE_KEYS: Array<keyof TelegramThemeParams> = [
  'bg_color',
  'accent_text_color',
  'link_color',
  'button_color'
];

// Synthesis gate. Returns true iff at least one of our 4 source keys
// is present. The strict gate (only-4 not all-13) matters because
// keys we don't map (text_color, hint_color, etc.) would otherwise
// trigger synthesis with no visible difference vs. Classic.
export const telegramParamsHaveMappedKeys = (
  params: TelegramThemeParams | null
): params is TelegramThemeParams => {
  if (!params) return false;
  return SOURCE_KEYS.some((key) => Boolean(params[key]));
};

const getClassicLayers = (): RadioAtlasTheme['layers'] => {
  const classic = DEFAULT_RADIOATLAS_THEMES[0];
  return classic ? classic.layers : { accent: { hue: 178, sat: 78 } };
};

// The synthetic theme object. The `layers` field is intentionally
// the Classic theme's layers so anything that reads layers directly
// (e.g. emojiReactions, icon style) keeps the well-tuned Classic
// defaults. The 5 CSS-var values are NOT derived from `layers` for
// this id — see buildTelegramThemeVars below.
export const TELEGRAM_AUTO_THEME: RadioAtlasTheme = {
  version: 1,
  id: TELEGRAM_AUTO_THEME_ID,
  name: 'Telegram Auto',
  author: 'RadioAtlas',
  createdAt: 0,
  updatedAt: 0,
  builtin: true,
  layers: getClassicLayers()
};

type TelegramThemeVars = {
  accent: string;
  accent2: string;
  background: string;
  font: string;
  iconRadius: string;
};

// Maps validated themeParams → the same 5-var shape that
// themeRuntimeVars() produces, so ThemeContext can swap the source
// at the useLayoutEffect boundary without changing the write side.
// Missing keys fall back to Classic defaults (PB-4 best-effort).
export const buildTelegramThemeVars = (
  params: TelegramThemeParams
): TelegramThemeVars => {
  const classicLayers = getClassicLayers();
  // --theme-accent uses accent_text_color (preferred) → link_color
  // (fallback). NOT button_color — that's bound to --theme-accent-2;
  // collapsing both into one hex flattens the accent gradient.
  const accent = params.accent_text_color || params.link_color || THEME_DEFAULT_ACCENT;
  // --theme-accent-2 uses button_color exclusively. If absent, Classic
  // default keeps the gradient pair distinct.
  const accent2 = params.button_color || THEME_DEFAULT_ACCENT_2;
  // bg_color → flat gradient. Wrapping as linear-gradient(0deg, ...)
  // keeps the --theme-bg-image var consumable by any rule that
  // expects an `image` CSS type (background-image, mask-image).
  const background = params.bg_color
    ? `linear-gradient(0deg, ${params.bg_color}, ${params.bg_color})`
    : THEME_DEFAULT_BACKGROUND;
  // Font + icon radius have no clean themeParams equivalent; inherit
  // from Classic so the synthetic theme looks coherent with the rest
  // of RadioAtlas's chrome.
  const font = themeFontToCss(classicLayers.font) || THEME_DEFAULT_FONT;
  const iconRadius =
    themeIconRadiusToCss(classicLayers.icons) || THEME_DEFAULT_ICON_RADIUS;
  return { accent, accent2, background, font, iconRadius };
};
