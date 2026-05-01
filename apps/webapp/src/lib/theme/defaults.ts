import type { RadioAtlasTheme } from './types';

const BUILT_AT = Date.UTC(2026, 4, 1, 0, 0, 0);

export const DEFAULT_THEME_ID = 'classic';

export const DEFAULT_RADIOATLAS_THEMES: RadioAtlasTheme[] = [
  {
    version: 1,
    id: DEFAULT_THEME_ID,
    name: 'Classic',
    author: 'RadioAtlas',
    createdAt: BUILT_AT,
    updatedAt: BUILT_AT,
    builtin: true,
    layers: {
      accent: {
        hue: 178,
        sat: 78
      },
      background: {
        kind: 'gradient',
        gradient: 'linear-gradient(160deg, #081825 0%, #0d2636 48%, #132d3c 100%)'
      },
      font: {
        family: 'system'
      }
    }
  },
  {
    version: 1,
    id: 'neon',
    name: 'Neon',
    author: 'RadioAtlas',
    createdAt: BUILT_AT,
    updatedAt: BUILT_AT,
    builtin: true,
    layers: {
      accent: {
        hue: 302,
        sat: 88
      },
      background: {
        kind: 'gradient',
        gradient: 'radial-gradient(circle at 20% 18%, #5526ff 0%, transparent 32%), linear-gradient(160deg, #070914 0%, #10142a 54%, #1d0b34 100%)'
      },
      font: {
        family: 'system'
      }
    }
  },
  {
    version: 1,
    id: 'pastel',
    name: 'Pastel',
    author: 'RadioAtlas',
    createdAt: BUILT_AT,
    updatedAt: BUILT_AT,
    builtin: true,
    layers: {
      accent: {
        hue: 32,
        sat: 72
      },
      background: {
        kind: 'gradient',
        gradient: 'linear-gradient(150deg, #f2c7b8 0%, #b8d7e8 48%, #d9c7f4 100%)'
      },
      font: {
        family: 'rounded'
      }
    }
  }
];

export const getBundledThemeById = (themeId: string) =>
  DEFAULT_RADIOATLAS_THEMES.find((theme) => theme.id === themeId) || null;
