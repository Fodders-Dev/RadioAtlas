// T_share_3 (PR-A): render a 1080×1920 on-brand "share to Story" card for a
// station. Server-side because shareToStory needs a public https image URL.
//
// Isolation (native-dep blast radius): satori + @resvg/resvg-js (a native
// binary) are LAZY-imported inside try/catch. If the binary fails to resolve on
// a platform, renderStoryCard throws StoryRenderUnavailable and the route serves
// the static fallback PNG — boot and every other route (catalog/streams/summary)
// are untouched because these modules are never imported at top level.
//
// Fonts: Noto Sans (Latin/Cyrillic/Greek) woffs bundled under assets/fonts. A
// name with glyphs outside that coverage is OMITTED (coverage check) rather than
// rendered as tofu — the card still shows artwork + genre/country + brand.
//
// Artwork: fetched via the existing SSRF-pinned path (media/shared), https-only,
// size-capped; any miss/http/timeout/non-raster/decode-fail → brand gradient.

import { readFile } from 'node:fs/promises';
import { fetchWithTimeout, parseAndValidateHttpUrl } from '../media/shared.js';

export class StoryRenderUnavailable extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'StoryRenderUnavailable';
  }
}

export type StoryCardStation = {
  stationuuid: string;
  name: string;
  favicon?: string | null;
  country?: string | null;
  tags?: string | null;
};

export type StoryCardDeps = {
  assetsDir: URL;
  userAgent: string;
  artworkTimeoutMs?: number;
  artworkMaxBytes?: number;
  // Injectable for tests: SSRF-safe artwork fetch → a satori-safe raster or null.
  fetchArtwork?: (faviconUrl: string | null | undefined) => Promise<ArtworkImage | null>;
};

type ArtworkImage = { dataUri: string };

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1920;
const ARTWORK_MAX_BYTES_DEFAULT = 512 * 1024;
const ARTWORK_TIMEOUT_MS_DEFAULT = 4000;
// satori decodes png/jpeg reliably; skip svg/avif/webp to avoid a decode throw.
const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg']);

// A name is renderable iff every character is Latin / Cyrillic / Greek, or
// script-Common/Inherited (digits, punctuation, spaces, combining marks). Names
// in other scripts (CJK, Arabic, …) are omitted rather than drawn as tofu.
const COVERED_NAME =
  /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Common}\p{Script=Inherited}]*$/u;

export const isNameRenderable = (name: string | null | undefined): boolean => {
  const trimmed = (name || '').trim();
  return trimmed.length > 0 && COVERED_NAME.test(trimmed);
};

const firstTag = (tags?: string | null) =>
  (tags || '')
    .split(',')
    .map((tag) => tag.trim())
    .find((tag) => tag && tag.toLowerCase() !== 'no tags') || '';

// ---- lazy, isolated engine + font load ----------------------------------
type Engine = {
  satori: typeof import('satori').default;
  Resvg: typeof import('@resvg/resvg-js').Resvg;
};
let enginePromise: Promise<Engine> | null = null;
const loadEngine = async (): Promise<Engine> => {
  enginePromise ??= (async () => {
    try {
      const [satoriMod, resvgMod] = await Promise.all([
        import('satori'),
        import('@resvg/resvg-js')
      ]);
      return { satori: satoriMod.default, Resvg: resvgMod.Resvg };
    } catch (error) {
      enginePromise = null; // allow a later retry (e.g. transient FS)
      throw new StoryRenderUnavailable('story render engine unavailable', error);
    }
  })();
  return enginePromise;
};

type FontSpec = { name: string; data: Buffer; weight: 400 | 700; style: 'normal' };
// The three Noto subsets are registered under DISTINCT family names. satori does
// per-glyph fallback across the comma-separated CARD_FONT_FAMILY list — but only
// across DIFFERENT family names; registering all subsets as one "Noto Sans" made
// satori pick a single subset (latin) and render Cyrillic/Greek as tofu. With
// distinct names + the fallback list, a Cyrillic glyph missing from the latin
// font is taken from "Noto Sans Cyrillic", etc.
export const CARD_FONT_FAMILY = 'Noto Sans, Noto Sans Cyrillic, Noto Sans Greek';
let fontsPromise: Promise<FontSpec[]> | null = null;
const loadFonts = async (assetsDir: URL): Promise<FontSpec[]> => {
  fontsPromise ??= (async () => {
    const read = async (file: string) => readFile(new URL(`fonts/${file}`, assetsDir));
    const specs: Array<[string, 400 | 700, string]> = [
      ['noto-sans-latin-400.woff', 400, 'Noto Sans'],
      ['noto-sans-latin-700.woff', 700, 'Noto Sans'],
      ['noto-sans-cyrillic-400.woff', 400, 'Noto Sans Cyrillic'],
      ['noto-sans-cyrillic-700.woff', 700, 'Noto Sans Cyrillic'],
      ['noto-sans-greek-400.woff', 400, 'Noto Sans Greek'],
      ['noto-sans-greek-700.woff', 700, 'Noto Sans Greek']
    ];
    try {
      return await Promise.all(
        specs.map(async ([file, weight, name]): Promise<FontSpec> => ({
          name,
          data: await read(file),
          weight,
          style: 'normal'
        }))
      );
    } catch (error) {
      fontsPromise = null;
      throw new StoryRenderUnavailable('story card fonts unavailable', error);
    }
  })();
  return fontsPromise;
};

// ---- SSRF-safe artwork fetch (default impl, exported for tests) ----------
export const fetchStationArtwork = async (
  faviconUrl: string | null | undefined,
  deps: StoryCardDeps
): Promise<ArtworkImage | null> => {
  const url = (faviconUrl || '').trim();
  // https-only: an http favicon on the public card → brand gradient instead.
  if (!/^https:\/\//i.test(url)) return null;
  const parsed = await parseAndValidateHttpUrl(url); // DNS-pin + private-IP block
  if ('error' in parsed) return null;
  const maxBytes = deps.artworkMaxBytes ?? ARTWORK_MAX_BYTES_DEFAULT;
  try {
    const response = await fetchWithTimeout(
      parsed.target.toString(),
      { headers: { 'User-Agent': deps.userAgent, Accept: 'image/png,image/jpeg,image/*;q=0.8' } },
      deps.artworkTimeoutMs ?? ARTWORK_TIMEOUT_MS_DEFAULT
    );
    if (!response.ok) return null;
    const contentType = ((response.headers.get('content-type') || '').split(';')[0] ?? '')
      .trim()
      .toLowerCase();
    if (!RASTER_TYPES.has(contentType)) return null;
    const declared = Number(response.headers.get('content-length') || '0');
    if (declared && declared > maxBytes) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > maxBytes) return null;
    const mime = contentType === 'image/jpg' ? 'image/jpeg' : contentType;
    return { dataUri: `data:${mime};base64,${buffer.toString('base64')}` };
  } catch {
    return null;
  }
};

// ---- card layout (satori element tree, no JSX) --------------------------
const buildCardElement = (
  station: StoryCardStation | null,
  artwork: ArtworkImage | null
) => {
  const name = station && isNameRenderable(station.name) ? station.name.trim() : '';
  const genre = firstTag(station?.tags);
  const country = (station?.country || '').trim();
  const subtitle = [genre, country].filter(Boolean).join(' · ');

  // A play triangle as inline SVG — NOT a glyph and NOT a CSS-border triangle.
  // The bundled Noto Sans subsets are LANGUAGE subsets (letters only) with no
  // Geometric-Shapes (▶) / emoji, and satori renders the width:0 border-triangle
  // trick as a square — so both produce tofu/boxes. satori does render inline
  // SVG paths, which are font-independent and always correct.
  const playTriangle = (size: number, color: string) => ({
    type: 'svg',
    props: {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      children: { type: 'path', props: { d: 'M8 5v14l11-7z', fill: color } }
    }
  });

  const artworkNode = artwork
    ? {
        type: 'img',
        props: {
          src: artwork.dataUri,
          width: 520,
          height: 520,
          style: { borderRadius: 48, objectFit: 'cover' }
        }
      }
    : {
        type: 'div',
        props: {
          style: {
            width: 520,
            height: 520,
            borderRadius: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg,#7ad7f0,#9b6bff)'
          },
          children: playTriangle(120, 'rgba(9,14,24,0.82)')
        }
      };

  const children: unknown[] = [artworkNode];
  if (name) {
    children.push({
      type: 'div',
      props: {
        style: {
          marginTop: 80,
          fontSize: 76,
          fontWeight: 700,
          textAlign: 'center',
          lineHeight: 1.1,
          maxWidth: 900,
          // satori clamps overflow; keep names to ~2 lines visually.
          display: 'flex'
        },
        children: name
      }
    });
  }
  if (subtitle) {
    children.push({
      type: 'div',
      props: {
        style: { marginTop: 28, fontSize: 42, color: 'rgba(220,235,255,0.72)' },
        children: subtitle
      }
    });
  }
  children.push({
    type: 'div',
    props: {
      style: {
        marginTop: name || subtitle ? 110 : 80,
        fontSize: 44,
        fontWeight: 700,
        color: '#bdecff',
        display: 'flex',
        alignItems: 'center',
        gap: 20
      },
      children: [playTriangle(26, '#bdecff'), { type: 'div', props: { children: 'Listen on RadioAtlas' } }]
    }
  });

  return {
    type: 'div',
    props: {
      style: {
        width: `${CARD_WIDTH}px`,
        height: `${CARD_HEIGHT}px`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 80,
        background:
          'radial-gradient(circle at 30% 20%, rgba(123,215,240,0.18), transparent 45%), linear-gradient(160deg,#16202c,#090a0f)',
        color: '#ffffff',
        fontFamily: CARD_FONT_FAMILY
      },
      children
    }
  };
};

export const renderStoryCard = async (
  station: StoryCardStation | null,
  deps: StoryCardDeps
): Promise<Buffer> => {
  const fetchArtwork = deps.fetchArtwork ?? ((url: string | null | undefined) => fetchStationArtwork(url, deps));
  const artwork = station ? await fetchArtwork(station.favicon) : null;

  // Engine + fonts are lazy + isolated; a load failure throws
  // StoryRenderUnavailable → the route serves the static fallback PNG.
  const [{ satori, Resvg }, fonts] = await Promise.all([loadEngine(), loadFonts(deps.assetsDir)]);

  let svg: string;
  try {
    svg = await satori(buildCardElement(station, artwork) as never, {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      fonts
    });
  } catch (error) {
    // A satori layout/decode failure (e.g. a bad raster that slipped the type
    // gate): retry once WITHOUT artwork before giving up to the static fallback.
    if (artwork) {
      svg = await satori(buildCardElement(station, null) as never, {
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        fonts
      });
    } else {
      throw new StoryRenderUnavailable('satori layout failed', error);
    }
  }

  try {
    return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: CARD_WIDTH } }).render().asPng());
  } catch (error) {
    throw new StoryRenderUnavailable('resvg rasterize failed', error);
  }
};
