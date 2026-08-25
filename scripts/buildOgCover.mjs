// Draws the link-preview image once, into apps/webapp/public/og-cover.png.
//
// Run by hand when the wording or the look changes:
//   node scripts/buildOgCover.mjs
//
// Why a committed PNG rather than a route: a crawler fetching the preview must
// not depend on our API being up, and Telegram/Google cache the image for a long
// time anyway. Static also means it costs nothing at runtime.
//
// It carries NO numbers. The catalogue size is true and checkable, but baked into
// a PNG it goes stale the first time the catalogue moves, and this project does
// not ship numbers it cannot keep honest.
//
// Uses the same satori + resvg pair as the story cards, and their Noto fonts —
// which is why Cyrillic renders at all.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const ROOT = new URL('../', import.meta.url);
const FONT_DIR = new URL('apps/api/assets/fonts/', ROOT);
const OUT = new URL('apps/webapp/public/og-cover.png', ROOT);

const WIDTH = 1200;
const HEIGHT = 630;

const fonts = [
  { file: 'noto-sans-cyrillic-700.woff', name: 'Noto Sans Cyrillic', weight: 700 },
  { file: 'noto-sans-cyrillic-400.woff', name: 'Noto Sans Cyrillic', weight: 400 },
  { file: 'noto-sans-latin-700.woff', name: 'Noto Sans', weight: 700 },
  { file: 'noto-sans-latin-400.woff', name: 'Noto Sans', weight: 400 }
];

const loadFonts = async () =>
  Promise.all(
    fonts.map(async ({ file, name, weight }) => ({
      name,
      weight,
      style: 'normal',
      data: await readFile(new URL(file, FONT_DIR))
    }))
  );

// Concentric rings around a point — the isoline motif, drawn with plain divs
// because satori has no SVG primitives. Cheap, and it reads as a signal
// spreading from a place rather than as decoration.
const ring = (size, opacity) => ({
  type: 'div',
  props: {
    style: {
      position: 'absolute',
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: '50%',
      border: `1px solid rgba(120, 214, 255, ${opacity})`
    }
  }
});

const card = {
  type: 'div',
  props: {
    style: {
      width: `${WIDTH}px`,
      height: `${HEIGHT}px`,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      padding: '0 96px',
      backgroundColor: '#08111c',
      backgroundImage:
        'radial-gradient(900px 600px at 78% 28%, rgba(58, 176, 148, 0.30), rgba(8, 17, 28, 0) 62%)',
      fontFamily: 'Noto Sans Cyrillic, Noto Sans'
    },
    children: [
      {
        type: 'div',
        props: {
          style: {
            position: 'absolute',
            top: '84px',
            right: '96px',
            width: '460px',
            height: '460px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          },
          children: [
            ring(460, 0.1),
            ring(340, 0.14),
            ring(230, 0.18),
            ring(130, 0.24),
            {
              type: 'div',
              props: {
                style: {
                  position: 'absolute',
                  width: '14px',
                  height: '14px',
                  borderRadius: '50%',
                  backgroundColor: '#ff6b5e'
                }
              }
            }
          ]
        }
      },
      {
        type: 'div',
        props: {
          style: {
            fontSize: '86px',
            fontWeight: 700,
            color: '#f2f7fb',
            letterSpacing: '-0.02em'
          },
          children: 'RadioAtlas'
        }
      },
      {
        type: 'div',
        props: {
          style: {
            marginTop: '20px',
            fontSize: '38px',
            fontWeight: 400,
            color: 'rgba(226, 240, 250, 0.78)',
            lineHeight: 1.3
          },
          children: 'Живое радио мира. Где-то прямо сейчас идёт эфир.'
        }
      },
      {
        type: 'div',
        props: {
          style: {
            marginTop: '44px',
            fontSize: '26px',
            fontWeight: 400,
            color: 'rgba(140, 210, 255, 0.85)',
            letterSpacing: '0.06em'
          },
          children: 'radioatlas.ru'
        }
      }
    ]
  }
};

const svg = await satori(card, { width: WIDTH, height: HEIGHT, fonts: await loadFonts() });
const png = new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng();
await mkdir(new URL('./', OUT), { recursive: true });
await writeFile(OUT, png);
console.log(`og-cover.png: ${png.length} B  ${WIDTH}x${HEIGHT}  ->  ${fileURLToPath(OUT)}`);
