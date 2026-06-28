import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __artworkPaletteCacheSize,
  __clearArtworkPaletteCache,
  analyzeImageData,
  extractArtworkPalette,
  rgbToHsl
} from './artworkColor';

const HSL = /^hsl\(\d+ \d+% \d+%\)$/;

// Build a synthetic RGBA image: `fill(x, y)` returns the [r,g,b,a] for a pixel.
const makeImage = (
  width: number,
  height: number,
  fill: (index: number) => [number, number, number, number]
) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const [r, g, b, a] = fill(i);
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { data, width, height };
};

const solid = (w: number, h: number, rgba: [number, number, number, number]) =>
  makeImage(w, h, () => rgba);

describe('rgbToHsl', () => {
  it('maps the primaries to the right hues', () => {
    expect(Math.round(rgbToHsl(255, 0, 0).h)).toBe(0);
    expect(Math.round(rgbToHsl(0, 255, 0).h)).toBe(120);
    expect(Math.round(rgbToHsl(0, 0, 255).h)).toBe(240);
    expect(rgbToHsl(128, 128, 128).s).toBe(0); // gray has no saturation
  });
});

describe('analyzeImageData', () => {
  it('extracts a clamped palette from a solid cover', () => {
    const palette = analyzeImageData(solid(8, 8, [200, 30, 30, 255]));
    expect(palette).not.toBeNull();
    expect(palette!.primary).toMatch(HSL);
    expect(palette!.secondary).toMatch(HSL);
    expect(palette!.tertiary).toMatch(HSL);
    expect(palette!.angle).toMatch(/^\d+deg$/);
    // Red dominant, clamped into the readable band (S 30–82, L 40–60).
    expect(palette!.primary).toBe('hsl(0 74% 45%)');
  });

  it('lifts a muddy/dark cover into a visible range (HSL clamp)', () => {
    // Near-black blue: L ~6% would be an invisible gradient without the clamp.
    const palette = analyzeImageData(solid(8, 8, [4, 6, 30, 255]));
    expect(palette).not.toBeNull();
    const lightness = Number(palette!.primary.match(/(\d+)%\)$/)![1]);
    expect(lightness).toBeGreaterThanOrEqual(40); // clamped up from near-black
  });

  it('picks a distinct accent when the cover has two colours', () => {
    // First half red, second half blue.
    const img = makeImage(4, 4, (i) => (i < 8 ? [200, 30, 30, 255] : [30, 30, 200, 255]));
    const palette = analyzeImageData(img);
    expect(palette!.primary).toBe('hsl(0 74% 45%)'); // red wins the tie (first)
    expect(palette!.secondary).toContain('240 '); // blue accent, far in hue
  });

  it('returns null for a fully transparent image', () => {
    expect(analyzeImageData(solid(8, 8, [255, 0, 0, 0]))).toBeNull();
  });

  it('returns null for empty data', () => {
    expect(analyzeImageData({ data: new Uint8ClampedArray(0) })).toBeNull();
  });
});

describe('extractArtworkPalette (load + cache)', () => {
  let imageCtorCount = 0;
  let mockPixels: { data: Uint8ClampedArray; width: number; height: number };
  let realImage: typeof globalThis.Image;
  // 'hang' = never fire onload/onerror (simulates a stuck /image fetch).
  let loadBehavior: 'auto' | 'hang' = 'auto';

  class FakeImage {
    crossOrigin = '';
    decoding = '';
    naturalWidth = 4;
    naturalHeight = 4;
    width = 4;
    height = 4;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    #src = '';

    constructor() {
      imageCtorCount += 1;
    }

    set src(value: string) {
      this.#src = value;
      if (loadBehavior === 'hang') return; // never settles → timeout must fire
      // The proxied url embeds the raw url; a 'fail' cover rejects.
      queueMicrotask(() => {
        if (/fail/.test(value)) this.onerror?.();
        else this.onload?.();
      });
    }

    get src() {
      return this.#src;
    }
  }

  beforeEach(() => {
    __clearArtworkPaletteCache();
    imageCtorCount = 0;
    loadBehavior = 'auto';
    mockPixels = solid(4, 4, [200, 30, 30, 255]);
    realImage = globalThis.Image;
    (globalThis as { Image: unknown }).Image = FakeImage;

    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage: () => {},
            getImageData: () => mockPixels
          })
        } as unknown as HTMLCanvasElement;
      }
      return realCreate(tag);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    (globalThis as { Image: unknown }).Image = realImage;
  });

  it('resolves a palette and caches it by URL (one Image construction)', async () => {
    const first = await extractArtworkPalette('http://cdn/a.png');
    const second = await extractArtworkPalette('http://cdn/a.png');
    expect(first).not.toBeNull();
    expect(first!.primary).toBe('hsl(0 74% 45%)');
    expect(second).toBe(first); // identical cached object
    expect(imageCtorCount).toBe(1); // second call hit the cache, no reload
  });

  it('returns null on a transparent read and does NOT cache it (retryable)', async () => {
    mockPixels = solid(4, 4, [0, 0, 0, 0]);
    const first = await extractArtworkPalette('http://cdn/blank.png');
    expect(first).toBeNull();
    const before = imageCtorCount;
    await extractArtworkPalette('http://cdn/blank.png');
    expect(imageCtorCount).toBe(before + 1); // failure was evicted → reloaded
  });

  it('returns null when the image fails to load', async () => {
    expect(await extractArtworkPalette('http://cdn/fail.png')).toBeNull();
  });

  it('resolves null for an empty url without touching the loader', async () => {
    expect(await extractArtworkPalette('')).toBeNull();
    expect(imageCtorCount).toBe(0);
  });

  it('times out a hung load → null and evicts (retryable, not pinned forever)', async () => {
    vi.useFakeTimers();
    loadBehavior = 'hang'; // onload/onerror never fire — only the timer can settle it
    const pending = extractArtworkPalette('http://cdn/hang.png');
    expect(imageCtorCount).toBe(1);

    // Nothing has settled it yet; advancing past the load timeout rejects it,
    // which the loader catches → null.
    await vi.advanceTimersByTimeAsync(7000);
    expect(await pending).toBeNull();

    // The failed entry was evicted, so a later call reconstructs (not pinned).
    const before = imageCtorCount;
    void extractArtworkPalette('http://cdn/hang.png');
    expect(imageCtorCount).toBe(before + 1);
  });

  it('caps the cache at the LRU limit as the feed scrolls many stations', async () => {
    // 65 distinct successful covers — the bounded cache must evict the oldest so
    // a long feed scroll can't grow it without limit.
    for (let i = 0; i < 65; i += 1) {
      await extractArtworkPalette(`http://cdn/feed-${i}.png`);
    }
    expect(__artworkPaletteCacheSize()).toBeLessThanOrEqual(60);
    // The most-recently-loaded cover is still cached (it was not the evicted one).
    expect(await extractArtworkPalette('http://cdn/feed-64.png')).not.toBeNull();
  });
});
