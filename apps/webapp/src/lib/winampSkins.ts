import type { SkinPalette, WinampSkinPreset } from '../types';

export const WINAMP_CLASSIC_PALETTE: SkinPalette = {
  bg: '#0f1221',
  panel: '#22263a',
  accent: '#56f35a',
  muted: '#a2afc4',
  border: '#4c5674',
  text: '#e9f0ff'
};

export const WINAMP_SKIN_PRESETS: WinampSkinPreset[] = [
  {
    id: 'base-2.91',
    name: 'Winamp Base 2.91',
    url: '/winamp-skins/base-2.91.wsz',
    palette: WINAMP_CLASSIC_PALETTE
  },
  {
    id: 'eric-potter',
    name: 'Eric Potter',
    url: '/winamp-skins/Eric_Potter.wsz'
  },
  {
    id: 'tenchi-muyo-aeka',
    name: 'Tenchi Muyo - Aeka',
    url: '/winamp-skins/Tenchi Muyo - Aeka.wsz'
  }
];

export const DEFAULT_WINAMP_SKIN_ID = 'base-2.91';

export const findPresetSkin = (id: string | null | undefined) =>
  WINAMP_SKIN_PRESETS.find((item) => item.id === id) ?? WINAMP_SKIN_PRESETS[0];
