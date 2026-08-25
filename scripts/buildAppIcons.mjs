// Renders the installable-app icons from the existing favicon mark.
//
//   node scripts/buildAppIcons.mjs
//
// The mark is not invented here: it is the dial already in public/favicon.svg —
// dark square, tuning ring, lit centre. Icons are generated rather than drawn by
// hand so they cannot drift away from the favicon the browser tab shows.
//
// Three files, because they answer three different questions:
//   192 / 512 "any"  — what a launcher shows, keeping the rounded square
//   512 "maskable"   — Android crops icons to its own shape (circle, squircle,
//                      teardrop). A maskable icon must be full-bleed with the
//                      mark inside the safe zone, or the corners get shaved off
//                      the artwork. So this one drops the rounded rect, fills the
//                      whole canvas, and scales the dial to 60%.
import { readFile, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';

const PUBLIC = new URL('../apps/webapp/public/', import.meta.url);

const source = await readFile(new URL('favicon.svg', PUBLIC), 'utf8');

// The dial itself, lifted from favicon.svg so the two cannot diverge silently.
const DIAL = `
  <circle cx="32" cy="32" r="20" fill="none" stroke="#f6c945" stroke-width="4" />
  <circle cx="32" cy="32" r="4" fill="#9eff8d" />
  <path
    d="M18 32c0-7.7 6.3-14 14-14M46 32c0 7.7-6.3 14-14 14"
    fill="none"
    stroke="#9eff8d"
    stroke-linecap="round"
    stroke-width="4"
  />`;

// Full-bleed ground + the dial at 60%, centred: 20% clear on every side, which
// is the safe zone Android's maskable spec asks for.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#091423" />
  <g transform="translate(12.8 12.8) scale(0.6)">${DIAL}</g>
</svg>`;

const render = (svg, size) =>
  new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

const outputs = [
  ['icon-192.png', source, 192],
  ['icon-512.png', source, 512],
  ['icon-maskable-512.png', maskable, 512]
];

for (const [name, svg, size] of outputs) {
  const png = render(svg, size);
  await writeFile(new URL(name, PUBLIC), png);
  console.log(`${name.padEnd(24)} ${size}x${size}  ${png.length} B`);
}
