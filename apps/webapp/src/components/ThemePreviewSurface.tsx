import type { CSSProperties } from 'react';
import { themeRuntimeVars, themeSurfaceVars } from '../lib/theme/runtime';
import type { RadioAtlasTheme } from '../lib/theme/types';

// P2-2c: a real themed mini-surface for the builder's live preview — a small
// slice of the app chrome (topbar + station card + player dock) rendered with
// the draft theme's own runtime vars, so the user sees the actual background,
// accent, surface tint, font, CTA and emoji react as they edit. It mirrors the
// real token derivation: themeRuntimeVars + themeSurfaceVars (the P1b
// accent-tinted dark chrome), and the light surface set for mode:'light'.

type ThemePreviewSurfaceProps = {
  theme: RadioAtlasTheme;
  resolveAssetUrl?: (assetId: string) => string | null;
};

// A frozen spectrum for the mini dock visualizer — evokes the live player
// (P3) without needing audio.
const EQ_BARS = [0.32, 0.7, 0.46, 0.9, 0.58, 0.8, 0.4, 0.66, 0.5, 0.86, 0.54, 0.36];

// Light surface set, matching the :root[data-theme-mode='light'] block.
const LIGHT = {
  surface: 'rgba(255, 252, 248, 0.86)',
  surface2: 'rgba(255, 250, 244, 0.94)',
  border: 'rgba(60, 45, 38, 0.18)',
  text: '#241a17',
  muted: 'rgba(58, 44, 38, 0.6)',
  ink: '#2a1a12'
};

export const ThemePreviewSurface = ({ theme, resolveAssetUrl }: ThemePreviewSurfaceProps) => {
  const vars = themeRuntimeVars(theme, resolveAssetUrl);
  const surfaces = themeSurfaceVars(theme);
  const light = theme.mode === 'light';
  const emoji = theme.layers.emojiReactions?.[0]?.emoji;

  const style = {
    '--preview-bg': vars.background,
    '--preview-accent': vars.accent,
    '--preview-accent-2': vars.accent2,
    '--preview-font': vars.font,
    '--preview-surface': light ? LIGHT.surface : surfaces?.surface ?? 'rgba(17, 25, 38, 0.56)',
    '--preview-surface-2': light ? LIGHT.surface2 : surfaces?.surface2 ?? 'rgba(28, 43, 63, 0.56)',
    '--preview-border': light ? LIGHT.border : surfaces?.border ?? 'rgba(236, 247, 255, 0.12)',
    '--preview-text': light ? LIGHT.text : '#f5fbff',
    '--preview-muted': light ? LIGHT.muted : 'rgba(225, 238, 249, 0.64)',
    '--preview-ink': light ? LIGHT.ink : '#08121d',
    '--preview-icon-radius': vars.iconRadius
  } as CSSProperties;

  return (
    <div
      className="theme-preview-surface"
      data-preview-mode={light ? 'light' : 'dark'}
      style={style}
      aria-hidden="true"
    >
      <div className="theme-preview-topbar">
        <span className="theme-preview-brand-dot" />
        <span className="theme-preview-topbar-title">{theme.name}</span>
        <span className="theme-preview-topbar-chip" />
      </div>
      <div className="theme-preview-card">
        <span className="theme-preview-art" />
        <span className="theme-preview-card-copy">
          <strong />
          <small />
        </span>
        <span className="theme-preview-cta">&#9654;</span>
      </div>
      <div className="theme-preview-dock">
        <span className="theme-preview-dock-art" />
        <span className="theme-preview-eq">
          {EQ_BARS.map((height, index) => (
            <span
              className="theme-preview-eq-bar"
              key={index}
              style={{ '--h': height } as CSSProperties}
            />
          ))}
        </span>
        {emoji ? (
          <span className="theme-preview-emoji" data-theme-preview-emoji>
            {emoji}
          </span>
        ) : null}
      </div>
    </div>
  );
};
