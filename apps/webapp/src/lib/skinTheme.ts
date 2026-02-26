import JSZip from 'jszip';
import type { SkinPalette } from '../types';
import { WINAMP_CLASSIC_PALETTE } from './winampSkins';

type Rgb = { r: number; g: number; b: number };

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const toHex = (value: number) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');

const rgbToHex = (rgb: Rgb) => `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;

const hexToRgb = (value: string): Rgb | null => {
  const normalized = value.trim().replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
};

const mix = (a: Rgb, b: Rgb, amount: number): Rgb => ({
  r: a.r + (b.r - a.r) * amount,
  g: a.g + (b.g - a.g) * amount,
  b: a.b + (b.b - a.b) * amount
});

const luminance = ({ r, g, b }: Rgb) => {
  const normalize = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * normalize(r) + 0.7152 * normalize(g) + 0.0722 * normalize(b);
};

const contrastRatio = (a: Rgb, b: Rgb) => {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const bright = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (bright + 0.05) / (dark + 0.05);
};

const candidateText = (bg: Rgb) => {
  const white = { r: 243, g: 247, b: 255 };
  const black = { r: 18, g: 23, b: 34 };
  return contrastRatio(bg, white) >= contrastRatio(bg, black) ? white : black;
};

const imageFromBlob = async (blob: Blob) => {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Image decode failed'));
      image.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const extractPaletteFromImageBlob = async (blob: Blob): Promise<SkinPalette> => {
  const image = await imageFromBlob(blob);
  const canvas = document.createElement('canvas');
  const width = clamp(image.width, 16, 512);
  const height = clamp(image.height, 16, 512);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Canvas context missing');
  }
  context.drawImage(image, 0, 0, width, height);
  const data = context.getImageData(0, 0, width, height).data;

  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  let ar = 0;
  let ag = 0;
  let ab = 0;
  let an = 0;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    if (alpha < 0.1) continue;
    const rr = data[i];
    const gg = data[i + 1];
    const bb = data[i + 2];

    r += rr;
    g += gg;
    b += bb;
    n += 1;

    const sat = Math.max(rr, gg, bb) - Math.min(rr, gg, bb);
    if (sat > 42 || (rr > 160 && gg > 160)) {
      ar += rr;
      ag += gg;
      ab += bb;
      an += 1;
    }
  }

  if (!n) {
    return WINAMP_CLASSIC_PALETTE;
  }

  const bg = {
    r: clamp((r / n) * 0.35, 8, 80),
    g: clamp((g / n) * 0.35, 8, 92),
    b: clamp((b / n) * 0.38, 12, 112)
  };

  const accentSource = an ? { r: ar / an, g: ag / an, b: ab / an } : { r: r / n, g: g / n, b: b / n };
  const accent = {
    r: clamp(accentSource.r * 1.05, 70, 255),
    g: clamp(accentSource.g * 1.05, 70, 255),
    b: clamp(accentSource.b * 1.05, 70, 255)
  };

  const panel = mix(bg, accent, 0.22);
  const text = candidateText(bg);
  const muted = mix(text, bg, 0.45);
  const border = mix(accent, panel, 0.55);

  return {
    bg: rgbToHex(bg),
    panel: rgbToHex(panel),
    accent: rgbToHex(accent),
    muted: rgbToHex(muted),
    border: rgbToHex(border),
    text: rgbToHex(text)
  };
};

const pickSkinImageFile = (zip: JSZip) => {
  const files = Object.values(zip.files).filter((file) => !file.dir);
  const byName = files.find((file) => /(^|\/|\\)main\.(bmp|png|jpg|jpeg)$/i.test(file.name));
  if (byName) return byName;

  const face = files.find((file) => /(^|\/|\\)(pledit|eqmain|cbuttons|titlebar)\.(bmp|png|jpg|jpeg)$/i.test(file.name));
  if (face) return face;

  return files.find((file) => /\.(bmp|png|jpg|jpeg)$/i.test(file.name)) ?? null;
};

export const extractSkinPaletteFromBlob = async (blob: Blob): Promise<SkinPalette> => {
  const zip = await JSZip.loadAsync(blob);
  const imageFile = pickSkinImageFile(zip);
  if (!imageFile) {
    throw new Error('Skin image not found');
  }
  const imageBlob = await imageFile.async('blob');
  return extractPaletteFromImageBlob(imageBlob);
};

export const extractSkinPaletteFromUrl = async (url: string): Promise<SkinPalette> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Skin fetch failed (${response.status})`);
  }
  const blob = await response.blob();
  return extractSkinPaletteFromBlob(blob);
};

const safePalette = (palette: SkinPalette): SkinPalette => {
  const bg = hexToRgb(palette.bg) ?? hexToRgb(WINAMP_CLASSIC_PALETTE.bg)!;
  const panel = hexToRgb(palette.panel) ?? hexToRgb(WINAMP_CLASSIC_PALETTE.panel)!;
  const accent = hexToRgb(palette.accent) ?? hexToRgb(WINAMP_CLASSIC_PALETTE.accent)!;
  const text = hexToRgb(palette.text) ?? candidateText(bg);

  const adjustedText = contrastRatio(bg, text) >= 4.5 ? text : candidateText(bg);

  return {
    bg: rgbToHex(bg),
    panel: rgbToHex(panel),
    accent: rgbToHex(accent),
    muted:
      palette.muted && hexToRgb(palette.muted)
        ? palette.muted
        : rgbToHex(mix(adjustedText, bg, 0.46)),
    border:
      palette.border && hexToRgb(palette.border)
        ? palette.border
        : rgbToHex(mix(accent, panel, 0.52)),
    text: rgbToHex(adjustedText)
  };
};

export const applySkinPalette = (palette: SkinPalette) => {
  const safe = safePalette(palette);
  const root = document.documentElement;
  root.style.setProperty('--bg', safe.bg);
  root.style.setProperty('--bg-2', rgbToHex(mix(hexToRgb(safe.bg)!, hexToRgb(safe.panel)!, 0.4)));
  root.style.setProperty('--panel', safe.panel);
  root.style.setProperty('--panel-2', rgbToHex(mix(hexToRgb(safe.panel)!, hexToRgb(safe.bg)!, 0.25)));
  root.style.setProperty('--accent', safe.accent);
  root.style.setProperty('--accent-2', rgbToHex(mix(hexToRgb(safe.accent)!, { r: 255, g: 214, b: 129 }, 0.25)));
  root.style.setProperty('--muted', safe.muted);
  root.style.setProperty('--border', safe.border);
  root.style.setProperty('--text', safe.text);
  return safe;
};

export const applySkinThemeFromUrl = async (
  url: string,
  fallback: SkinPalette = WINAMP_CLASSIC_PALETTE
) => {
  try {
    const palette = await extractSkinPaletteFromUrl(url);
    return applySkinPalette(palette);
  } catch {
    return applySkinPalette(fallback);
  }
};
