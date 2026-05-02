import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import { themeRuntimeVars } from '../lib/theme/runtime';
import type { RadioAtlasTheme } from '../lib/theme/types';
import { useLocale } from '../state/LocaleContext';
import { collectThemeAssetIds, useTheme } from '../state/ThemeContext';
import { SettingsSheet } from './SettingsSheet';
import { ThemeBuilder } from './ThemeBuilder';
import './ThemeStudio.css';

type ThemeStudioSheetProps = {
  open: boolean;
  onClose: () => void;
};

type BuilderTarget = {
  mode: 'create' | 'remix' | 'edit';
  theme: RadioAtlasTheme | null;
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
    '--theme-studio-font': vars.font,
    '--theme-studio-icon-radius': vars.iconRadius
  } as CSSProperties;
};

export const ThemeStudioSheet = ({ open, onClose }: ThemeStudioSheetProps) => {
  const { t } = useLocale();
  const {
    applyTheme,
    availableThemes,
    currentThemeId,
    customThemes,
    ensureThemeAssets,
    getAssetUrl,
    removeTheme
  } = useTheme();
  const [builderTarget, setBuilderTarget] = useState<BuilderTarget>({
    mode: 'create',
    theme: null
  });
  const bundledThemes = useMemo(
    () => availableThemes.filter((theme) => theme.builtin),
    [availableThemes]
  );
  const selectableThemes = useMemo(
    () => [...bundledThemes, ...customThemes],
    [bundledThemes, customThemes]
  );
  const selectableAssetIds = useMemo(
    () => selectableThemes.flatMap(collectThemeAssetIds),
    [selectableThemes]
  );
  const activeTheme =
    selectableThemes.find((theme) => theme.id === currentThemeId) || bundledThemes[0] || availableThemes[0];

  useEffect(() => {
    if (!open) return;
    void ensureThemeAssets(selectableAssetIds);
  }, [ensureThemeAssets, open, selectableAssetIds]);

  const handleRemix = (event: MouseEvent, theme: RadioAtlasTheme) => {
    event.stopPropagation();
    setBuilderTarget({ mode: 'remix', theme });
  };

  const handleEdit = (event: MouseEvent, theme: RadioAtlasTheme) => {
    event.stopPropagation();
    if (theme.builtin) return;
    setBuilderTarget({ mode: 'edit', theme });
  };

  const handleDelete = (event: MouseEvent, theme: RadioAtlasTheme) => {
    event.stopPropagation();
    if (theme.builtin) return;
    void removeTheme(theme.id);
    if (builderTarget.theme?.id === theme.id) {
      setBuilderTarget({ mode: 'create', theme: null });
    }
  };

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
          <div className="theme-studio-section-head">
            <div>
              <div className="section-title">{t('theme.bundledTitle')}</div>
              <div className="settings-desc">{t('theme.bundledCopy')}</div>
            </div>
            <button
              className="chip"
              type="button"
              onClick={() => setBuilderTarget({ mode: 'create', theme: null })}
            >
              {t('theme.create')}
            </button>
          </div>

          <div className="theme-studio-grid" role="list" aria-label={t('theme.bundledTitle')}>
            {selectableThemes.map((theme) => {
              const active = theme.id === currentThemeId;
              return (
                <article
                  className="theme-studio-card"
                  data-theme-card={theme.id}
                  data-theme-active={active ? 'true' : 'false'}
                  key={theme.id}
                  onClick={() => applyTheme(theme.id)}
                  role="listitem"
                  style={themeStyle(theme, getAssetUrl)}
                >
                  <div className="theme-studio-card-main">
                    <span className="theme-studio-swatch" aria-hidden="true" />
                    <span className="theme-studio-card-copy">
                      <strong>{theme.name}</strong>
                      <small>
                        {active
                          ? t('common.active')
                          : theme.parentId
                            ? t('theme.remixOf', { name: theme.parentId })
                            : t('theme.byAuthor', { author: theme.author || 'RadioAtlas' })}
                      </small>
                    </span>
                  </div>
                  <div className="theme-studio-card-actions">
                    <button
                      className="chip"
                      type="button"
                      onClick={(event) => handleRemix(event, theme)}
                    >
                      {t('theme.remix')}
                    </button>
                    {!theme.builtin ? (
                      <>
                        <button
                          className="chip"
                          type="button"
                          onClick={(event) => handleEdit(event, theme)}
                        >
                          {t('theme.edit')}
                        </button>
                        <button
                          className="chip"
                          type="button"
                          onClick={(event) => handleDelete(event, theme)}
                        >
                          {t('theme.delete')}
                        </button>
                      </>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <ThemeBuilder
          bundledThemes={bundledThemes}
          mode={builderTarget.mode}
          seedTheme={builderTarget.theme}
          onSaved={(theme) => setBuilderTarget({ mode: 'edit', theme })}
        />
      </div>
    </SettingsSheet>
  );
};
