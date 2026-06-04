import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { themeRuntimeVars, themeSurfaceVars } from '../lib/theme/runtime';
import type { RadioAtlasTheme } from '../lib/theme/types';

// P2-2c: a real themed mini-surface for the builder's live preview — a small
// slice of the app chrome (topbar + station card + player dock) rendered with
// the draft theme's own runtime vars.
// P2-2e/2f: every sticker decoration is drag-positionable on the preview (pointer
// drag writes a clamped, centre-anchored px offset back to the draft, fed live
// through `stickerPositions` so the drag never lags), and all emoji reactions
// render together in the dock so multi-decor reads live.

type ThemePreviewSurfaceProps = {
  theme: RadioAtlasTheme;
  resolveAssetUrl?: (assetId: string) => string | null;
  stickerPositions?: Array<{ x: number; y: number }>;
  onStickerMove?: (index: number, x: number, y: number) => void;
};

const EQ_BARS = [0.32, 0.7, 0.46, 0.9, 0.58, 0.8, 0.4, 0.66, 0.5, 0.86, 0.54, 0.36];

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
  stickerPositions,
  onStickerMove
}: ThemePreviewSurfaceProps) => {
  const vars = themeRuntimeVars(theme, resolveAssetUrl);
  const surfaces = themeSurfaceVars(theme);
  const light = theme.mode === 'light';
  const emojis = theme.layers.emojiReactions ?? [];
  const stickers = theme.layers.stickers ?? [];

  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    index: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>, index: number) => {
    if (!onStickerMove) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const sticker = stickers[index];
    dragRef.current = {
      index,
      startX: event.clientX,
      startY: event.clientY,
      baseX: stickerPositions?.[index]?.x ?? sticker?.x ?? 0,
      baseY: stickerPositions?.[index]?.y ?? sticker?.y ?? 0
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const surface = surfaceRef.current;
    if (!drag || !surface || !onStickerMove) return;
    const rect = surface.getBoundingClientRect();
    const margin = 16;
    const maxX = Math.max(0, rect.width / 2 - margin);
    const maxY = Math.max(0, rect.height / 2 - margin);
    const nextX = clamp(drag.baseX + (event.clientX - drag.startX), -maxX, maxX);
    const nextY = clamp(drag.baseY + (event.clientY - drag.startY), -maxY, maxY);
    onStickerMove(drag.index, Math.round(nextX), Math.round(nextY));
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
    '--preview-text': light ? LIGHT.text : '#f5fbff',
    '--preview-muted': light ? LIGHT.muted : 'rgba(225, 238, 249, 0.64)',
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
        {emojis.length ? (
          <span className="theme-preview-emoji" data-theme-preview-emoji>
            {emojis.map((reaction, index) => (
              <span key={index}>{reaction.emoji}</span>
            ))}
          </span>
        ) : null}
      </div>
      {stickers.map((sticker, index) => {
        const url = sticker.assetId ? resolveAssetUrl?.(sticker.assetId) ?? null : null;
        if (!url) return null;
        const draggable = Boolean(onStickerMove);
        return (
          <div
            className="theme-preview-sticker"
            data-theme-preview-sticker={index}
            data-draggable={draggable ? 'true' : 'false'}
            key={`${sticker.assetId}:${index}`}
            style={
              {
                '--sticker-x': `${stickerPositions?.[index]?.x ?? sticker.x}px`,
                '--sticker-y': `${stickerPositions?.[index]?.y ?? sticker.y}px`,
                '--sticker-scale': sticker.scale,
                backgroundImage: `url(${JSON.stringify(url)})`
              } as CSSProperties
            }
            onPointerDown={draggable ? (event) => handlePointerDown(event, index) : undefined}
            onPointerMove={draggable ? handlePointerMove : undefined}
            onPointerUp={draggable ? endDrag : undefined}
            onPointerCancel={draggable ? endDrag : undefined}
          />
        );
      })}
    </div>
  );
};
