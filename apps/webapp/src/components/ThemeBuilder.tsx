import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from 'react';
import { createPortal } from 'react-dom';
import { useDialog } from '../lib/useDialog';
import { useMobileLayout } from '../lib/useMobileLayout';
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

type BuilderSubSheetProps = {
  name: 'gradient' | 'icons' | 'decor';
  title: string;
  onClose: () => void;
  children: ReactNode;
};

// PR-4b: the builder's mobile sub-sheets (gradient composer / icon uploads /
// decor) ride the shared .bottom-sheet recipe and portal to <body>. Rendered
// inside the SettingsSheet root they would be pinned under its stacking
// context AND the nested useDialog would double-handle Tab (the Globe
// lesson) — as a portal sibling of #root, the sub-sheet's own useDialog
// inerts the whole app (settings sheet included) for true modal semantics.
const BuilderSubSheet = ({ name, title, onClose, children }: BuilderSubSheetProps) => {
  const { t } = useLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialog(rootRef, { isOpen: true, onClose });

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={rootRef}
      className="bottom-sheet theme-builder-subsheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-theme-builder-subsheet={name}
    >
      {/* Out of the tab order (Codex P2): useDialog focuses the first
          focusable element on open, and an invisible full-screen "Close"
          backdrop is a keyboard/screen-reader trap — initial focus lands on
          the visible close button instead. Pointer dismissal still works. */}
      <button
        className="bottom-sheet-scrim"
        type="button"
        onClick={onClose}
        aria-label={t('common.close')}
        tabIndex={-1}
      />
      <div className="bottom-sheet-card theme-builder-subsheet-card">
        <div className="bottom-sheet-handle" aria-hidden="true" />
        <div className="bottom-sheet-head">
          <div>
            <div className="bottom-sheet-kicker">{t('theme.title')}</div>
            <div className="bottom-sheet-title" id={titleId}>
              {title}
            </div>
          </div>
          <button
            className="bottom-sheet-close"
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4Z" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
};

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
  const [draftSticker, setDraftSticker] = useState<DraftAsset | null>(null);
  const [draftStickerSlot, setDraftStickerSlot] = useState<ThemeSlot>('dockLeft');
  const [draftStickerScale, setDraftStickerScale] = useState(1);
  const [draftStickerX, setDraftStickerX] = useState(0);
  const [draftStickerY, setDraftStickerY] = useState(0);
  const [draftGif, setDraftGif] = useState<DraftAsset | null>(null);
  const [draftGifSlot, setDraftGifSlot] = useState<ThemeSlot>('fullPlayerCorner');
  const [draftGifTrigger, setDraftGifTrigger] = useState<'idle' | 'play' | 'like'>('play');
  const [draftEmoji, setDraftEmoji] = useState('✦');
  const [draftEmojiSlot, setDraftEmojiSlot] = useState<ThemeSlot>('dockRight');
  const [builderState, setBuilderState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // PR-4b mobile form: collapsible sticky preview + section nav + sub-sheets.
  const isMobile = useMobileLayout();
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [gradientSheetOpen, setGradientSheetOpen] = useState(false);
  const [iconsSheetOpen, setIconsSheetOpen] = useState(false);
  const [decorSheetOpen, setDecorSheetOpen] = useState(false);
  const identityRef = useRef<HTMLHeadingElement>(null);
  const colorRef = useRef<HTMLHeadingElement>(null);
  const fontRef = useRef<HTMLHeadingElement>(null);
  const iconsRef = useRef<HTMLHeadingElement>(null);
  const decorRef = useRef<HTMLHeadingElement>(null);

  // Crossing back over the 720px breakpoint re-inlines the sub-sheet fields —
  // close any open sheet so its portal doesn't linger without a trigger.
  useEffect(() => {
    if (isMobile) return;
    setGradientSheetOpen(false);
    setIconsSheetOpen(false);
    setDecorSheetOpen(false);
  }, [isMobile]);

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
    setDraftEmoji(seedTheme?.layers.emojiReactions?.[0]?.emoji ?? '✦');
    setDraftEmojiSlot(seedTheme?.layers.emojiReactions?.[0]?.slot ?? 'dockRight');
    setDraftBackgroundMode(seedTheme?.layers.background?.kind === 'image' ? 'print' : 'bundled');
    setDraftBackgroundThemeId(seedTheme?.builtin ? seedTheme.id : firstBundledThemeId);
    setDraftStickerSlot(seedTheme?.layers.stickers?.[0]?.slot ?? 'dockLeft');
    setDraftStickerScale(seedTheme?.layers.stickers?.[0]?.scale ?? 1);
    setDraftStickerX(seedTheme?.layers.stickers?.[0]?.x ?? 0);
    setDraftStickerY(seedTheme?.layers.stickers?.[0]?.y ?? 0);
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
        stickers: draftSticker
          ? [
              {
                assetId: draftSticker.id,
                slot: draftStickerSlot,
                x: draftStickerX,
                y: draftStickerY,
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
    draftAccent2Enabled,
    draftAccent2Hue,
    draftAccent2Lightness,
    draftAccent2Sat,
    draftAuthor,
    draftBackground,
    draftBackgroundMode,
    draftEmoji,
    draftEmojiSlot,
    draftFont,
    draftGradientAngle,
    draftGradientStops,
    draftHue,
    draftLightness,
    draftMode,
    draftGif,
    draftGifSlot,
    draftGifTrigger,
    draftIconLayer,
    draftName,
    draftPrint,
    draftSat,
    draftSticker,
    draftStickerScale,
    draftStickerSlot,
    draftStickerX,
    draftStickerY,
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
    if (draftSticker?.id === assetId) return draftSticker.url;
    if (draftGif?.id === assetId) return draftGif.url;
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

  // Shared by the desktop inline grid and the mobile sub-sheets — one handler
  // per upload kind so the two render paths can't drift.
  const handleIconUpload = (iconName: ThemeIconName, file: File | null) =>
    handleAssetUpload(file, {
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
    });

  const handleStickerUpload = (file: File | null) =>
    handleAssetUpload(file, {
      prefix: 'sticker',
      matcher: /^image\/(png|webp|svg\+xml)$/,
      maxBytes: MAX_DECORATION_BYTES,
      apply: (asset) =>
        setDraftSticker((prev) => {
          revokeDraftAsset(prev);
          return asset;
        })
    });

  const handleGifUpload = (file: File | null) =>
    handleAssetUpload(file, {
      prefix: 'gif',
      matcher: /^image\/(gif|webp)$/,
      maxBytes: MAX_DECORATION_BYTES,
      apply: (asset) =>
        setDraftGif((prev) => {
          revokeDraftAsset(prev);
          return asset;
        })
    });

  const scrollToSection = (ref: RefObject<HTMLElement | null>) => {
    // Jumping to a section is an editing intent — collapse the tall preview so
    // the target lands fully visible under the (now ~72px) sticky strip.
    setPreviewCollapsed(true);
    requestAnimationFrame(() =>
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    );
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

  const accentCss = `hsl(${draftHue} ${draftSat}% ${draftLightness}%)`;
  const accent2Css = draftAccent2Enabled
    ? `hsl(${draftAccent2Hue} ${draftAccent2Sat}% ${draftAccent2Lightness}%)`
    : accentCss;
  // The collapsed strip's background swatch mirrors whatever the draft would
  // actually paint behind the shell.
  const collapsedSwatchBackground =
    draftBackgroundMode === 'custom'
      ? composeGradient(draftGradientAngle, draftGradientStops)
      : draftBackgroundMode === 'print' && draftPrint
        ? `url(${JSON.stringify(draftPrint.url)}) center / cover`
        : draftBackground?.kind === 'gradient'
          ? draftBackground.gradient
          : accentCss;
  const uploadedIconNames = ICON_UPLOAD_OPTIONS.map((iconName) => draftIcons[iconName]?.name)
    .filter(Boolean)
    .join(' · ');
  const decorSummary =
    [draftSticker?.name, draftGif?.name, draftEmoji.trim()].filter(Boolean).join(' · ') ||
    t('theme.stickerHint');
  const sectionNav: Array<{ key: string; label: string; ref: RefObject<HTMLElement | null> }> = [
    { key: 'identity', label: t('theme.section.identity'), ref: identityRef },
    { key: 'color', label: t('theme.section.color'), ref: colorRef },
    { key: 'font', label: t('theme.section.font'), ref: fontRef },
    { key: 'icons', label: t('theme.section.icons'), ref: iconsRef },
    { key: 'decor', label: t('theme.section.decor'), ref: decorRef }
  ];

  // One markup for the composer in BOTH hosts — inline on desktop, inside the
  // gradient sub-sheet on mobile (restyled to stacked rows by sheet-scoped
  // CSS). Keeps the data-theme-gradient-* contract single-sourced.
  const renderGradientComposer = () => (
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
        {isMobile ? (
          <em className="theme-builder-field-value">{Math.round(draftGradientAngle)}°</em>
        ) : null}
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
  );

  const sliderFieldClass = isMobile
    ? 'theme-studio-field theme-builder-slider-field'
    : 'theme-studio-field';

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
        data-theme-builder-preview-collapsed={isMobile && previewCollapsed ? 'true' : undefined}
      >
        {isMobile ? (
          <div className="theme-builder-preview-head">
            {previewCollapsed ? (
              <span className="theme-builder-preview-mini">
                <span
                  className="theme-builder-preview-dot"
                  style={{ background: `linear-gradient(135deg, ${accentCss}, ${accent2Css})` }}
                  aria-hidden="true"
                />
                <strong>{draftName.trim() || t('theme.customDefaultName')}</strong>
                <span
                  className="theme-builder-preview-swatch"
                  style={{ background: collapsedSwatchBackground }}
                  aria-hidden="true"
                />
              </span>
            ) : (
              <span className="theme-studio-builder-preview-label">{t('theme.previewLabel')}</span>
            )}
            <button
              className="theme-builder-preview-toggle"
              type="button"
              aria-expanded={!previewCollapsed}
              aria-label={previewCollapsed ? t('theme.expandPreview') : t('theme.collapsePreview')}
              onClick={() => setPreviewCollapsed((value) => !value)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 15.4 4.6 8 6 6.6l6 6 6-6L19.4 8Z" />
              </svg>
            </button>
          </div>
        ) : (
          <span className="theme-studio-builder-preview-label">{t('theme.previewLabel')}</span>
        )}
        {isMobile && previewCollapsed ? null : (
          <ThemePreviewSurface
            theme={previewTheme}
            resolveAssetUrl={draftResolveAssetUrl}
            stickerPosition={{ x: draftStickerX, y: draftStickerY }}
            onStickerMove={(x, y) => {
              setDraftStickerX(x);
              setDraftStickerY(y);
              setBuilderState('idle');
            }}
          />
        )}
      </div>

      {isMobile ? (
        <nav className="theme-builder-section-nav" aria-label={t('theme.sectionNavLabel')}>
          {sectionNav.map((section) => (
            <button
              className="chip"
              key={section.key}
              onClick={() => scrollToSection(section.ref)}
              type="button"
            >
              {section.label}
            </button>
          ))}
        </nav>
      ) : null}

      <h4 className="theme-studio-builder-legend" ref={identityRef}>{t('theme.section.identity')}</h4>
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

      <h4 className="theme-studio-builder-legend" ref={colorRef}>{t('theme.section.color')}</h4>
      <div className="theme-studio-builder-grid">
        <label className={sliderFieldClass}>
          <span>{t('theme.accentHue')}</span>
          {isMobile ? <em className="theme-builder-field-value">{draftHue}</em> : null}
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
        <label className={sliderFieldClass}>
          <span>{t('theme.accentSat')}</span>
          {isMobile ? <em className="theme-builder-field-value">{draftSat}</em> : null}
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
        <label className={sliderFieldClass}>
          <span>{t('theme.accentLightness')}</span>
          {isMobile ? <em className="theme-builder-field-value">{draftLightness}</em> : null}
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
              <label className={sliderFieldClass}>
                <span>{t('theme.accentHue')}</span>
                {isMobile ? (
                  <em className="theme-builder-field-value">{draftAccent2Hue}</em>
                ) : null}
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
              <label className={sliderFieldClass}>
                <span>{t('theme.accentSat')}</span>
                {isMobile ? (
                  <em className="theme-builder-field-value">{draftAccent2Sat}</em>
                ) : null}
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
              <label className={sliderFieldClass}>
                <span>{t('theme.accentLightness')}</span>
                {isMobile ? (
                  <em className="theme-builder-field-value">{draftAccent2Lightness}</em>
                ) : null}
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
          isMobile ? (
            <div className="theme-studio-field theme-studio-span-2">
              <span>{t('theme.gradientStops')}</span>
              <button
                className="theme-builder-gradient-trigger"
                onClick={() => setGradientSheetOpen(true)}
                type="button"
              >
                <span
                  className="theme-builder-gradient-trigger-strip"
                  style={{ background: composeGradient(draftGradientAngle, draftGradientStops) }}
                  aria-hidden="true"
                />
                <span className="theme-builder-gradient-trigger-label">
                  {t('theme.editGradient')}
                </span>
              </button>
            </div>
          ) : (
            renderGradientComposer()
          )
        ) : null}
      </div>

      <h4 className="theme-studio-builder-legend" ref={fontRef}>{t('theme.section.typography')}</h4>
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

      {isMobile ? (
        <>
          <h4 className="theme-studio-builder-legend" ref={iconsRef}>
            {t('theme.section.icons')}
          </h4>
          <button
            className="theme-builder-subsheet-trigger"
            onClick={() => setIconsSheetOpen(true)}
            type="button"
          >
            <span className="theme-builder-subsheet-trigger-copy">
              <strong>{t('theme.iconUploads')}</strong>
              <small>{uploadedIconNames || t('theme.iconUploadHint')}</small>
            </span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8.6 4.6 16 12l-7.4 7.4L7.2 18l6-6-6-6Z" />
            </svg>
          </button>
        </>
      ) : (
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
                onChange={(event) => handleIconUpload(iconName, event.target.files?.[0] || null)}
                type="file"
              />
              <small>{draftIcons[iconName]?.name || t('theme.iconUploadHint')}</small>
            </label>
          ))}
        </div>
      )}

      <h4 className="theme-studio-builder-legend" ref={decorRef}>{t('theme.section.decor')}</h4>
      {isMobile ? (
        <button
          className="theme-builder-subsheet-trigger"
          onClick={() => setDecorSheetOpen(true)}
          type="button"
        >
          <span className="theme-builder-subsheet-trigger-copy">
            <strong>{t('theme.openDecor')}</strong>
            <small>{decorSummary}</small>
          </span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8.6 4.6 16 12l-7.4 7.4L7.2 18l6-6-6-6Z" />
          </svg>
        </button>
      ) : (
        <div className="theme-studio-asset-grid">
          <label className="theme-studio-field theme-studio-print-field">
            <span>{t('theme.stickerLabel')}</span>
            <input
              className="settings-input"
              data-theme-builder-sticker
              accept="image/png,image/webp,image/svg+xml"
              onChange={(event) => handleStickerUpload(event.target.files?.[0] || null)}
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
              onChange={(event) => handleGifUpload(event.target.files?.[0] || null)}
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
      )}

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

      {isMobile && gradientSheetOpen ? (
        <BuilderSubSheet
          name="gradient"
          title={t('theme.customGradient')}
          onClose={() => setGradientSheetOpen(false)}
        >
          {renderGradientComposer()}
        </BuilderSubSheet>
      ) : null}

      {isMobile && iconsSheetOpen ? (
        <BuilderSubSheet
          name="icons"
          title={t('theme.iconUploads')}
          onClose={() => setIconsSheetOpen(false)}
        >
          <div className="theme-builder-sheet-fields" data-theme-icon-upload-grid>
            {ICON_UPLOAD_OPTIONS.map((iconName) => (
              <label className="theme-builder-upload-row" key={iconName}>
                <span className="theme-builder-upload-label">{t(`theme.iconSlot.${iconName}`)}</span>
                <span className="theme-builder-upload-button">
                  {draftIcons[iconName]?.name || t('theme.uploadAction')}
                </span>
                {/* The real input stays in the DOM (visually hidden, NEVER
                    display:none) so e2e setInputFiles can target it. */}
                <input
                  className="theme-builder-upload-input"
                  data-theme-builder-icon={iconName}
                  accept="image/svg+xml,image/png"
                  onChange={(event) => handleIconUpload(iconName, event.target.files?.[0] || null)}
                  type="file"
                />
              </label>
            ))}
            <small className="theme-builder-upload-hint">{t('theme.iconUploadHint')}</small>
          </div>
        </BuilderSubSheet>
      ) : null}

      {isMobile && decorSheetOpen ? (
        <BuilderSubSheet
          name="decor"
          title={t('theme.section.decor')}
          onClose={() => setDecorSheetOpen(false)}
        >
          <div className="theme-builder-sheet-fields">
            <div className="theme-builder-decor-block">
              <label className="theme-builder-upload-row">
                <span className="theme-builder-upload-label">{t('theme.stickerLabel')}</span>
                <span className="theme-builder-upload-button">
                  {draftSticker?.name || t('theme.uploadAction')}
                </span>
                <input
                  className="theme-builder-upload-input"
                  data-theme-builder-sticker
                  accept="image/png,image/webp,image/svg+xml"
                  onChange={(event) => handleStickerUpload(event.target.files?.[0] || null)}
                  type="file"
                />
              </label>
              <small className="theme-builder-upload-hint">{t('theme.stickerHint')}</small>
              <ThemePreviewSurface
                theme={previewTheme}
                resolveAssetUrl={draftResolveAssetUrl}
                stickerPosition={{ x: draftStickerX, y: draftStickerY }}
                onStickerMove={(x, y) => {
                  setDraftStickerX(x);
                  setDraftStickerY(y);
                  setBuilderState('idle');
                }}
              />
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
              <label className="theme-studio-field theme-builder-slider-field">
                <span>{t('theme.scaleLabel')}</span>
                <em className="theme-builder-field-value">{draftStickerScale.toFixed(2)}</em>
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
            </div>

            <div className="theme-builder-decor-block">
              <label className="theme-builder-upload-row">
                <span className="theme-builder-upload-label">{t('theme.gifLabel')}</span>
                <span className="theme-builder-upload-button">
                  {draftGif?.name || t('theme.uploadAction')}
                </span>
                <input
                  className="theme-builder-upload-input"
                  data-theme-builder-gif
                  accept="image/gif,image/webp"
                  onChange={(event) => handleGifUpload(event.target.files?.[0] || null)}
                  type="file"
                />
              </label>
              <small className="theme-builder-upload-hint">{t('theme.gifHint')}</small>
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
            </div>

            <div className="theme-builder-decor-block">
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
          </div>
        </BuilderSubSheet>
      ) : null}
    </section>
  );
};
