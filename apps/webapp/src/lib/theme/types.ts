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
};

export type RadioAtlasThemeLayers = {
  accent?: {
    hue: number;
    sat: number;
  };
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
