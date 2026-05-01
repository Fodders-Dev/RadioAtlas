import type { RadioAtlasTheme, ThemeSlot } from './types';

export type ThemeDecorationState = {
  playing: boolean;
  liked: boolean;
};

export type ThemeDecoration =
  | {
      kind: 'asset';
      source: 'sticker' | 'gif';
      slot: ThemeSlot;
      url: string;
      x: number;
      y: number;
      scale: number;
      trigger?: 'idle' | 'play' | 'like';
    }
  | {
      kind: 'emoji';
      slot: ThemeSlot;
      emoji: string;
      trigger: 'play' | 'like';
    };

const triggerActive = (
  trigger: 'idle' | 'play' | 'like',
  state: ThemeDecorationState
) => {
  if (trigger === 'idle') return !state.playing;
  if (trigger === 'play') return state.playing;
  return state.liked;
};

const fallbackReactionSlot = (trigger: 'play' | 'like'): ThemeSlot =>
  trigger === 'like' ? 'homeHeroCorner' : 'dockRight';

export const resolveThemeDecorations = (
  theme: RadioAtlasTheme,
  resolveAssetUrl: (assetId: string) => string | null,
  state: ThemeDecorationState
): ThemeDecoration[] => {
  const decorations: ThemeDecoration[] = [];

  for (const sticker of theme.layers.stickers || []) {
    const url = resolveAssetUrl(sticker.assetId);
    if (!url) continue;
    decorations.push({
      kind: 'asset',
      source: 'sticker',
      slot: sticker.slot,
      url,
      x: sticker.x,
      y: sticker.y,
      scale: sticker.scale
    });
  }

  for (const gif of theme.layers.gifs || []) {
    const url = resolveAssetUrl(gif.assetId);
    if (!url || !triggerActive(gif.trigger, state)) continue;
    decorations.push({
      kind: 'asset',
      source: 'gif',
      slot: gif.slot,
      url,
      x: 0,
      y: 0,
      scale: 1,
      trigger: gif.trigger
    });
  }

  for (const reaction of theme.layers.emojiReactions || []) {
    const emoji = reaction.emoji.trim().slice(0, 4);
    if (!emoji || !triggerActive(reaction.trigger, state)) continue;
    decorations.push({
      kind: 'emoji',
      slot: reaction.slot || fallbackReactionSlot(reaction.trigger),
      emoji,
      trigger: reaction.trigger
    });
  }

  return decorations;
};
