import { useMemo, useState, type CSSProperties } from 'react';
import { themeRuntimeVars } from '../lib/theme/runtime';
import type { RadioAtlasTheme, ThemeFontLayer, ThemeIconStyle, ThemeSlot } from '../lib/theme/types';
import { useLocale } from '../state/LocaleContext';
import { useTheme } from '../state/ThemeContext';
import { SettingsSheet } from './SettingsSheet';
import './ThemeStudio.css';

type ThemeStudioSheetProps = {
  open: boolean;
  onClose: () => void;
};

const FONT_OPTIONS: ThemeFontLayer['family'][] = ['system', 'rounded', 'serif', 'mono'];
const ICON_STYLE_OPTIONS: ThemeIconStyle[] = ['round', 'soft', 'sharp'];
const DECORATION_SLOT_OPTIONS: ThemeSlot[] = ['dockRight', 'homeHeroCorner', 'fullPlayerCorner', 'globeOverlay'];

const createThemeId = (name: string) => {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
  return `custom-${slug || 'theme'}-${Date.now().toString(36)}`;
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
    getAssetUrl,
    saveDraftAndApply
  } = useTheme();
  const [draftName, setDraftName] = useState(t('theme.customDefaultName'));
  const [draftHue, setDraftHue] = useState(178);
  const [draftSat, setDraftSat] = useState(78);
  const [draftBackgroundThemeId, setDraftBackgroundThemeId] = useState('classic');
  const [draftFont, setDraftFont] = useState<ThemeFontLayer['family']>('system');
  const [draftIconStyle, setDraftIconStyle] = useState<ThemeIconStyle>('round');
  const [draftEmoji, setDraftEmoji] = useState('✦');
  const [draftEmojiSlot, setDraftEmojiSlot] = useState<ThemeSlot>('dockRight');
  const [builderState, setBuilderState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const bundledThemes = availableThemes.filter((theme) => theme.builtin);
  const selectableThemes = [...bundledThemes, ...customThemes];
  const activeTheme =
    selectableThemes.find((theme) => theme.id === currentThemeId) || bundledThemes[0] || availableThemes[0];
  const draftBackground =
    bundledThemes.find((theme) => theme.id === draftBackgroundThemeId)?.layers.background ||
    bundledThemes[0]?.layers.background;
  const draftTheme = useMemo<RadioAtlasTheme>(
    () => ({
      version: 1,
      id: 'theme-draft-preview',
      name: draftName.trim() || t('theme.customDefaultName'),
      author: 'RadioAtlas',
      createdAt: 0,
      updatedAt: 0,
      layers: {
        accent: {
          hue: draftHue,
          sat: draftSat
        },
        background:
          draftBackground?.kind === 'gradient'
            ? {
                kind: 'gradient',
                gradient: draftBackground.gradient
              }
            : undefined,
        font: {
          family: draftFont
        },
        icons: {
          style: draftIconStyle
        },
        emojiReactions: draftEmoji.trim()
          ? [
              {
                emoji: draftEmoji.trim().slice(0, 4),
                trigger: 'play',
                slot: draftEmojiSlot
              }
            ]
          : []
      }
    }),
    [draftBackground, draftEmoji, draftEmojiSlot, draftFont, draftHue, draftIconStyle, draftName, draftSat, t]
  );

  const handleSaveDraft = async () => {
    const name = draftName.trim() || t('theme.customDefaultName');
    setBuilderState('saving');
    try {
      await saveDraftAndApply({
        id: createThemeId(name),
        name,
        author: 'RadioAtlas',
        builtin: false,
        layers: draftTheme.layers
      });
      setBuilderState('saved');
    } catch {
      setBuilderState('error');
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
          </div>

          <div className="theme-studio-grid" role="list" aria-label={t('theme.bundledTitle')}>
            {selectableThemes.map((theme) => {
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

        <section className="theme-studio-section theme-studio-builder" data-theme-builder>
          <div className="theme-studio-section-head">
            <div>
              <div className="section-title">{t('theme.builderTitle')}</div>
              <div className="settings-desc">{t('theme.builderCopy')}</div>
            </div>
          </div>

          <div className="theme-studio-builder-grid">
            <label className="theme-studio-field">
              <span>{t('theme.nameLabel')}</span>
              <input
                className="settings-input"
                onChange={(event) => {
                  setDraftName(event.target.value);
                  setBuilderState('idle');
                }}
                type="text"
                value={draftName}
              />
            </label>
            <label className="theme-studio-field">
              <span>{t('theme.accentHue')}</span>
              <input
                data-theme-builder-hue
                max={359}
                min={0}
                onChange={(event) => {
                  setDraftHue(Number(event.target.value));
                  setBuilderState('idle');
                }}
                type="range"
                value={draftHue}
              />
            </label>
            <label className="theme-studio-field">
              <span>{t('theme.accentSat')}</span>
              <input
                data-theme-builder-sat
                max={100}
                min={20}
                onChange={(event) => {
                  setDraftSat(Number(event.target.value));
                  setBuilderState('idle');
                }}
                type="range"
                value={draftSat}
              />
            </label>
            <label className="theme-studio-field">
              <span>{t('theme.backgroundLabel')}</span>
              <select
                className="settings-input"
                onChange={(event) => {
                  setDraftBackgroundThemeId(event.target.value);
                  setBuilderState('idle');
                }}
                value={draftBackgroundThemeId}
              >
                {bundledThemes.map((theme) => (
                  <option key={theme.id} value={theme.id}>
                    {theme.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="theme-studio-field">
              <span>{t('theme.fontLabel')}</span>
              <select
                className="settings-input"
                onChange={(event) => {
                  setDraftFont(event.target.value as ThemeFontLayer['family']);
                  setBuilderState('idle');
                }}
                value={draftFont}
              >
                {FONT_OPTIONS.map((font) => (
                  <option key={font} value={font}>
                    {t(`theme.font.${font}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="theme-studio-field">
              <span>{t('theme.iconLabel')}</span>
              <select
                className="settings-input"
                onChange={(event) => {
                  setDraftIconStyle(event.target.value as ThemeIconStyle);
                  setBuilderState('idle');
                }}
                value={draftIconStyle}
              >
                {ICON_STYLE_OPTIONS.map((iconStyle) => (
                  <option key={iconStyle} value={iconStyle}>
                    {t(`theme.icon.${iconStyle}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="theme-studio-field">
              <span>{t('theme.emojiLabel')}</span>
              <input
                className="settings-input"
                data-theme-builder-emoji
                maxLength={4}
                onChange={(event) => {
                  setDraftEmoji(event.target.value);
                  setBuilderState('idle');
                }}
                type="text"
                value={draftEmoji}
              />
            </label>
            <label className="theme-studio-field">
              <span>{t('theme.decorationSlotLabel')}</span>
              <select
                className="settings-input"
                onChange={(event) => {
                  setDraftEmojiSlot(event.target.value as ThemeSlot);
                  setBuilderState('idle');
                }}
                value={draftEmojiSlot}
              >
                {DECORATION_SLOT_OPTIONS.map((slot) => (
                  <option key={slot} value={slot}>
                    {t(`theme.slot.${slot}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="theme-studio-builder-preview" style={themeStyle(draftTheme, getAssetUrl)}>
            <div>
              <span>{t('theme.previewLabel')}</span>
              <strong>{draftTheme.name}</strong>
            </div>
            <span className="theme-studio-builder-icon" aria-hidden="true">
              ▶
            </span>
            {draftTheme.layers.emojiReactions?.[0] ? (
              <span className="theme-studio-builder-emoji" data-theme-preview-emoji>
                {draftTheme.layers.emojiReactions[0].emoji}
              </span>
            ) : null}
          </div>

          <div className="settings-actions">
            <button
              className="chip active"
              disabled={builderState === 'saving'}
              onClick={() => void handleSaveDraft()}
              type="button"
            >
              {builderState === 'saving' ? t('common.loading') : t('theme.saveAndApply')}
            </button>
            {builderState === 'saved' ? (
              <span className="theme-studio-builder-status">{t('theme.builderSaved')}</span>
            ) : null}
            {builderState === 'error' ? (
              <span className="theme-studio-builder-status is-error">{t('theme.builderError')}</span>
            ) : null}
          </div>
        </section>
      </div>
    </SettingsSheet>
  );
};
