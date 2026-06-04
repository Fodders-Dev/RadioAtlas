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
    // clean-dark: calibrated minimal dark — a calm cyan accent and a quiet
    // single-source glow. The neutral baseline the others depart from.
    layers: {
      accent: {
        hue: 184,
        sat: 64
      },
      background: {
        kind: 'gradient',
        gradient:
          'radial-gradient(120% 80% at 50% -12%, rgba(120, 224, 232, 0.12) 0%, transparent 46%), linear-gradient(180deg, #08121d 0%, #0a1623 52%, #070f19 100%)'
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
    // vivid-neon: electric magenta against a cyan counter-glow on near-black —
    // the loudest preset. Sharp corners for an arcade edge. Chrome tint pulled
    // back slightly so the magenta panels stay bold without overwhelming.
    chromeTint: 0.85,
    layers: {
      accent: {
        hue: 304,
        sat: 96
      },
      background: {
        kind: 'gradient',
        gradient:
          'radial-gradient(circle at 16% 12%, rgba(216, 42, 255, 0.5) 0%, transparent 34%), radial-gradient(circle at 88% 86%, rgba(40, 226, 255, 0.32) 0%, transparent 38%), linear-gradient(155deg, #060410 0%, #0b0820 56%, #150720 100%)'
      },
      font: {
        family: 'system'
      },
      icons: {
        style: 'sharp'
      }
    }
  },
  {
    version: 1,
    id: 'pastel',
    name: 'Warm Light',
    author: 'RadioAtlas',
    createdAt: BUILT_AT,
    updatedAt: BUILT_AT,
    builtin: true,
    // warm-light: the mode:'light' showcase — clean cream/peach surfaces with
    // dark ink (from the light surface block) and a coral accent. Rounded + soft
    // for an airy daytime feel.
    mode: 'light',
    layers: {
      accent: {
        hue: 14,
        sat: 82
      },
      background: {
        kind: 'gradient',
        gradient:
          'radial-gradient(120% 90% at 12% 0%, #fff6ec 0%, transparent 46%), linear-gradient(162deg, #fbf1e6 0%, #f6e1d1 50%, #f0d4c2 100%)'
      },
      font: {
        family: 'rounded'
      },
      icons: {
        style: 'soft'
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
    // aurora: ethereal teal/green with the SVG aurora veil over a deep northern
    // sky. Soft icons + rounded to keep it calm and organic.
    layers: {
      accent: {
        hue: 158,
        sat: 82
      },
      background: {
        kind: 'gradient',
        gradient:
          "url('/theme-backgrounds/radioatlas-aurora.svg'), radial-gradient(120% 80% at 50% 0%, rgba(72, 240, 196, 0.12) 0%, transparent 48%), linear-gradient(180deg, #04141b 0%, #0b2730 54%, #05121a 100%)"
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
    // textured-retro: a terminal. Mono type + the grid SVG over a warm-black CRT
    // wash + amber phosphor accent + sharp corners. Strong chrome tint so the
    // panels glow amber (not navy) and read unmistakably as a terminal.
    chromeTint: 2.2,
    layers: {
      accent: {
        hue: 40,
        sat: 86
      },
      background: {
        kind: 'gradient',
        gradient:
          "url('/theme-backgrounds/radioatlas-signal-grid.svg'), radial-gradient(120% 82% at 50% 0%, rgba(255, 176, 56, 0.22) 0%, transparent 52%), linear-gradient(180deg, #100c04 0%, #181206 54%, #0a0702 100%)"
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
    name: 'Sunset',
    author: 'RadioAtlas',
    createdAt: BUILT_AT,
    updatedAt: BUILT_AT,
    builtin: true,
    // sunset: a warm dusk — a low orange→magenta sun-bloom rising into a warm
    // plum night. DARK (distinct from warm-light), rounded + warm accent. The
    // base is plum (not cool indigo) and the chrome tint is cranked hard so the
    // dusk reads as warm even where station tiles cover the glow on Home.
    chromeTint: 2.6,
    layers: {
      accent: {
        hue: 18,
        sat: 90
      },
      background: {
        kind: 'gradient',
        gradient:
          'radial-gradient(150% 96% at 50% 114%, #ff9150 0%, #e6497a 24%, rgba(150, 52, 98, 0.55) 46%, transparent 66%), linear-gradient(180deg, #271031 0%, #371541 40%, #2e1138 72%, #1a0b24 100%)'
      },
      font: {
        family: 'rounded'
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
