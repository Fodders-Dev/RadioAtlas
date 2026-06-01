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
  },
  {
    version: 1,
    id: 'aurora-field',
    name: 'Aurora Field',
    author: 'RadioAtlas',
    createdAt: BUILT_AT,
    updatedAt: BUILT_AT,
    builtin: true,
    layers: {
      accent: {
        hue: 164,
        sat: 84
      },
      background: {
        kind: 'gradient',
        gradient:
          "url('/theme-backgrounds/radioatlas-aurora.svg'), linear-gradient(180deg, #06151e 0%, #102a31 55%, #07111b 100%)"
      },
      font: {
        family: 'rounded'
      },
      icons: {
        style: 'soft'
      },
      emojiReactions: [
        {
          emoji: '✦',
          trigger: 'play',
          slot: 'dockRight'
        }
      ]
    }
  },
  {
    version: 1,
    id: 'signal-grid',
    name: 'Signal Grid',
    author: 'RadioAtlas',
    createdAt: BUILT_AT,
    updatedAt: BUILT_AT,
    builtin: true,
    layers: {
      accent: {
        hue: 214,
        sat: 88
      },
      background: {
        kind: 'gradient',
        gradient:
          "url('/theme-backgrounds/radioatlas-signal-grid.svg'), linear-gradient(180deg, #030914 0%, #09162d 54%, #050812 100%)"
      },
      font: {
        family: 'mono'
      },
      icons: {
        style: 'sharp'
      },
      emojiReactions: [
        {
          emoji: '⚡',
          trigger: 'play',
          slot: 'dockRight'
        }
      ]
    }
  },
  {
    version: 1,
    id: 'sunrise-dial',
    name: 'Sunrise Dial',
    author: 'RadioAtlas',
    createdAt: BUILT_AT,
    updatedAt: BUILT_AT,
    builtin: true,
    layers: {
      accent: {
        hue: 24,
        sat: 82
      },
      background: {
        kind: 'gradient',
        gradient:
          "url('/theme-backgrounds/radioatlas-sunrise-dial.svg'), linear-gradient(160deg, #1a0b2e 0%, #6b1d69 34%, #ef7441 70%, #0d1f2f 100%)"
      },
      font: {
        family: 'system'
      },
      icons: {
        style: 'round'
      },
      emojiReactions: [
        {
          emoji: '☀',
          trigger: 'like',
          slot: 'homeHeroCorner'
        }
      ]
    }
  },
  // T_share_4: the referral reward — a NEW exclusive theme, gated behind the
  // `referral-theme` entitlement (locked: true). The six free themes above are
  // untouched. A deep velvet/indigo wash with a warm gold accent so it reads as
  // a "premium" unlock distinct from every free theme. (Default colours — Артём
  // can retune the palette later without touching the gating.)
  {
    version: 1,
    id: 'velvet-hour',
    name: 'Velvet Hour',
    author: 'RadioAtlas',
    createdAt: BUILT_AT,
    updatedAt: BUILT_AT,
    builtin: true,
    locked: true,
    layers: {
      accent: {
        hue: 38,
        sat: 92
      },
      background: {
        kind: 'gradient',
        gradient:
          'radial-gradient(circle at 16% 10%, rgba(255, 196, 92, 0.16), transparent 22%), radial-gradient(circle at 84% 6%, rgba(168, 92, 255, 0.22), transparent 24%), linear-gradient(165deg, #120a1f 0%, #1b1030 46%, #0c0717 100%)'
      },
      font: {
        family: 'rounded'
      }
    }
  }
];

// T_share_4: id of the referral-reward theme (the locked exclusive added to the
// bundled list above). Exported so the gating layer doesn't hard-code the string.
export const REFERRAL_THEME_ID = 'velvet-hour';

export const getBundledThemeById = (themeId: string) =>
  DEFAULT_RADIOATLAS_THEMES.find((theme) => theme.id === themeId) || null;
