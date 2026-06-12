import { useMemo, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { derivePreviewTextColors } from '../lib/theme/previewContrast';
import { themeRuntimeVars, themeSurfaceVars } from '../lib/theme/runtime';
import type { RadioAtlasTheme } from '../lib/theme/types';
import { useLocale } from '../state/LocaleContext';

// P2-2c: a real themed mini-surface for the builder's live preview — a small
// slice of the app chrome (topbar + station card + player dock) rendered with
// the draft theme's own runtime vars, so the user sees the actual background,
// accent, surface tint, font, CTA and emoji react as they edit. It mirrors the
// real token derivation: themeRuntimeVars + themeSurfaceVars (the P1b
// accent-tinted dark chrome), and the light surface set for mode:'light'.
//
// P2-2e: if `onStickerMove` is supplied, the sticker decoration becomes
// drag-positionable directly on the preview — pointer drag writes a clamped
// px offset (x/y, centre-anchored) back to the draft, and `stickerPosition`
// feeds the live (un-debounced) offset back in so the drag never lags.

type ThemePreviewSurfaceProps = {
  theme: RadioAtlasTheme;
  resolveAssetUrl?: (assetId: string) => string | null;
  stickerPosition?: { x: number; y: number };
  onStickerMove?: (x: number, y: number) => void;
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

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const ThemePreviewSurface = ({
  theme,
  resolveAssetUrl,
  stickerPosition,
  onStickerMove
}: ThemePreviewSurfaceProps) => {
  const { t } = useLocale();
  const vars = themeRuntimeVars(theme, resolveAssetUrl);
  const surfaces = themeSurfaceVars(theme);
  const light = theme.mode === 'light';
  const emoji = theme.layers.emojiReactions?.[0]?.emoji;

  // PR-4a: derive --preview-text/--preview-muted from the draft's RESOLVED
  // background instead of hardcoding near-white for every dark draft — a pale
  // custom gradient used to get white-on-pale (the "text blends on skin
  // change" root cause). Light mode keeps the LIGHT constants; image/asset
  // backgrounds (null derivation) keep the historical dark-theme fallback.
  const derivedText = useMemo(
    () => (light ? null : derivePreviewTextColors(vars.background)),
    [light, vars.background]
  );
  const lowContrast = Boolean(!light && derivedText?.lowContrast);

  const sticker = theme.layers.stickers?.[0];
  const stickerUrl = sticker?.assetId ? resolveAssetUrl?.(sticker.assetId) ?? null : null;
  const stickerScale = sticker?.scale ?? 1;
  const stickerX = stickerPosition?.x ?? sticker?.x ?? 0;
  const stickerY = stickerPosition?.y ?? sticker?.y ?? 0;
  const draggable = Boolean(stickerUrl && onStickerMove);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!onStickerMove) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      baseX: stickerX,
      baseY: stickerY
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const surface = surfaceRef.current;
    if (!drag || !surface || !onStickerMove) return;
    const rect = surface.getBoundingClientRect();
    // Keep the sticker centre inside the preview (a margin so it never clips
    // out — 20px so a finger-dragged sticker clears the sheet's rounded edge).
    const margin = 20;
    const maxX = Math.max(0, rect.width / 2 - margin);
    const maxY = Math.max(0, rect.height / 2 - margin);
    const nextX = clamp(drag.baseX + (event.clientX - drag.startX), -maxX, maxX);
    const nextY = clamp(drag.baseY + (event.clientY - drag.startY), -maxY, maxY);
    onStickerMove(Math.round(nextX), Math.round(nextY));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const style = {
    '--preview-bg': vars.background,
    '--preview-accent': vars.accent,
    '--preview-accent-2': vars.accent2,
    '--preview-font': vars.font,
    '--preview-surface': light ? LIGHT.surface : surfaces?.surface ?? 'rgba(17, 25, 38, 0.56)',
    '--preview-surface-2': light ? LIGHT.surface2 : surfaces?.surface2 ?? 'rgba(28, 43, 63, 0.56)',
    '--preview-border': light ? LIGHT.border : surfaces?.border ?? 'rgba(236, 247, 255, 0.12)',
    '--preview-text': light ? LIGHT.text : derivedText?.text ?? '#f5fbff',
    '--preview-muted': light ? LIGHT.muted : derivedText?.muted ?? 'rgba(225, 238, 249, 0.64)',
    '--preview-ink': light ? LIGHT.ink : '#08121d',
    '--preview-icon-radius': vars.iconRadius
  } as CSSProperties;

  return (
    <div
      ref={surfaceRef}
      className="theme-preview-surface"
      data-preview-mode={light ? 'light' : 'dark'}
      style={style}
      aria-hidden="true"
    >
      {lowContrast ? (
        // PR-4a (owner's "auto-fix + warn" pick): even the best AA blend can't
        // reach 4.5:1 across this background — inform, never block saving.
        <div className="theme-preview-contrast-badge" data-theme-preview-low-contrast>
          {t('theme.lowContrastWarning')}
        </div>
      ) : null}
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
      {stickerUrl ? (
        <div
          className="theme-preview-sticker"
          data-theme-preview-sticker
          data-draggable={draggable ? 'true' : 'false'}
          style={
            {
              '--sticker-x': `${stickerX}px`,
              '--sticker-y': `${stickerY}px`,
              '--sticker-scale': stickerScale,
              backgroundImage: `url(${JSON.stringify(stickerUrl)})`
            } as CSSProperties
          }
          onPointerDown={draggable ? handlePointerDown : undefined}
          onPointerMove={draggable ? handlePointerMove : undefined}
          onPointerUp={draggable ? endDrag : undefined}
          onPointerCancel={draggable ? endDrag : undefined}
        />
      ) : null}
    </div>
  );
};
