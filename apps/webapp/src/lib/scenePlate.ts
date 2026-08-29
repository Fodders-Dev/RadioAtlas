// The colour a flat control should be when it can no longer afford to blur.
//
// A backdrop-filter IS a local average of what is behind the element, so the
// honest replacement for one is the average of that same region — not an
// invented fill. That is what keeps the play control on a station tile tinted
// by its own artwork after the `lite` glass tier takes the blur away.
//
// It is affordable only because the scenes are served from our own origin
// (/api/artwork/scenes/...), so the canvas is not tainted and the colour is read
// from the <img> the tile has already decoded: no second fetch, no CORS dance,
// and — the whole point — no render pass.

export type Rgb = { r: number; g: number; b: number };

type Box = { width: number; height: number };
type Rect = { x: number; y: number; width: number; height: number };
export type SourceRect = { sx: number; sy: number; sw: number; sh: number };

/**
 * Map a rectangle in an `object-fit: cover` element's own coordinates onto the
 * source image's pixels.
 *
 * Kept pure and exported so the arithmetic is unit-tested rather than eyeballed
 * through a screenshot — the first draft of this sampled the wrong region and
 * the only symptom was a plate that looked "a bit dark", which is exactly the
 * kind of wrongness this repo keeps paying for.
 *
 * Assumes the default `object-position: 50% 50%`, which is what the scene image
 * uses; a caller that changes that must revisit this.
 */
export const coverSourceRect = (
  element: Box,
  natural: Box,
  target: Rect
): SourceRect | null => {
  if (
    element.width <= 0 ||
    element.height <= 0 ||
    natural.width <= 0 ||
    natural.height <= 0 ||
    target.width <= 0 ||
    target.height <= 0
  ) {
    return null;
  }

  const scale = Math.max(element.width / natural.width, element.height / natural.height);
  const drawnWidth = natural.width * scale;
  const drawnHeight = natural.height * scale;
  // Negative when the drawn image overflows the box, which is the normal case
  // for cover — the overflow is split evenly on both sides.
  const offsetX = (element.width - drawnWidth) / 2;
  const offsetY = (element.height - drawnHeight) / 2;

  const sx = (target.x - offsetX) / scale;
  const sy = (target.y - offsetY) / scale;
  const sw = target.width / scale;
  const sh = target.height / scale;

  // Clamp into the image. A control that sits partly outside the picture still
  // gets a colour, taken from the part that overlaps.
  const clampedX = Math.min(Math.max(sx, 0), Math.max(natural.width - 1, 0));
  const clampedY = Math.min(Math.max(sy, 0), Math.max(natural.height - 1, 0));
  const clampedW = Math.min(Math.max(sw, 1), natural.width - clampedX);
  const clampedH = Math.min(Math.max(sh, 1), natural.height - clampedY);

  if (clampedW <= 0 || clampedH <= 0) return null;
  return { sx: clampedX, sy: clampedY, sw: clampedW, sh: clampedH };
};

const toHsl = ({ r, g, b }: Rgb) => {
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
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
};

// Legibility bands. The control carries a white glyph, so a plate taken straight
// from a sunlit scene would be a white arrow on a pale coin. Hue is kept — that
// is the part the listener recognises as "this station's picture" — while
// lightness is pulled into a range that always holds the glyph, and saturation
// is floored so a grey scene still reads as a tinted plate rather than a smudge.
//
// Same shape of clamp as artworkColor.ts uses for the player backdrop, for the
// same reason and deliberately in the same style.
const LIGHTNESS = { min: 0.15, max: 0.42 };
const SATURATION = { min: 0.18, max: 0.62 };
const PLATE_ALPHA = 0.82;

export const toPlateColor = (rgb: Rgb): string => {
  const { h, s, l } = toHsl(rgb);
  const clampedL = Math.min(Math.max(l, LIGHTNESS.min), LIGHTNESS.max);
  const clampedS = Math.min(Math.max(s, SATURATION.min), SATURATION.max);
  return `hsla(${Math.round(h)}, ${Math.round(clampedS * 100)}%, ${Math.round(clampedL * 100)}%, ${PLATE_ALPHA})`;
};

const SAMPLE_EDGE = 8;
let sharedCanvas: HTMLCanvasElement | null = null;

const canvasContext = () => {
  if (typeof document === 'undefined') return null;
  if (!sharedCanvas) {
    sharedCanvas = document.createElement('canvas');
    sharedCanvas.width = SAMPLE_EDGE;
    sharedCanvas.height = SAMPLE_EDGE;
  }
  return sharedCanvas.getContext('2d', { willReadFrequently: true });
};

export const averageRgb = (data: Uint8ClampedArray): Rgb | null => {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let index = 0; index < data.length; index += 4) {
    // Fully transparent pixels carry no colour; counting them drags every
    // average toward black.
    if (data[index + 3] === 0) continue;
    r += data[index];
    g += data[index + 1];
    b += data[index + 2];
    count += 1;
  }
  if (!count) return null;
  return { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) };
};

const cache = new Map<string, string>();

/**
 * Read the plate colour for `target` (in the image element's own coordinates).
 * Never throws: any failure returns null and the caller keeps the neutral fill.
 */
export const readScenePlate = (
  image: HTMLImageElement,
  target: Rect
): string | null => {
  if (!image.complete || !image.naturalWidth || !image.naturalHeight) return null;

  const source = coverSourceRect(
    { width: image.clientWidth, height: image.clientHeight },
    { width: image.naturalWidth, height: image.naturalHeight },
    target
  );
  if (!source) return null;

  // Rounded so a one-pixel scroll difference reuses the entry instead of
  // re-rasterising; the control does not move within its tile.
  const key = `${image.currentSrc || image.src}|${Math.round(source.sx)},${Math.round(source.sy)},${Math.round(source.sw)},${Math.round(source.sh)}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const context = canvasContext();
  if (!context) return null;

  try {
    context.clearRect(0, 0, SAMPLE_EDGE, SAMPLE_EDGE);
    context.drawImage(
      image,
      source.sx,
      source.sy,
      source.sw,
      source.sh,
      0,
      0,
      SAMPLE_EDGE,
      SAMPLE_EDGE
    );
    const average = averageRgb(context.getImageData(0, 0, SAMPLE_EDGE, SAMPLE_EDGE).data);
    if (!average) return null;
    const plate = toPlateColor(average);
    cache.set(key, plate);
    return plate;
  } catch {
    // A tainted canvas (a scene served from somewhere else one day) or a decode
    // that is not really finished. Neither is worth a console line: the neutral
    // plate is a complete answer.
    return null;
  }
};

export const clearScenePlateCache = () => cache.clear();

/**
 * Tint a tile's flat controls with the piece of scene they sit on.
 *
 * Writes a CSS custom property straight onto the DOM node instead of going
 * through React state, and that is deliberate: Home mounts dozens of tiles, and
 * re-rendering all of them to deliver a colour would spend more than the blur
 * this tier exists to remove. Custom properties inherit, so one write on the
 * tile reaches every control inside it.
 *
 * A no-op unless the `lite` tier is active — a device that can afford the real
 * frost should not pay for a canvas read it will never look at.
 */
export const paintTilePlate = (tile: HTMLElement | null, image: HTMLImageElement) => {
  if (!tile || typeof document === 'undefined') return;
  if (document.documentElement.dataset.glass !== 'lite') return;

  const control = tile.querySelector('.home-action-btn');
  if (!control) return;

  const imageRect = image.getBoundingClientRect();
  const controlRect = control.getBoundingClientRect();
  if (!imageRect.width || !controlRect.width) return;

  const plate = readScenePlate(image, {
    x: controlRect.left - imageRect.left,
    y: controlRect.top - imageRect.top,
    width: controlRect.width,
    height: controlRect.height
  });
  if (plate) tile.style.setProperty('--station-plate', plate);
};
