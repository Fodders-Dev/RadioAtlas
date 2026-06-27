// Station-backdrop colour engine (Phase 1, Layer A source). Pulls a small,
// HSL-clamped {primary, secondary, tertiary, angle} palette out of a station's
// own artwork so the full-bleed player background is tinted by the cover — and
// stays pretty even when the cover is muddy, dark, or low-quality.
//
// CORS note: getImageData only reads a same-origin / CORS-clean image. The
// display proxy (assetUrl.getProxiedAssetUrl) passes https straight through, so
// a raw https cover would TAINT the canvas and throw on read. For EXTRACTION we
// therefore force every cover through the same-origin /image proxy (even https)
// plus crossOrigin='anonymous'. The visible <img> in StationBackdrop keeps using
// the normal proxy — only this module force-proxies.
//
// Async, cached, never throws: any failure resolves null so the caller falls
// back to createGeneratedArtworkPalette(station).

import { getApiBase } from './apiBase';

export type ExtractedPalette = {
  primary: string;
  secondary: string;
  tertiary: string;
  angle: string;
};

// Largest offscreen sample edge — a 32×32 read is plenty for a dominant colour
// and costs a sub-millisecond draw.
const MAX_SAMPLE = 32;

// HSL clamp bands keep every extracted stop in a readable, non-garish range so a
// near-black or washed-out cover still yields a visible, tasteful gradient.
const PRIMARY_S = { min: 0.3, max: 0.82 };
const PRIMARY_L = { min: 0.4, max: 0.6 };
const SECONDARY_S = { min: 0.4, max: 0.82 };
const SECONDARY_L = { min: 0.54, max: 0.7 };
const TERTIARY_S = { min: 0.3, max: 0.72 };
const TERTIARY_L = { min: 0.3, max: 0.46 };

const clamp = (value: number, min: number, max: number) =>
  value < min ? min : value > max ? max : value;

type Hsl = { h: number; s: number; l: number };

export const rgbToHsl = (r: number, g: number, b: number): Hsl => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;
  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === rn) h = ((gn - bn) / delta + (gn < bn ? 6 : 0)) * 60;
    else if (max === gn) h = ((bn - rn) / delta + 2) * 60;
    else h = ((rn - gn) / delta + 4) * 60;
  }
  return { h, s, l };
};

const formatHsl = (hsl: Hsl, sBand: { min: number; max: number }, lBand: { min: number; max: number }) => {
  const h = Math.round(((hsl.h % 360) + 360) % 360);
  const s = Math.round(clamp(hsl.s, sBand.min, sBand.max) * 100);
  const l = Math.round(clamp(hsl.l, lBand.min, lBand.max) * 100);
  return `hsl(${h} ${s}% ${l}%)`;
};

const hueDistance = (a: number, b: number) => {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
};

type Bucket = { count: number; r: number; g: number; b: number; hsl: Hsl };

// Quantize opaque pixels into 8×8×8 colour buckets, each carrying its averaged
// representative colour. Returns null when nothing opaque was sampled.
const bucketize = (data: Uint8ClampedArray): { buckets: Bucket[]; opaque: number } | null => {
  const sums = new Map<number, { count: number; r: number; g: number; b: number }>();
  let opaque = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 128) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    opaque += 1;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const entry = sums.get(key);
    if (entry) {
      entry.count += 1;
      entry.r += r;
      entry.g += g;
      entry.b += b;
    } else {
      sums.set(key, { count: 1, r, g, b });
    }
  }
  if (opaque === 0) return null;
  const buckets: Bucket[] = [];
  for (const entry of sums.values()) {
    const r = entry.r / entry.count;
    const g = entry.g / entry.count;
    const b = entry.b / entry.count;
    buckets.push({ count: entry.count, r, g, b, hsl: rgbToHsl(r, g, b) });
  }
  return { buckets, opaque };
};

// Pure analysis seam — unit-tested directly with synthetic ImageData (no canvas).
export const analyzeImageData = (
  image: { data: Uint8ClampedArray; width?: number; height?: number }
): ExtractedPalette | null => {
  if (!image?.data || image.data.length < 4) return null;
  const result = bucketize(image.data);
  if (!result) return null;
  const { buckets, opaque } = result;

  // Ignore single-speck buckets so a stray vivid pixel can't hijack the tint.
  const minCount = Math.max(2, Math.floor(opaque * 0.01));
  let pool = buckets.filter((bucket) => bucket.count >= minCount);
  if (pool.length === 0) pool = buckets;

  // Primary: large AND colourful (count blended with saturation) so neither the
  // dark background nor a tiny accent wins outright.
  const score = (bucket: Bucket) => bucket.count * (0.3 + bucket.hsl.s * 0.9);
  const primary = pool.reduce((best, bucket) => (score(bucket) > score(best) ? bucket : best));

  const HUE_GAP = 30;
  const secondary =
    pool
      .filter((bucket) => hueDistance(bucket.hsl.h, primary.hsl.h) >= HUE_GAP)
      .reduce<Bucket | null>(
        (best, bucket) =>
          !best || bucket.count * (0.2 + bucket.hsl.s) > best.count * (0.2 + best.hsl.s) ? bucket : best,
        null
      ) ?? null;

  const tertiary =
    pool
      .filter(
        (bucket) =>
          hueDistance(bucket.hsl.h, primary.hsl.h) >= HUE_GAP &&
          (!secondary || hueDistance(bucket.hsl.h, secondary.hsl.h) >= HUE_GAP)
      )
      .reduce<Bucket | null>((best, bucket) => (!best || bucket.count > best.count ? bucket : best), null) ??
    null;

  // Synthesize harmonious accents (offsets mirror createGeneratedArtworkPalette)
  // when the cover is essentially one colour, keeping the primary's saturation so
  // muted art yields muted accents and vivid art vivid ones.
  const secondaryHsl = secondary?.hsl ?? { h: primary.hsl.h + 44, s: primary.hsl.s, l: primary.hsl.l + 0.12 };
  const tertiaryHsl = tertiary?.hsl ?? { h: primary.hsl.h + 198, s: primary.hsl.s, l: primary.hsl.l - 0.1 };

  const angle = 18 + (Math.round(((primary.hsl.h % 360) + 360) % 360) % 128);

  return {
    primary: formatHsl(primary.hsl, PRIMARY_S, PRIMARY_L),
    secondary: formatHsl(secondaryHsl, SECONDARY_S, SECONDARY_L),
    tertiary: formatHsl(tertiaryHsl, TERTIARY_S, TERTIARY_L),
    angle: `${angle}deg`
  };
};

// Force every cover through the same-origin /image proxy (even https) so the
// canvas read is CORS-clean — unlike getProxiedAssetUrl which passes https raw.
const buildExtractionUrl = (rawUrl: string): string => {
  const proxyBase = (getApiBase() || '/api').replace(/\/+$/, '');
  return `${proxyBase}/image?url=${encodeURIComponent(rawUrl)}`;
};

// A hung /image fetch can fire NEITHER onload nor onerror, leaving the cached
// task promise unsettled forever — it's never evicted, so that station is pinned
// on the generated fallback for the page lifetime. Race the load against a
// timeout that rejects (→ caught → null → evicted → retryable next time).
const LOAD_TIMEOUT_MS = 7000;

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') {
      reject(new Error('Image unavailable'));
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      timer = null;
      // Abort the hung fetch so it can't keep the connection (and this promise)
      // alive; the existing catch→null + cache eviction then restores retry.
      try {
        img.src = '';
      } catch {
        // ignore environments that reject an empty src
      }
      reject(new Error('artwork load timeout'));
    }, LOAD_TIMEOUT_MS);
    const clearTimer = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    img.onload = () => {
      clearTimer();
      resolve(img);
    };
    img.onerror = () => {
      clearTimer();
      reject(new Error('artwork load failed'));
    };
    img.src = url;
  });

const sampleImageData = (img: HTMLImageElement): { data: Uint8ClampedArray } | null => {
  if (typeof document === 'undefined') return null;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return null;
  const scale = Math.min(1, MAX_SAMPLE / Math.max(w, h));
  const sw = Math.max(1, Math.round(w * scale));
  const sh = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(img, 0, 0, sw, sh);
    return ctx.getImageData(0, 0, sw, sh);
  } catch {
    // Tainted canvas (shouldn't happen via the proxy) or a decode hiccup.
    return null;
  }
};

// Cache resolved palettes per URL. Failures resolve null and are evicted so a
// later attempt can retry; in-flight calls share one promise (dedupe).
const cache = new Map<string, Promise<ExtractedPalette | null>>();

export const extractArtworkPalette = (rawUrl?: string | null): Promise<ExtractedPalette | null> => {
  const url = String(rawUrl || '').trim();
  if (!url) return Promise.resolve(null);
  const cached = cache.get(url);
  if (cached) return cached;

  const task = (async (): Promise<ExtractedPalette | null> => {
    try {
      const img = await loadImage(buildExtractionUrl(url));
      const data = sampleImageData(img);
      return data ? analyzeImageData(data) : null;
    } catch {
      return null;
    }
  })();

  cache.set(url, task);
  task.then(
    (result) => {
      if (!result) cache.delete(url);
    },
    () => cache.delete(url)
  );
  return task;
};

// Test seam — drop the module cache between cases.
export const __clearArtworkPaletteCache = () => {
  cache.clear();
};
