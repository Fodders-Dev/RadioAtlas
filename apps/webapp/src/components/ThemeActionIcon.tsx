import { type ReactNode } from 'react';
import type { ThemeIconLayer } from '../lib/theme/types';
import { useTheme } from '../state/ThemeContext';

type ThemeActionIconName = keyof Omit<ThemeIconLayer, 'style'>;

type ThemeActionIconProps = {
  name: ThemeActionIconName;
  children: ReactNode;
};

export const ThemeActionIcon = ({ name, children }: ThemeActionIconProps) => {
  const { currentTheme, getAssetUrl } = useTheme();
  const assetId = currentTheme.layers.icons?.[name];
  const assetUrl = assetId ? getAssetUrl(assetId) : null;

  if (assetUrl) {
    return (
      <img
        alt=""
        aria-hidden="true"
        className="theme-action-icon"
        data-theme-action-icon={name}
        src={assetUrl}
      />
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
};
