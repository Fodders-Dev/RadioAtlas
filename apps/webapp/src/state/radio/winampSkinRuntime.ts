import { applySkinPalette, applySkinThemeFromUrl } from '../../lib/skinTheme';
import { fetchMuseumSkinByMd5 } from '../../lib/skinMuseum';
import type { ActiveWinampSkin } from '../../types';
import {
  DEFAULT_WINAMP_SKIN_ID,
  WINAMP_CLASSIC_PALETTE,
  toActiveSkin,
  toMuseumActiveSkin
} from './defaults';
import type { StoredSkin } from './types';

export const resolveStoredActiveSkin = async (storedSkin: StoredSkin) => {
  if (storedSkin.source === 'preset') {
    return {
      skin: toActiveSkin(storedSkin.id),
      usedFallback: false
    };
  }

  if (storedSkin.source === 'museum' && storedSkin.md5) {
    const restoredSkin = await fetchMuseumSkinByMd5(storedSkin.md5);
    if (restoredSkin) {
      return {
        skin: toMuseumActiveSkin(restoredSkin),
        usedFallback: false,
        restoredName: restoredSkin.name
      };
    }
  }

  return {
    skin: toActiveSkin(DEFAULT_WINAMP_SKIN_ID),
    usedFallback: true
  };
};

export const applyActiveSkinTheme = async (activeSkin: ActiveWinampSkin) => {
  document.documentElement.dataset.skinSource = activeSkin.source;
  document.documentElement.dataset.skinName = activeSkin.name;
  if (activeSkin.palette) {
    return applySkinPalette(activeSkin.palette);
  }
  return applySkinThemeFromUrl(activeSkin.url, WINAMP_CLASSIC_PALETTE);
};

export const applyClassicSkinTheme = () => applySkinPalette(WINAMP_CLASSIC_PALETTE);
