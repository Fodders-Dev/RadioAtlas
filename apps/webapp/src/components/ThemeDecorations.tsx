import { useMemo, type CSSProperties } from 'react';
import { resolveThemeDecorations } from '../lib/theme/decorations';
import { useLibrary, usePlayback } from '../state/RadioContext';
import { useTheme } from '../state/ThemeContext';
import './ThemeDecorations.css';

export const ThemeDecorations = () => {
  const { currentTheme, getAssetUrl } = useTheme();
  const { player } = usePlayback();
  const { isFavorite } = useLibrary();
  const liked = player.current ? isFavorite(player.current.stationuuid) : false;
  const decorations = useMemo(
    () =>
      resolveThemeDecorations(currentTheme, getAssetUrl, {
        playing: player.isPlaying,
        liked
      }),
    [currentTheme, getAssetUrl, liked, player.isPlaying]
  );

  if (!decorations.length) return null;

  return (
    <div className="theme-decorations" aria-hidden="true">
      {decorations.map((decoration, index) => {
        if (decoration.kind === 'emoji') {
          return (
            <span
              className="theme-decoration theme-decoration-emoji"
              data-theme-decoration="emoji"
              data-theme-slot={decoration.slot}
              data-theme-trigger={decoration.trigger}
              key={`${decoration.slot}:${decoration.trigger}:${decoration.emoji}:${index}`}
            >
              {decoration.emoji}
            </span>
          );
        }

        return (
          <span
            className="theme-decoration theme-decoration-asset"
            data-theme-decoration={decoration.source}
            data-theme-slot={decoration.slot}
            data-theme-trigger={decoration.trigger}
            key={`${decoration.slot}:${decoration.source}:${decoration.url}:${index}`}
            style={
              {
                '--theme-decoration-image': `url(${JSON.stringify(decoration.url)})`,
                '--theme-decoration-x': `${decoration.x}px`,
                '--theme-decoration-y': `${decoration.y}px`,
                '--theme-decoration-scale': decoration.scale
              } as CSSProperties
            }
          />
        );
      })}
    </div>
  );
};
