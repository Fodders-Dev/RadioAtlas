import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { themeRuntimeVars } from '../lib/theme/runtime';
import type {
  RadioAtlasTheme,
  ThemeFontLayer,
  ThemeIconLayer,
  ThemeIconStyle,
  ThemeSlot
} from '../lib/theme/types';
import { useLocale } from '../state/LocaleContext';
import { collectThemeAssetIds, useTheme } from '../state/ThemeContext';

type ThemeBuilderProps = {
  bundledThemes: RadioAtlasTheme[];
  seedTheme?: RadioAtlasTheme | null;
  mode?: 'create' | 'remix' | 'edit';
  onSaved?: (theme: RadioAtlasTheme) => void;
};

type DraftAsset = {
  id: string;
  name: string;
  mimeType: string;
  blob: Blob;
  url: string;
};

type ThemeIconName = keyof Omit<ThemeIconLayer, 'style'>;

const FONT_OPTIONS: ThemeFontLayer['family'][] = ['system', 'rounded', 'serif', 'mono'];
const ICON_STYLE_OPTIONS: ThemeIconStyle[] = ['round', 'soft', 'sharp'];
const DECORATION_SLOT_OPTIONS: ThemeSlot[] = ['dockLeft', 'dockRight', 'fullPlayerCorner', 'fullPlayerBackdrop', 'homeHeroCorner', 'globeOverlay'];
const ICON_UPLOAD_OPTIONS: ThemeIconName[] = ['play', 'pause', 'next', 'prev', 'like'];
const GIF_TRIGGER_OPTIONS: Array<'idle' | 'play' | 'like'> = ['idle', 'play', 'like'];
const MAX_BACKGROUND_BYTES = 2 * 1024 * 1024;
const MAX_ICON_BYTES = 512 * 1024;
const MAX_DECORATION_BYTES = 1024 * 1024;

const createThemeId = (name: string) => {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
  return `custom-${slug || 'theme'}-${Date.now().toString(36)}`;
};

const createAssetId = (name: string, prefix: string) => {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
  return `asset-${prefix}-${slug || 'upload'}-${Date.now().toString(36)}`;
};

const createDraftAsset = (file: File, prefix: string): DraftAsset => ({
  id: createAssetId(file.name, prefix),
  name: file.name,
  mimeType: file.type || 'application/octet-stream',
  blob: file,
  url: URL.createObjectURL(file)
});

const revokeDraftAsset = (asset: DraftAsset | null | undefined) => {
  if (asset?.url) {
    URL.revokeObjectURL?.(asset.url);
  }
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

const fileMatches = (file: File, matcher: RegExp, maxBytes: number) =>
  matcher.test(file.type || '') && file.size <= maxBytes;

export const ThemeBuilder = ({ bundledThemes, seedTheme, mode = 'create', onSaved }: ThemeBuilderProps) => {
  const { t } = useLocale();
  const { ensureThemeAssets, getAssetUrl, saveAsset, saveDraftAndApply } = useTheme();
  const firstBundledThemeId = bundledThemes[0]?.id || 'classic';
  const [draftName, setDraftName] = useState(t('theme.customDefaultName'));
  const [draftHue, setDraftHue] = useState(178);
  const [draftSat, setDraftSat] = useState(78);
  const [draftBackgroundMode, setDraftBackgroundMode] = useState<'bundled' | 'print'>('bundled');
  const [draftBackgroundThemeId, setDraftBackgroundThemeId] = useState('classic');
  const [draftPrint, setDraftPrint] = useState<DraftAsset | null>(null);
  const [draftFont, setDraftFont] = useState<ThemeFontLayer['family']>('system');
  const [draftIconStyle, setDraftIconStyle] = useState<ThemeIconStyle>('round');
  const [draftIcons, setDraftIcons] = useState<Partial<Record<ThemeIconName, DraftAsset>>>({});
  const [draftSticker, setDraftSticker] = useState<DraftAsset | null>(null);
  const [draftStickerSlot, setDraftStickerSlot] = useState<ThemeSlot>('dockLeft');
  const [draftStickerScale, setDraftStickerScale] = useState(1);
  const [draftGif, setDraftGif] = useState<DraftAsset | null>(null);
  const [draftGifSlot, setDraftGifSlot] = useState<ThemeSlot>('fullPlayerCorner');
  const [draftGifTrigger, setDraftGifTrigger] = useState<'idle' | 'play' | 'like'>('play');
  const [draftEmoji, setDraftEmoji] = useState('✦');
  const [draftEmojiSlot, setDraftEmojiSlot] = useState<ThemeSlot>('dockRight');
  const [builderState, setBuilderState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    setDraftName(
      seedTheme
        ? mode === 'edit'
          ? seedTheme.name
          : `${seedTheme.name} Remix`
        : t('theme.customDefaultName')
    );
    setDraftHue(seedTheme?.layers.accent?.hue ?? 178);
    setDraftSat(seedTheme?.layers.accent?.sat ?? 78);
    setDraftFont(seedTheme?.layers.font?.family ?? 'system');
    setDraftIconStyle(seedTheme?.layers.icons?.style ?? 'round');
    setDraftEmoji(seedTheme?.layers.emojiReactions?.[0]?.emoji ?? '✦');
    setDraftEmojiSlot(seedTheme?.layers.emojiReactions?.[0]?.slot ?? 'dockRight');
    setDraftBackgroundMode(seedTheme?.layers.background?.kind === 'image' ? 'print' : 'bundled');
    setDraftBackgroundThemeId(seedTheme?.builtin ? seedTheme.id : firstBundledThemeId);
    setDraftStickerSlot(seedTheme?.layers.stickers?.[0]?.slot ?? 'dockLeft');
    setDraftStickerScale(seedTheme?.layers.stickers?.[0]?.scale ?? 1);
    setDraftGifSlot(seedTheme?.layers.gifs?.[0]?.slot ?? 'fullPlayerCorner');
    setDraftGifTrigger(seedTheme?.layers.gifs?.[0]?.trigger ?? 'play');
    setBuilderState('idle');
    setDraftPrint((prev) => {
      revokeDraftAsset(prev);
      return null;
    });
    setDraftIcons((prev) => {
      Object.values(prev).forEach(revokeDraftAsset);
      return {};
    });
    setDraftSticker((prev) => {
      revokeDraftAsset(prev);
      return null;
    });
    setDraftGif((prev) => {
      revokeDraftAsset(prev);
      return null;
    });
  }, [firstBundledThemeId, mode, seedTheme, t]);

  useEffect(() => {
    void ensureThemeAssets(collectThemeAssetIds(seedTheme));
  }, [ensureThemeAssets, seedTheme]);

  useEffect(
    () => () => {
      revokeDraftAsset(draftPrint);
      Object.values(draftIcons).forEach(revokeDraftAsset);
      revokeDraftAsset(draftSticker);
      revokeDraftAsset(draftGif);
    },
    [draftGif, draftIcons, draftPrint, draftSticker]
  );

  const draftBackground =
    bundledThemes.find((theme) => theme.id === draftBackgroundThemeId)?.layers.background ||
    bundledThemes[0]?.layers.background;
  const draftIconLayer = useMemo<ThemeIconLayer>(() => {
    const seededIcons = seedTheme?.layers.icons || {};
    const nextIcons: ThemeIconLayer = {
      ...seededIcons,
      style: draftIconStyle
    };
    for (const iconName of ICON_UPLOAD_OPTIONS) {
      if (draftIcons[iconName]) {
        nextIcons[iconName] = draftIcons[iconName]?.id;
      }
    }
    return nextIcons;
  }, [draftIconStyle, draftIcons, seedTheme]);
  const draftTheme = useMemo<RadioAtlasTheme>(() => {
    const background =
      draftBackgroundMode === 'print' && draftPrint
        ? {
            kind: 'image' as const,
            assetId: draftPrint.id
          }
        : draftBackgroundMode === 'print' && seedTheme?.layers.background?.kind === 'image'
          ? {
              kind: 'image' as const,
              assetId: seedTheme.layers.background.assetId
            }
        : draftBackground?.kind === 'gradient'
          ? {
              kind: 'gradient' as const,
              gradient: draftBackground.gradient
            }
          : undefined;
    return {
      version: 1,
      id: 'theme-draft-preview',
      name: draftName.trim() || t('theme.customDefaultName'),
      author: 'RadioAtlas',
      parentId: mode === 'remix' ? seedTheme?.id : seedTheme?.parentId,
      createdAt: 0,
      updatedAt: 0,
      layers: {
        accent: {
          hue: draftHue,
          sat: draftSat
        },
        background,
        font: {
          family: draftFont
        },
        icons: draftIconLayer,
        stickers: draftSticker
          ? [
              {
                assetId: draftSticker.id,
                slot: draftStickerSlot,
                x: 0,
                y: 0,
                scale: draftStickerScale
              }
            ]
          : seedTheme?.layers.stickers,
        gifs: draftGif
          ? [
              {
                assetId: draftGif.id,
                slot: draftGifSlot,
                trigger: draftGifTrigger
              }
            ]
          : seedTheme?.layers.gifs,
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
    };
  }, [
    draftBackground,
    draftBackgroundMode,
    draftEmoji,
    draftEmojiSlot,
    draftFont,
    draftGif,
    draftGifSlot,
    draftGifTrigger,
    draftHue,
    draftIconLayer,
    draftName,
    draftPrint,
    draftSat,
    draftSticker,
    draftStickerScale,
    draftStickerSlot,
    mode,
    seedTheme,
    t
  ]);
  const draftResolveAssetUrl = (assetId: string) => {
    if (draftPrint?.id === assetId) return draftPrint.url;
    if (draftSticker?.id === assetId) return draftSticker.url;
    if (draftGif?.id === assetId) return draftGif.url;
    const iconAsset = Object.values(draftIcons).find((asset) => asset?.id === assetId);
    if (iconAsset) return iconAsset.url;
    return getAssetUrl(assetId);
  };

  const handleAssetUpload = (
    file: File | null,
    options: {
      prefix: string;
      matcher: RegExp;
      maxBytes: number;
      apply: (asset: DraftAsset) => void;
    }
  ) => {
    if (!file) return;
    if (!fileMatches(file, options.matcher, options.maxBytes)) {
      setBuilderState('error');
      return;
    }
    options.apply(createDraftAsset(file, options.prefix));
    setBuilderState('idle');
  };

  const handleSaveDraft = async () => {
    const name = draftName.trim() || t('theme.customDefaultName');
    setBuilderState('saving');
    try {
      const assetsToSave: DraftAsset[] = [
        draftPrint,
        draftSticker,
        draftGif,
        ...Object.values(draftIcons)
      ].filter(Boolean) as DraftAsset[];

      for (const asset of assetsToSave) {
        await saveAsset({
          id: asset.id,
          kind: asset.id.includes('icon') ? 'icon' : asset.id.includes('sticker') ? 'sticker' : asset.id.includes('gif') ? 'gif' : 'background',
          name: asset.name,
          mimeType: asset.mimeType,
          blob: asset.blob
        });
      }

      const savedTheme = await saveDraftAndApply({
        id: mode === 'edit' && seedTheme ? seedTheme.id : createThemeId(name),
        name,
        author: 'RadioAtlas',
        parentId: mode === 'remix' ? seedTheme?.id : seedTheme?.parentId,
        builtin: false,
        layers: draftTheme.layers
      });
      setBuilderState('saved');
      onSaved?.(savedTheme);
    } catch {
      setBuilderState('error');
    }
  };

  return (
    <section className="theme-studio-section theme-studio-builder" data-theme-builder>
      <div className="theme-studio-section-head">
        <div>
          <div className="section-title">
            {seedTheme ? (mode === 'edit' ? t('theme.edit') : t('theme.remix')) : t('theme.builderTitle')}
          </div>
          <div className="settings-desc">
            {seedTheme
              ? mode === 'edit'
                ? t('theme.editing', { name: seedTheme.name })
                : t('theme.remixOf', { name: seedTheme.name })
              : t('theme.builderCopy')}
          </div>
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
              setDraftBackgroundMode('bundled');
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
        <label className="theme-studio-field theme-studio-print-field">
          <span>{t('theme.printLabel')}</span>
          <input
            className="settings-input"
            data-theme-builder-print
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            onChange={(event) =>
              handleAssetUpload(event.target.files?.[0] || null, {
                prefix: 'print',
                matcher: /^image\/(png|jpeg|webp|gif|svg\+xml)$/,
                maxBytes: MAX_BACKGROUND_BYTES,
                apply: (asset) => {
                  setDraftPrint((prev) => {
                    revokeDraftAsset(prev);
                    return asset;
                  });
                  setDraftBackgroundMode('print');
                }
              })
            }
            type="file"
          />
          <small data-theme-print-name>
            {draftPrint && draftBackgroundMode === 'print'
              ? draftPrint.name
              : t('theme.printHint')}
          </small>
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
      </div>

      <div className="theme-studio-asset-grid" data-theme-icon-upload-grid>
        <div className="theme-studio-field theme-studio-asset-title">
          <span>{t('theme.iconUploads')}</span>
        </div>
        {ICON_UPLOAD_OPTIONS.map((iconName) => (
          <label className="theme-studio-field theme-studio-print-field" key={iconName}>
            <span>{t(`theme.iconSlot.${iconName}`)}</span>
            <input
              className="settings-input"
              data-theme-builder-icon={iconName}
              accept="image/svg+xml,image/png"
              onChange={(event) =>
                handleAssetUpload(event.target.files?.[0] || null, {
                  prefix: `icon-${iconName}`,
                  matcher: /^image\/(svg\+xml|png)$/,
                  maxBytes: MAX_ICON_BYTES,
                  apply: (asset) =>
                    setDraftIcons((prev) => {
                      revokeDraftAsset(prev[iconName]);
                      return {
                        ...prev,
                        [iconName]: asset
                      };
                    })
                })
              }
              type="file"
            />
            <small>{draftIcons[iconName]?.name || t('theme.iconUploadHint')}</small>
          </label>
        ))}
      </div>

      <div className="theme-studio-asset-grid">
        <label className="theme-studio-field theme-studio-print-field">
          <span>{t('theme.stickerLabel')}</span>
          <input
            className="settings-input"
            data-theme-builder-sticker
            accept="image/png,image/webp,image/svg+xml"
            onChange={(event) =>
              handleAssetUpload(event.target.files?.[0] || null, {
                prefix: 'sticker',
                matcher: /^image\/(png|webp|svg\+xml)$/,
                maxBytes: MAX_DECORATION_BYTES,
                apply: (asset) =>
                  setDraftSticker((prev) => {
                    revokeDraftAsset(prev);
                    return asset;
                  })
              })
            }
            type="file"
          />
          <small>{draftSticker?.name || t('theme.stickerHint')}</small>
        </label>
        <label className="theme-studio-field">
          <span>{t('theme.decorationSlotLabel')}</span>
          <select
            className="settings-input"
            onChange={(event) => {
              setDraftStickerSlot(event.target.value as ThemeSlot);
              setBuilderState('idle');
            }}
            value={draftStickerSlot}
          >
            {DECORATION_SLOT_OPTIONS.map((slot) => (
              <option key={slot} value={slot}>
                {t(`theme.slot.${slot}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="theme-studio-field">
          <span>{t('theme.scaleLabel')}</span>
          <input
            data-theme-builder-sticker-scale
            max={1.5}
            min={0.5}
            onChange={(event) => {
              setDraftStickerScale(Number(event.target.value));
              setBuilderState('idle');
            }}
            step={0.05}
            type="range"
            value={draftStickerScale}
          />
        </label>
        <label className="theme-studio-field theme-studio-print-field">
          <span>{t('theme.gifLabel')}</span>
          <input
            className="settings-input"
            data-theme-builder-gif
            accept="image/gif,image/webp"
            onChange={(event) =>
              handleAssetUpload(event.target.files?.[0] || null, {
                prefix: 'gif',
                matcher: /^image\/(gif|webp)$/,
                maxBytes: MAX_DECORATION_BYTES,
                apply: (asset) =>
                  setDraftGif((prev) => {
                    revokeDraftAsset(prev);
                    return asset;
                  })
              })
            }
            type="file"
          />
          <small>{draftGif?.name || t('theme.gifHint')}</small>
        </label>
        <label className="theme-studio-field">
          <span>{t('theme.gifTriggerLabel')}</span>
          <select
            className="settings-input"
            onChange={(event) => {
              setDraftGifTrigger(event.target.value as 'idle' | 'play' | 'like');
              setBuilderState('idle');
            }}
            value={draftGifTrigger}
          >
            {GIF_TRIGGER_OPTIONS.map((trigger) => (
              <option key={trigger} value={trigger}>
                {t(`theme.trigger.${trigger}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="theme-studio-field">
          <span>{t('theme.decorationSlotLabel')}</span>
          <select
            className="settings-input"
            onChange={(event) => {
              setDraftGifSlot(event.target.value as ThemeSlot);
              setBuilderState('idle');
            }}
            value={draftGifSlot}
          >
            {DECORATION_SLOT_OPTIONS.map((slot) => (
              <option key={slot} value={slot}>
                {t(`theme.slot.${slot}`)}
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

      <div
        className="theme-studio-builder-preview"
        data-theme-builder-background={draftBackgroundMode}
        style={themeStyle(draftTheme, draftResolveAssetUrl)}
      >
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
  );
};
