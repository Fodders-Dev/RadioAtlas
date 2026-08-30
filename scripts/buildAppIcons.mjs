// Renders every app icon from ONE source artwork.
//
//   node scripts/buildAppIcons.mjs
//
// The source is `assets/brand/app-icon-source.png` — the mark the Telegram bot
// already wears, so the app and the bot are recognisably the same product.
// Icons are generated rather than exported by hand so they cannot drift apart,
// which is the same reason the previous set was generated from a vector dial.
//
// Four files, because they answer four different questions:
//
//   192 / 512 "any"  — what a launcher and an install prompt show. Full bleed;
//                      the host rounds the corners itself.
//   512 "maskable"   — Android crops icons to ITS shape (circle, squircle,
//                      teardrop) and only guarantees the centre 80%. A
//                      full-bleed illustration loses its edges there — on this
//                      artwork, the top of the head and the outer ring of the
//                      waveform. So the maskable one is inset to that safe zone
//                      on a ground sampled from the artwork's own corners, and
//                      the crop takes padding instead of picture.
//   favicon 48       — a browser tab, a bookmark, the Search Console list. At
//                      that size a detailed illustration is a smudge, so this
//                      one is a CROP of the head and halo rather than the whole
//                      square. Same artwork, the part of it that survives.
//
// resvg is the only renderer here and it already ships for the OG cover, so the
// artwork is composed into SVG and rasterised. No new dependency, and the
// composition stays readable as markup rather than as pixel arithmetic.
import { readFile, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';

const ROOT = new URL('../', import.meta.url);
const PUBLIC = new URL('apps/webapp/public/', ROOT);
const SOURCE = new URL('assets/brand/app-icon-source.png', ROOT);

const artwork = await readFile(SOURCE);
const href = `data:image/png;base64,${artwork.toString('base64')}`;

const render = (svg, size) =>
  new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

/** Full bleed: the whole square, edge to edge. */
const full = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512">
  <image xlink:href="${href}" x="0" y="0" width="512" height="512" preserveAspectRatio="xMidYMid slice" />
</svg>`;

/**
 * Maskable is the SAME full-bleed image, and that is a measured decision rather
 * than a shortcut.
 *
 * The obvious move is to inset the artwork to the 80% safe zone on a matching
 * ground. That was built first and looked wrong: the inset square's edge is
 * visible as a rectangle inside the circle, because the artwork's border is a
 * gradient that differs on every side and no single flat colour continues it.
 *
 * Rendered both under a real circle mask and compared: this composition already
 * keeps the figure and its halo well inside the centre circle, so the crop eats
 * only corner gradient. Full bleed loses nothing and has no seam.
 *
 * ⚠ That holds for THIS artwork, not for maskable icons in general. Replace the
 * source with something that fills its own corners and this has to be looked at
 * again — under an actual circle mask, not by reasoning about the spec.
 *
 * So there is no separate maskable FILE: the manifest declares the 512 as
 * `purpose: "any maskable"`. Two identical half-megabyte PNGs would have been a
 * megabyte of the same pixels, described twice.

/**
 * Favicon: a crop of the upper middle, where the head and the halo are, scaled
 * to fill. At 48px the full composition is an orange blur; the head against the
 * ring still reads as a shape.
 *
 * The numbers are a viewBox into the 512-space image: start 22% in from the
 * left and 6% down, take 56% of the width. Chosen by looking at the rendered
 * result at 32px, not by measuring the artwork.
 */
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="112 31 288 288">
  <image xlink:href="${href}" x="0" y="0" width="512" height="512" preserveAspectRatio="xMidYMid slice" />
</svg>`;

const outputs = [
  ['icon-192.png', full, 192],
  ['icon-512.png', full, 512],
  ['favicon.png', favicon, 48]
];

for (const [name, svg, size] of outputs) {
  const png = render(svg, size);
  await writeFile(new URL(name, PUBLIC), png);
  console.log(`buildAppIcons: ${name} ${size}x${size} ${(png.length / 1024).toFixed(1)} KB`);
}
