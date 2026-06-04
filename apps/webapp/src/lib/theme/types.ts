export type ThemeSlot =
  | 'dockLeft'
  | 'dockRight'
  | 'fullPlayerCorner'
  | 'fullPlayerBackdrop'
  | 'homeHeroCorner'
  | 'globeOverlay';

export type ThemeAssetKind = 'background' | 'icon' | 'sticker' | 'gif';

export type ThemeBackgroundLayer =
  | {
      kind: 'image';
      assetId: string;
      gradient?: never;
    }
  | {
      kind: 'gradient';
      assetId?: never;
      gradient: string;
    };

export type ThemeIconStyle = 'round' | 'soft' | 'sharp';

export type ThemeIconLayer = Partial<Record<'play' | 'pause' | 'next' | 'prev' | 'like', string>> & {
  style?: ThemeIconStyle;
};

export type ThemeFontLayer = {
  family: 'system' | 'serif' | 'mono' | 'rounded';
};

export type ThemeStickerLayer = {
  assetId: string;
  slot: ThemeSlot;
  x: number;
  y: number;
  scale: number;
};

export type ThemeGifLayer = {
  assetId: string;
  slot: ThemeSlot;
  trigger: 'idle' | 'play' | 'like';
};

export type ThemeEmojiReactionLayer = {
  emoji: string;
  trigger: 'play' | 'like';
  slot?: ThemeSlot;
};

// P2-2d: accent carries an optional `lightness` so the editor can author a full
// HSL colour, not just hue+sat. Absent => the historical fixed 68% / 70% (so
// every existing theme is byte-identical, no migration).
export type ThemeAccentColor = {
  hue: number;
  sat: number;
  lightness?: number;
};

export type RadioAtlasThemeLayers = {
  accent?: ThemeAccentColor;
  // P2-2d: an explicit secondary accent. Absent => derived from `accent`
  // (hue+42, sat*0.74) exactly as before.
  accent2?: ThemeAccentColor;
  background?: ThemeBackgroundLayer;
  icons?: ThemeIconLayer;
  font?: ThemeFontLayer;
  stickers?: ThemeStickerLayer[];
  gifs?: ThemeGifLayer[];
  emojiReactions?: ThemeEmojiReactionLayer[];
};

export type RadioAtlasTheme = {
  version: 1;
  id: string;
  name: string;
  author?: string;
  parentId?: string;
  createdAt: number;
  updatedAt: number;
  builtin?: boolean;
  // T_share_4: gated behind the `referral-theme` entitlement. Visible-but-locked
  // until earned (ThemeContext refuses to apply it without the entitlement).
  // Only NEW exclusive themes set this — the six free themes never do.
  locked?: boolean;
  // P1 foundation: drives the chrome surface set (bg/panel/text/border/muted) so
  // the theme reaches more than the hidden background + accent. Defaults to
  // 'dark' — every existing theme is dark, and a missing/`'dark'` mode is a pure
  // no-op (the chrome falls back to the unchanged dark token defaults).
  // `'light'` swaps in a readable light surface set (dark ink) so light themes
  // like Pastel stop breaking.
  mode?: 'light' | 'dark';
  // P1b: scales how strongly the dark chrome (panels/border/bg) picks up the
  // accent in `themeSurfaceVars`. 1 (default/absent) is the calibrated baseline;
  // >1 makes a theme's surfaces carry its hue decisively (a warm accent washes
  // out toward neutral when mixed at the base %, so warm themes like Sunset need
  // a stronger pull to read), <1 calms a loud one. No-op for light themes (their
  // chrome comes from the CSS light block, not the accent mix). Additive/optional
  // — absent means ×1, so every existing theme is byte-identical.
  chromeTint?: number;
  layers: RadioAtlasThemeLayers;
};

export type ThemeAsset = {
  version: 1;
  id: string;
  kind: ThemeAssetKind;
  name: string;
  mimeType: string;
  blob: Blob;
  createdAt: number;
  updatedAt: number;
};

export type ThemeDraftInput = Omit<RadioAtlasTheme, 'version' | 'createdAt' | 'updatedAt'> &
  Partial<Pick<RadioAtlasTheme, 'version' | 'createdAt' | 'updatedAt'>>;

export type ThemeAssetInput = Omit<ThemeAsset, 'version' | 'createdAt' | 'updatedAt'> &
  Partial<Pick<ThemeAsset, 'version' | 'createdAt' | 'updatedAt'>>;
