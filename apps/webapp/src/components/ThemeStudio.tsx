import type { CSSProperties } from 'react';
import { themeRuntimeVars } from '../lib/theme/runtime';
import type { RadioAtlasTheme } from '../lib/theme/types';
import { useLocale } from '../state/LocaleContext';
import { useTheme } from '../state/ThemeContext';
import { SettingsSheet } from './SettingsSheet';
import './ThemeStudio.css';

type ThemeStudioSheetProps = {
  open: boolean;
  onClose: () => void;
};

const themeStyle = (
  theme: RadioAtlasTheme,
  resolveAssetUrl?: (assetId: string) => string | null
) => {
  const vars = themeRuntimeVars(theme, resolveAssetUrl);
  return {
    '--theme-studio-accent': vars.accent,
    '--theme-studio-accent-2': vars.accent2,
    '--theme-studio-bg': vars.background,
    '--theme-studio-font': vars.font
  } as CSSProperties;
};

export const ThemeStudioSheet = ({ open, onClose }: ThemeStudioSheetProps) => {
  const { t } = useLocale();
  const { applyTheme, availableThemes, currentThemeId, getAssetUrl } = useTheme();
  const bundledThemes = availableThemes.filter((theme) => theme.builtin);
  const activeTheme =
    bundledThemes.find((theme) => theme.id === currentThemeId) || bundledThemes[0] || availableThemes[0];

  return (
    <SettingsSheet open={open} onClose={onClose} kicker={t('theme.kicker')} title={t('theme.title')}>
      <div className="theme-studio-sheet" data-theme-studio>
        {activeTheme ? (
          <section
            className="theme-studio-preview"
            data-theme-preview={activeTheme.id}
            style={themeStyle(activeTheme, getAssetUrl)}
          >
            <div className="theme-studio-preview-card">
              <span>{t('theme.current')}</span>
              <strong>{activeTheme.name}</strong>
              <small>{t('theme.previewStation')}</small>
              <span className="theme-studio-preview-play">{t('common.play')}</span>
            </div>
          </section>
        ) : null}

        <section className="theme-studio-section">
          <div className="skin-lab-section-head">
            <div>
              <div className="section-title">{t('theme.bundledTitle')}</div>
              <div className="settings-desc">{t('theme.bundledCopy')}</div>
            </div>
          </div>

          <div className="theme-studio-grid" role="list" aria-label={t('theme.bundledTitle')}>
            {bundledThemes.map((theme) => {
              const active = theme.id === currentThemeId;
              return (
                <button
                  className="theme-studio-card"
                  data-theme-card={theme.id}
                  data-theme-active={active ? 'true' : 'false'}
                  key={theme.id}
                  onClick={() => applyTheme(theme.id)}
                  style={themeStyle(theme, getAssetUrl)}
                  type="button"
                >
                  <span className="theme-studio-swatch" aria-hidden="true" />
                  <span className="theme-studio-card-copy">
                    <strong>{theme.name}</strong>
                    <small>{active ? t('common.active') : t('common.apply')}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </SettingsSheet>
  );
};
