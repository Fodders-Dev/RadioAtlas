import { useEffect, useMemo, useState } from 'react';
import type {
  RadioAtlasTheme,
  ThemeFontLayer,
  ThemeIconLayer,
  ThemeIconStyle,
  ThemeSlot
} from '../lib/theme/types';
import { useLocale } from '../state/LocaleContext';
import { collectThemeAssetIds, useTheme } from '../state/ThemeContext';
import { ThemePreviewSurface } from './ThemePreviewSurface';

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

// P2-2f: the model already supports stickers[]/gifs[]/emojiReactions[]; the
// builder now authors multiple of each. A decor asset is either a freshly
// uploaded blob (`draft`, needs saving + URL revoke) or an existing seeded asset
// (just its id, resolved through getAssetUrl).
type DecorAsset = { id: string; draft?: DraftAsset };
type StickerDraft = { asset: DecorAsset; slot: ThemeSlot; scale: number; x: number; y: number };
type GifDraft = { asset: DecorAsset; slot: ThemeSlot; trigger: 'idle' | 'play' | 'like' };
type EmojiDraft = { emoji: string; slot: ThemeSlot; trigger: 'play' | 'like' };
const MAX_DECOR = 4;
const EMOJI_TRIGGER_OPTIONS: Array<'play' | 'like'> = ['play', 'like'];
const DEFAULT_EMOJIS: EmojiDraft[] = [{ emoji: '✦', slot: 'dockRight', trigger: 'play' }];

const FONT_OPTIONS: ThemeFontLayer['family'][] = ['system', 'rounded', 'serif', 'mono'];
const ICON_STYLE_OPTIONS: ThemeIconStyle[] = ['round', 'soft', 'sharp'];
const DECORATION_SLOT_OPTIONS: ThemeSlot[] = ['dockLeft', 'dockRight', 'fullPlayerCorner', 'fullPlayerBackdrop', 'homeHeroCorner', 'globeOverlay'];
const ICON_UPLOAD_OPTIONS: ThemeIconName[] = ['play', 'pause', 'next', 'prev', 'like'];
const GIF_TRIGGER_OPTIONS: Array<'idle' | 'play' | 'like'> = ['idle', 'play', 'like'];
const MAX_BACKGROUND_BYTES = 2 * 1024 * 1024;
const MAX_ICON_BYTES = 512 * 1024;
const MAX_DECORATION_BYTES = 1024 * 1024;

// P2-2d: a custom multi-stop gradient the user composes themselves (rather than
// borrowing a bundled preset). Serialized down to the existing
// background.gradient CSS string, so the renderer/storage are untouched.
type GradientStop = { color: string; position: number };
const DEFAULT_GRADIENT_STOPS: GradientStop[] = [
  { color: '#10243a', position: 0 },
  { color: '#1d3f63', position: 52 },
  { color: '#080f1a', position: 100 }
];
const composeGradient = (angle: number, stops: GradientStop[]) =>
  `linear-gradient(${Math.round(angle)}deg, ${stops
    .map((stop) => `${stop.color} ${Math.round(stop.position)}%`)
    .join(', ')})`;

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


const fileMatches = (file: File, matcher: RegExp, maxBytes: number) =>
  matcher.test(file.type || '') && file.size <= maxBytes;

export const ThemeBuilder = ({ bundledThemes, seedTheme, mode = 'create', onSaved }: ThemeBuilderProps) => {
  const { t } = useLocale();
  const { ensureThemeAssets, getAssetUrl, saveAsset, saveDraftAndApply } = useTheme();
  const firstBundledThemeId = bundledThemes[0]?.id || 'classic';
  const [draftName, setDraftName] = useState(t('theme.customDefaultName'));
  const [draftAuthor, setDraftAuthor] = useState('');
  const [draftMode, setDraftMode] = useState<'light' | 'dark'>('dark');
  const [draftHue, setDraftHue] = useState(178);
  const [draftSat, setDraftSat] = useState(78);
  const [draftLightness, setDraftLightness] = useState(68);
  const [draftAccent2Enabled, setDraftAccent2Enabled] = useState(false);
  const [draftAccent2Hue, setDraftAccent2Hue] = useState(220);
  const [draftAccent2Sat, setDraftAccent2Sat] = useState(70);
  const [draftAccent2Lightness, setDraftAccent2Lightness] = useState(70);
  const [draftBackgroundMode, setDraftBackgroundMode] = useState<'bundled' | 'print' | 'custom'>(
    'bundled'
  );
  const [draftBackgroundThemeId, setDraftBackgroundThemeId] = useState('classic');
  const [draftGradientStops, setDraftGradientStops] = useState<GradientStop[]>(DEFAULT_GRADIENT_STOPS);
  const [draftGradientAngle, setDraftGradientAngle] = useState(160);
  const [draftPrint, setDraftPrint] = useState<DraftAsset | null>(null);
  const [draftFont, setDraftFont] = useState<ThemeFontLayer['family']>('system');
  const [draftIconStyle, setDraftIconStyle] = useState<ThemeIconStyle>('round');
  const [draftIcons, setDraftIcons] = useState<Partial<Record<ThemeIconName, DraftAsset>>>({});
  const [draftStickers, setDraftStickers] = useState<StickerDraft[]>([]);
  const [draftGifs, setDraftGifs] = useState<GifDraft[]>([]);
  const [draftEmojis, setDraftEmojis] = useState<EmojiDraft[]>(DEFAULT_EMOJIS);
  const [builderState, setBuilderState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    setDraftName(
      seedTheme
        ? mode === 'edit'
          ? seedTheme.name
          : `${seedTheme.name} Remix`
        : t('theme.customDefaultName')
    );
    // Prefill author only from a real custom theme — builtins carry the
    // 'RadioAtlas' placeholder we don't want to surface as the user's name.
    setDraftAuthor(seedTheme && !seedTheme.builtin ? seedTheme.author ?? '' : '');
    setDraftMode(seedTheme?.mode ?? 'dark');
    setDraftHue(seedTheme?.layers.accent?.hue ?? 178);
    setDraftSat(seedTheme?.layers.accent?.sat ?? 78);
    setDraftLightness(seedTheme?.layers.accent?.lightness ?? 68);
    const seedAccent2 = seedTheme?.layers.accent2;
    setDraftAccent2Enabled(Boolean(seedAccent2));
    setDraftAccent2Hue(seedAccent2?.hue ?? 220);
    setDraftAccent2Sat(seedAccent2?.sat ?? 70);
    setDraftAccent2Lightness(seedAccent2?.lightness ?? 70);
    setDraftFont(seedTheme?.layers.font?.family ?? 'system');
    setDraftIconStyle(seedTheme?.layers.icons?.style ?? 'round');
    setDraftBackgroundMode(seedTheme?.layers.background?.kind === 'image' ? 'print' : 'bundled');
    setDraftBackgroundThemeId(seedTheme?.builtin ? seedTheme.id : firstBundledThemeId);
    setBuilderState('idle');
    setDraftPrint((prev) => {
      revokeDraftAsset(prev);
      return null;
    });
    setDraftIcons((prev) => {
      Object.values(prev).forEach(revokeDraftAsset);
      return {};
    });
    // Seed the decor arrays from the theme (existing assets keep their id;
    // freshly-uploaded blobs are added later), revoking any in-flight uploads.
    setDraftStickers((prev) => {
      prev.forEach((item) => revokeDraftAsset(item.asset.draft));
      return (seedTheme?.layers.stickers ?? []).map((sticker) => ({
        asset: { id: sticker.assetId },
        slot: sticker.slot,
        scale: sticker.scale,
        x: sticker.x,
        y: sticker.y
      }));
    });
    setDraftGifs((prev) => {
      prev.forEach((item) => revokeDraftAsset(item.asset.draft));
      return (seedTheme?.layers.gifs ?? []).map((gif) => ({
        asset: { id: gif.assetId },
        slot: gif.slot,
        trigger: gif.trigger
      }));
    });
    setDraftEmojis(
      seedTheme?.layers.emojiReactions?.length
        ? seedTheme.layers.emojiReactions.map((reaction) => ({
            emoji: reaction.emoji,
            slot: reaction.slot ?? 'dockRight',
            trigger: reaction.trigger
          }))
        : DEFAULT_EMOJIS
    );
  }, [firstBundledThemeId, mode, seedTheme, t]);

  useEffect(() => {
    void ensureThemeAssets(collectThemeAssetIds(seedTheme));
  }, [ensureThemeAssets, seedTheme]);

  useEffect(
    () => () => {
      revokeDraftAsset(draftPrint);
      Object.values(draftIcons).forEach(revokeDraftAsset);
      draftStickers.forEach((item) => revokeDraftAsset(item.asset.draft));
      draftGifs.forEach((item) => revokeDraftAsset(item.asset.draft));
    },
    [draftGifs, draftIcons, draftPrint, draftStickers]
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
      draftBackgroundMode === 'custom'
        ? {
            kind: 'gradient' as const,
            gradient: composeGradient(draftGradientAngle, draftGradientStops)
          }
        : draftBackgroundMode === 'print' && draftPrint
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
      author: draftAuthor.trim() || 'RadioAtlas',
      parentId: mode === 'remix' ? seedTheme?.id : seedTheme?.parentId,
      createdAt: 0,
      updatedAt: 0,
      mode: draftMode,
      layers: {
        accent: {
          hue: draftHue,
          sat: draftSat,
          lightness: draftLightness
        },
        accent2: draftAccent2Enabled
          ? {
              hue: draftAccent2Hue,
              sat: draftAccent2Sat,
              lightness: draftAccent2Lightness
            }
          : undefined,
        background,
        font: {
          family: draftFont
        },
        icons: draftIconLayer,
        stickers: draftStickers.length
          ? draftStickers.map((sticker) => ({
              assetId: sticker.asset.id,
              slot: sticker.slot,
              x: sticker.x,
              y: sticker.y,
              scale: sticker.scale
            }))
          : undefined,
        gifs: draftGifs.length
          ? draftGifs.map((gif) => ({
              assetId: gif.asset.id,
              slot: gif.slot,
              trigger: gif.trigger
            }))
          : undefined,
        emojiReactions: draftEmojis
          .filter((reaction) => reaction.emoji.trim())
          .map((reaction) => ({
            emoji: reaction.emoji.trim().slice(0, 4),
            trigger: reaction.trigger,
            slot: reaction.slot
          }))
      }
    };
  }, [
    draftAccent2Enabled,
    draftAccent2Hue,
    draftAccent2Lightness,
    draftAccent2Sat,
    draftAuthor,
    draftBackground,
    draftBackgroundMode,
    draftEmojis,
    draftFont,
    draftGifs,
    draftGradientAngle,
    draftGradientStops,
    draftHue,
    draftLightness,
    draftMode,
    draftIconLayer,
    draftName,
    draftPrint,
    draftSat,
    draftStickers,
    mode,
    seedTheme,
    t
  ]);
  // P2-2c: the live preview repaints from a debounced copy of the draft so
  // dragging the hue/sat sliders doesn't repaint the preview on every tick —
  // the slider input stays responsive and the preview catches up ~90ms later.
  const [previewTheme, setPreviewTheme] = useState(draftTheme);
  useEffect(() => {
    const handle = window.setTimeout(() => setPreviewTheme(draftTheme), 90);
    return () => window.clearTimeout(handle);
  }, [draftTheme]);
  const draftResolveAssetUrl = (assetId: string) => {
    if (draftPrint?.id === assetId) return draftPrint.url;
    const stickerDraft = draftStickers.find((item) => item.asset.id === assetId)?.asset.draft;
    if (stickerDraft) return stickerDraft.url;
    const gifDraft = draftGifs.find((item) => item.asset.id === assetId)?.asset.draft;
    if (gifDraft) return gifDraft.url;
    const iconAsset = Object.values(draftIcons).find((asset) => asset?.id === assetId);
    if (iconAsset) return iconAsset.url;
    return getAssetUrl(assetId);
  };

  const updateGradientStop = (index: number, patch: Partial<GradientStop>) => {
    setDraftGradientStops((prev) =>
      prev.map((stop, stopIndex) => (stopIndex === index ? { ...stop, ...patch } : stop))
    );
    setBuilderState('idle');
  };

  // P2-2f: decor list helpers (add / update / remove), capped at MAX_DECOR each.
  const updateSticker = (index: number, patch: Partial<StickerDraft>) => {
    setDraftStickers((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    setBuilderState('idle');
  };
  const removeSticker = (index: number) =>
    setDraftStickers((prev) => {
      revokeDraftAsset(prev[index]?.asset.draft);
      return prev.filter((_, i) => i !== index);
    });
  const updateGif = (index: number, patch: Partial<GifDraft>) => {
    setDraftGifs((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    setBuilderState('idle');
  };
  const removeGif = (index: number) =>
    setDraftGifs((prev) => {
      revokeDraftAsset(prev[index]?.asset.draft);
      return prev.filter((_, i) => i !== index);
    });
  const updateEmoji = (index: number, patch: Partial<EmojiDraft>) => {
    setDraftEmojis((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    setBuilderState('idle');
  };
  const addEmoji = () =>
    setDraftEmojis((prev) =>
      prev.length >= MAX_DECOR ? prev : [...prev, { emoji: '★', slot: 'dockRight', trigger: 'play' }]
    );
  const removeEmoji = (index: number) =>
    setDraftEmojis((prev) => prev.filter((_, i) => i !== index));

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
        ...draftStickers.map((item) => item.asset.draft),
        ...draftGifs.map((item) => item.asset.draft),
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
        author: draftAuthor.trim() || 'RadioAtlas',
        parentId: mode === 'remix' ? seedTheme?.id : seedTheme?.parentId,
        builtin: false,
        mode: draftMode,
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

      <div
        className="theme-studio-builder-preview-panel"
        data-theme-builder-background={draftBackgroundMode}
      >
        <span className="theme-studio-builder-preview-label">{t('theme.previewLabel')}</span>
        <ThemePreviewSurface
          theme={previewTheme}
          resolveAssetUrl={draftResolveAssetUrl}
          stickerPositions={draftStickers.map((sticker) => ({ x: sticker.x, y: sticker.y }))}
          onStickerMove={(index, x, y) => updateSticker(index, { x, y })}
        />
      </div>

      <h4 className="theme-studio-builder-legend">{t('theme.section.identity')}</h4>
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
          <span>{t('theme.authorLabel')}</span>
          <input
            className="settings-input"
            data-theme-builder-author
            onChange={(event) => {
              setDraftAuthor(event.target.value);
              setBuilderState('idle');
            }}
            placeholder={t('theme.authorPlaceholder')}
            type="text"
            value={draftAuthor}
          />
        </label>
        <div className="theme-studio-field">
          <span>{t('theme.modeLabel')}</span>
          <div
            className="theme-studio-mode-toggle"
            role="group"
            aria-label={t('theme.modeLabel')}
          >
            {(['dark', 'light'] as const).map((modeOption) => (
              <button
                aria-pressed={draftMode === modeOption}
                className={`theme-studio-mode-option${draftMode === modeOption ? ' is-active' : ''}`}
                data-theme-builder-mode={modeOption}
                key={modeOption}
                onClick={() => {
                  setDraftMode(modeOption);
                  setBuilderState('idle');
                }}
                type="button"
              >
                {t(`theme.mode.${modeOption}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <h4 className="theme-studio-builder-legend">{t('theme.section.color')}</h4>
      <div className="theme-studio-builder-grid">
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
          <span>{t('theme.accentLightness')}</span>
          <input
            data-theme-builder-lightness
            max={92}
            min={28}
            onChange={(event) => {
              setDraftLightness(Number(event.target.value));
              setBuilderState('idle');
            }}
            type="range"
            value={draftLightness}
          />
        </label>
        <div className="theme-studio-field theme-studio-span-2 theme-studio-accent2">
          <label className="theme-studio-accent2-toggle">
            <input
              checked={draftAccent2Enabled}
              data-theme-builder-accent2
              onChange={(event) => {
                setDraftAccent2Enabled(event.target.checked);
                setBuilderState('idle');
              }}
              type="checkbox"
            />
            <span>{t('theme.accent2Label')}</span>
          </label>
          {draftAccent2Enabled ? (
            <div className="theme-studio-accent2-grid">
              <label className="theme-studio-field">
                <span>{t('theme.accentHue')}</span>
                <input
                  data-theme-builder-accent2-hue
                  max={359}
                  min={0}
                  onChange={(event) => {
                    setDraftAccent2Hue(Number(event.target.value));
                    setBuilderState('idle');
                  }}
                  type="range"
                  value={draftAccent2Hue}
                />
              </label>
              <label className="theme-studio-field">
                <span>{t('theme.accentSat')}</span>
                <input
                  max={100}
                  min={20}
                  onChange={(event) => {
                    setDraftAccent2Sat(Number(event.target.value));
                    setBuilderState('idle');
                  }}
                  type="range"
                  value={draftAccent2Sat}
                />
              </label>
              <label className="theme-studio-field">
                <span>{t('theme.accentLightness')}</span>
                <input
                  max={92}
                  min={28}
                  onChange={(event) => {
                    setDraftAccent2Lightness(Number(event.target.value));
                    setBuilderState('idle');
                  }}
                  type="range"
                  value={draftAccent2Lightness}
                />
              </label>
            </div>
          ) : null}
        </div>
        <label className="theme-studio-field">
          <span>{t('theme.backgroundLabel')}</span>
          <select
            className="settings-input"
            data-theme-builder-background-source
            onChange={(event) => {
              if (event.target.value === '__custom__') {
                setDraftBackgroundMode('custom');
              } else {
                setDraftBackgroundMode('bundled');
                setDraftBackgroundThemeId(event.target.value);
              }
              setBuilderState('idle');
            }}
            value={draftBackgroundMode === 'custom' ? '__custom__' : draftBackgroundThemeId}
          >
            <option value="__custom__">{t('theme.customGradient')}</option>
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
        {draftBackgroundMode === 'custom' ? (
          <div
            className="theme-studio-field theme-studio-span-2 theme-studio-gradient"
            data-theme-gradient-composer
          >
            <span>{t('theme.gradientStops')}</span>
            <div
              className="theme-studio-gradient-preview"
              style={{ background: composeGradient(draftGradientAngle, draftGradientStops) }}
            />
            {draftGradientStops.map((stop, index) => (
              <div className="theme-studio-gradient-stop" key={index}>
                <input
                  aria-label={`${t('theme.gradientStopColor')} ${index + 1}`}
                  data-theme-gradient-color={index}
                  onChange={(event) => updateGradientStop(index, { color: event.target.value })}
                  type="color"
                  value={stop.color}
                />
                <input
                  aria-label={`${t('theme.gradientStopPosition')} ${index + 1}`}
                  max={100}
                  min={0}
                  onChange={(event) =>
                    updateGradientStop(index, { position: Number(event.target.value) })
                  }
                  type="range"
                  value={stop.position}
                />
                <small>{Math.round(stop.position)}%</small>
              </div>
            ))}
            <label className="theme-studio-gradient-angle">
              <span>{t('theme.gradientAngle')}</span>
              <input
                data-theme-gradient-angle
                max={360}
                min={0}
                onChange={(event) => {
                  setDraftGradientAngle(Number(event.target.value));
                  setBuilderState('idle');
                }}
                type="range"
                value={draftGradientAngle}
              />
            </label>
          </div>
        ) : null}
      </div>

      <h4 className="theme-studio-builder-legend">{t('theme.section.typography')}</h4>
      <div className="theme-studio-builder-grid">
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

      <h4 className="theme-studio-builder-legend">{t('theme.section.decor')}</h4>

      <div className="theme-studio-decor-group">
        <div className="theme-studio-decor-head">
          <span>{t('theme.stickerLabel')}</span>
          <label
            className={`chip theme-studio-decor-add${draftStickers.length >= MAX_DECOR ? ' is-disabled' : ''}`}
          >
            {t('theme.decorAdd')}
            <input
              accept="image/png,image/webp,image/svg+xml"
              data-theme-builder-sticker
              disabled={draftStickers.length >= MAX_DECOR}
              hidden
              onChange={(event) => {
                handleAssetUpload(event.target.files?.[0] || null, {
                  prefix: 'sticker',
                  matcher: /^image\/(png|webp|svg\+xml)$/,
                  maxBytes: MAX_DECORATION_BYTES,
                  apply: (asset) =>
                    setDraftStickers((prev) =>
                      prev.length >= MAX_DECOR
                        ? prev
                        : [
                            ...prev,
                            { asset: { id: asset.id, draft: asset }, slot: 'dockLeft', scale: 1, x: 0, y: 0 }
                          ]
                    )
                });
                event.target.value = '';
              }}
              type="file"
            />
          </label>
        </div>
        {draftStickers.length === 0 ? (
          <p className="theme-studio-decor-empty">{t('theme.stickerHint')}</p>
        ) : (
          draftStickers.map((sticker, index) => (
            <div className="theme-studio-decor-item" key={sticker.asset.id}>
              <span
                className="theme-studio-decor-thumb"
                style={{
                  backgroundImage: `url(${JSON.stringify(draftResolveAssetUrl(sticker.asset.id) ?? '')})`
                }}
              />
              <label className="theme-studio-field">
                <span>{t('theme.decorationSlotLabel')}</span>
                <select
                  className="settings-input"
                  onChange={(event) => updateSticker(index, { slot: event.target.value as ThemeSlot })}
                  value={sticker.slot}
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
                  data-theme-builder-sticker-scale={index}
                  max={1.5}
                  min={0.5}
                  onChange={(event) => updateSticker(index, { scale: Number(event.target.value) })}
                  step={0.05}
                  type="range"
                  value={sticker.scale}
                />
              </label>
              <button
                aria-label={t('theme.decorRemove')}
                className="theme-studio-decor-remove"
                onClick={() => removeSticker(index)}
                type="button"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>

      <div className="theme-studio-decor-group">
        <div className="theme-studio-decor-head">
          <span>{t('theme.gifLabel')}</span>
          <label
            className={`chip theme-studio-decor-add${draftGifs.length >= MAX_DECOR ? ' is-disabled' : ''}`}
          >
            {t('theme.decorAdd')}
            <input
              accept="image/gif,image/webp"
              data-theme-builder-gif
              disabled={draftGifs.length >= MAX_DECOR}
              hidden
              onChange={(event) => {
                handleAssetUpload(event.target.files?.[0] || null, {
                  prefix: 'gif',
                  matcher: /^image\/(gif|webp)$/,
                  maxBytes: MAX_DECORATION_BYTES,
                  apply: (asset) =>
                    setDraftGifs((prev) =>
                      prev.length >= MAX_DECOR
                        ? prev
                        : [
                            ...prev,
                            { asset: { id: asset.id, draft: asset }, slot: 'fullPlayerCorner', trigger: 'play' }
                          ]
                    )
                });
                event.target.value = '';
              }}
              type="file"
            />
          </label>
        </div>
        {draftGifs.length === 0 ? (
          <p className="theme-studio-decor-empty">{t('theme.gifHint')}</p>
        ) : (
          draftGifs.map((gif, index) => (
            <div className="theme-studio-decor-item" key={gif.asset.id}>
              <span
                className="theme-studio-decor-thumb"
                style={{
                  backgroundImage: `url(${JSON.stringify(draftResolveAssetUrl(gif.asset.id) ?? '')})`
                }}
              />
              <label className="theme-studio-field">
                <span>{t('theme.decorationSlotLabel')}</span>
                <select
                  className="settings-input"
                  onChange={(event) => updateGif(index, { slot: event.target.value as ThemeSlot })}
                  value={gif.slot}
                >
                  {DECORATION_SLOT_OPTIONS.map((slot) => (
                    <option key={slot} value={slot}>
                      {t(`theme.slot.${slot}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="theme-studio-field">
                <span>{t('theme.gifTriggerLabel')}</span>
                <select
                  className="settings-input"
                  onChange={(event) =>
                    updateGif(index, { trigger: event.target.value as 'idle' | 'play' | 'like' })
                  }
                  value={gif.trigger}
                >
                  {GIF_TRIGGER_OPTIONS.map((trigger) => (
                    <option key={trigger} value={trigger}>
                      {t(`theme.trigger.${trigger}`)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                aria-label={t('theme.decorRemove')}
                className="theme-studio-decor-remove"
                onClick={() => removeGif(index)}
                type="button"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>

      <div className="theme-studio-decor-group">
        <div className="theme-studio-decor-head">
          <span>{t('theme.emojiLabel')}</span>
          <button
            className="chip theme-studio-decor-add"
            disabled={draftEmojis.length >= MAX_DECOR}
            onClick={addEmoji}
            type="button"
          >
            {t('theme.decorAdd')}
          </button>
        </div>
        {draftEmojis.map((reaction, index) => (
          <div className="theme-studio-decor-item" key={index}>
            <input
              className="settings-input theme-studio-decor-emoji-input"
              maxLength={4}
              onChange={(event) => updateEmoji(index, { emoji: event.target.value })}
              type="text"
              value={reaction.emoji}
              {...(index === 0 ? { 'data-theme-builder-emoji': true } : {})}
            />
            <label className="theme-studio-field">
              <span>{t('theme.decorationSlotLabel')}</span>
              <select
                className="settings-input"
                onChange={(event) => updateEmoji(index, { slot: event.target.value as ThemeSlot })}
                value={reaction.slot}
              >
                {DECORATION_SLOT_OPTIONS.map((slot) => (
                  <option key={slot} value={slot}>
                    {t(`theme.slot.${slot}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="theme-studio-field">
              <span>{t('theme.gifTriggerLabel')}</span>
              <select
                className="settings-input"
                onChange={(event) =>
                  updateEmoji(index, { trigger: event.target.value as 'play' | 'like' })
                }
                value={reaction.trigger}
              >
                {EMOJI_TRIGGER_OPTIONS.map((trigger) => (
                  <option key={trigger} value={trigger}>
                    {t(`theme.trigger.${trigger}`)}
                  </option>
                ))}
              </select>
            </label>
            <button
              aria-label={t('theme.decorRemove')}
              className="theme-studio-decor-remove"
              onClick={() => removeEmoji(index)}
              type="button"
            >
              ×
            </button>
          </div>
        ))}
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
