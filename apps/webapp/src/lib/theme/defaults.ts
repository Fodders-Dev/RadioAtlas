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
        gradient:
          'radial-gradient(circle at 12% 8%, rgba(140, 247, 230, 0.2), transparent 18%), radial-gradient(circle at 82% 4%, rgba(150, 193, 255, 0.24), transparent 18%), radial-gradient(circle at 50% 78%, rgba(76, 137, 255, 0.16), transparent 28%), linear-gradient(180deg, #07111c 0%, #091824 34%, #0b1724 68%, #07111b 100%)'
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
