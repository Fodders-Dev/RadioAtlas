/**
 * Prerenders one search-engine-readable page per station, plus a sitemap and a
 * robots.txt, into the built webapp.
 *
 *   tsx scripts/buildStationPages.mts        (runs automatically after vite build)
 *
 * WHY THIS EXISTS. Until now a crawler fetching radioatlas.ru got
 * `<div id="root"></div>` and nothing else — not one station name, not one word
 * of content. The app has no router at all (screens are state, not URLs), so
 * there was also nothing to index even in principle. A product whose listeners
 * have to be told it exists cannot also be invisible to the one channel where
 * people go looking for «слушать радио <город>».
 *
 * WHY STATIC FILES RATHER THAN SERVER RENDERING. Caddy already serves the built
 * webapp with `root * .../dist` and `try_files {path} /index.html`, so a file in
 * dist is served with no new route, no runtime cost and no extra memory — and
 * this VPS is oversubscribed with its swap full, so a per-request renderer would
 * be the wrong shape.
 *
 * WHY `<uuid>.html` AND NOT `<uuid>/index.html`. Because the directory form does
 * not work here, and that is measured, not assumed. Probed against production
 * 2026-08-26: `/fonts/` — a directory that certainly exists in dist — returns the
 * 5152-byte SPA shell, byte-identical to `/`, as do `/fonts` and `/globe/`. So
 * `try_files {path}` matches FILES but falls through on directories, and a
 * `station/<uuid>/index.html` would have been invisible to every crawler while
 * looking perfectly fine to a human (the SPA reads the path and opens the right
 * station either way — which is exactly why this would not have been noticed).
 *
 * A one-line Caddyfile change would buy the prettier URL, but Caddy is the edge
 * for other services on this shared box, and a bad config there takes the
 * neighbours down with us. An extension in the URL costs nothing in ranking.
 *
 * WHAT MAY NOT GO ON THESE PAGES, both rules from this repo, not invented here:
 *
 *   - No popularity numbers. `votes`/`clickcount` rank the pages below but are
 *     never printed. They are deliberately not projected onto the wire by
 *     toStationLite so that popularity is never dressed up as a listener count,
 *     and a page baked into Google's cache is the worst possible place to start.
 *   - No raw tags. The catalogue's tag soup is not a genre; `stationGenreSlug`
 *     plus the app's own `genre` dictionary is the filter, and a station whose
 *     tags map to nothing simply gets no genre line.
 *
 * The station set is `resolvePromotable` — the exact set the app itself
 * promotes, so known-dead streams get no page and one broadcaster gets one page
 * rather than the nine rows Radio Browser lists it under. Duplicate pages are a
 * ranking problem as well as a lie.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolvePromotable } from '../apps/api/src/catalog/service.js';
import { stationGenreSlug } from '../apps/webapp/src/lib/stationGenre';
import { ruDictionary } from '../apps/webapp/src/state/locales/ru';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'apps', 'webapp', 'dist');
const ORIGIN = process.env.SITE_ORIGIN || 'https://radioatlas.ru';

/**
 * How many pages to generate. The full catalogue is ~46k stations after dedupe;
 * the build runs ON the production VPS during deploy, where memory is the
 * scarce resource, so the default is bounded. Raise it deliberately and watch
 * the build's peak RSS, do not assume.
 */
const LIMIT = Number(process.env.STATION_PAGES || 5000);
// Neighbours printed on each page. Six is enough to make the set crawlable —
// every page reachable from every other in a few hops — without turning the
// page into a link farm, which is the failure mode on the other side.
const RELATED_LINKS = 6;

// Derived from the function itself, so this script cannot drift from the type
// the catalogue actually uses.
type Station = Parameters<typeof resolvePromotable>[0][number];

/**
 * The one place the public shape of a station address is decided. `getStartParam`
 * in the webapp parses this same shape back out of the path, and its test names
 * the extension explicitly — if this ever changes, that test is the one that
 * must change with it.
 */
const stationPath = (uuid: string) => `/station/${uuid}.html`;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Replace the `content="…"` of one meta tag, leaving the rest of it alone. */
const setMeta = (html: string, attribute: 'name' | 'property', key: string, value: string) => {
  const tag = new RegExp(`<meta\\s[^>]*\\b${attribute}="${key}"[^>]*>`, 'i');
  return html.replace(tag, (match) =>
    match.replace(/\bcontent="[^"]*"/i, `content="${escapeHtml(value)}"`)
  );
};

/**
 * A station name is broadcaster-supplied text and some of it is junk: empty,
 * whitespace, or a wall of keywords. A page titled with garbage is worse than
 * no page, because it is the garbage that gets indexed.
 */
const usableName = (station: Station): string | null => {
  const name = (station.name || '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 90) return null;
  if (name.toLowerCase() === 'unknown station') return null;
  return name;
};

// Only `name` and `tags` are read by stationGenreSlug; the cast narrows to that
// rather than pretending a catalogue row is a wire-shaped Station.
const genreSlugOf = (station: Station): string | null =>
  stationGenreSlug({
    name: station.name,
    tags: station.tags
  } as Parameters<typeof stationGenreSlug>[0]) || null;

const genreLabel = (station: Station): string | null => {
  const slug = genreSlugOf(station);
  if (!slug) return null;
  const label = (ruDictionary.genre as Record<string, string | undefined>)[slug];
  return label ?? null;
};

/**
 * The catalogue stores country names in English («The United States Of America»),
 * which reads badly inside a Russian sentence. ICU knows the Russian name for an
 * ISO country code, so ask it rather than shipping a hand-written table of ~200
 * translations that nobody would maintain and that I would be inventing. Falls
 * back to the raw string when the code is missing or not a real region.
 */
const countryNames = new Intl.DisplayNames(['ru'], { type: 'region' });

const countryOf = (station: Station): string | null => {
  const code = (station.countrycode || '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(code)) {
    try {
      const localized = countryNames.of(code);
      // `of` returns the input back when it knows no such region.
      if (localized && localized !== code) return localized;
    } catch {
      // Fall through to the raw name.
    }
  }
  const raw = (station.country || '').trim();
  return raw || null;
};

/** Everything we can say truthfully, and nothing we cannot. */
const describe = (station: Station, name: string) => {
  const facts = [genreLabel(station)?.toLowerCase(), countryOf(station)].filter(Boolean);
  const tail = facts.length ? `, ${facts.join(', ')}` : '';
  return `Слушать ${name} онлайн бесплатно — прямой эфир${tail}. Без регистрации, на RadioAtlas.`;
};

type Related = { uuid: string; name: string };

/**
 * Neighbours for one station, drawn only from pages that actually exist.
 *
 * Measured against production before writing this: the home page a crawler
 * receives contains **zero** links to any station page, and a station page
 * contains exactly one `<a>` — to the home page. So all 5 000 were orphans,
 * discoverable through sitemap.xml and through nothing else, linking nowhere.
 * A search engine will crawl that; it has no reason to rank it, and a person
 * who lands there has no way onward except installing the app.
 *
 * Same country and genre first, then same country, then same genre — which is
 * also the order a listener would find useful, so the block is not decoration
 * for a crawler. Names are the stations' own; nothing here is generated.
 */
export const relatedFor = (
  station: Station,
  byCountry: Map<string, Related[]>,
  byGenre: Map<string, Related[]>,
  limit: number
): Related[] => {
  const countryKey = (station.countrycode || '').trim().toUpperCase();
  const genreKey = genreSlugOf(station) || '';
  const country = byCountry.get(countryKey) || [];
  const genre = byGenre.get(genreKey) || [];
  const genreSet = new Set(genre.map((entry) => entry.uuid));

  const picked: Related[] = [];
  const seen = new Set<string>([station.stationuuid]);
  const take = (pool: Related[]) => {
    for (const entry of pool) {
      if (picked.length >= limit) return;
      if (seen.has(entry.uuid)) continue;
      seen.add(entry.uuid);
      picked.push(entry);
    }
  };

  take(country.filter((entry) => genreSet.has(entry.uuid)));
  take(country);
  take(genre);
  return picked;
};

const renderPage = (
  shell: string,
  station: Station,
  name: string,
  related: Related[] = []
) => {
  const url = `${ORIGIN}${stationPath(station.stationuuid)}`;
  const title = `${name} — слушать онлайн`;
  const description = describe(station, name);
  const country = countryOf(station);
  const genre = genreLabel(station);

  let html = shell;
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  html = html.replace(
    /<link\s+rel="canonical"[^>]*>/i,
    `<link rel="canonical" href="${escapeHtml(url)}" />`
  );
  html = setMeta(html, 'name', 'description', description);
  html = setMeta(html, 'property', 'og:url', url);
  html = setMeta(html, 'property', 'og:title', title);
  html = setMeta(html, 'property', 'og:description', description);
  html = setMeta(html, 'name', 'twitter:title', title);
  html = setMeta(html, 'name', 'twitter:description', description);
  // The shared picture is the site's own cover, so its alt text must describe
  // THIS page rather than keep announcing the home page in every share.
  html = setMeta(html, 'property', 'og:image:alt', title);

  // The facts, as a list a crawler can read and a human can too.
  const facts = [
    country ? `<li>Страна: ${escapeHtml(country)}</li>` : '',
    genre ? `<li>Жанр: ${escapeHtml(genre)}</li>` : ''
  ]
    .filter(Boolean)
    .join('');

  /*
   * Rendered INSIDE #root on purpose. createRoot().render() replaces the
   * container's children, so React wipes this the moment it mounts — no
   * hydration mismatch, no cleanup code, and nothing hidden from a crawler that
   * a user cannot see (which is what gets a site penalised).
   *
   * It also improves the wait it replaces: before, a slow bundle showed a blank
   * screen; now somebody who clicked a search result sees the station they
   * clicked while the app loads. Styled inline because styles.css is a separate
   * render-blocking request and this must look intentional the instant it paints.
   */
  const body = [
    `<div style="min-height:100vh;display:flex;flex-direction:column;justify-content:center;`,
    `padding:2rem 1.5rem;background:#08111c;color:#f2f7fb;`,
    `font-family:Manrope,system-ui,-apple-system,'Segoe UI',sans-serif">`,
    `<h1 style="margin:0 0 .75rem;font-size:1.75rem;line-height:1.2">${escapeHtml(name)}</h1>`,
    `<p style="margin:0 0 1rem;opacity:.8;line-height:1.5">${escapeHtml(describe(station, name))}</p>`,
    facts ? `<ul style="margin:0 0 1.25rem;padding-left:1.1rem;opacity:.7;line-height:1.7">${facts}</ul>` : '',
    related.length
      ? [
          `<p style="margin:0 0 .5rem;opacity:.7">Похожие станции</p>`,
          `<ul style="margin:0 0 1.25rem;padding-left:1.1rem;line-height:1.8">`,
          related
            .map(
              (entry) =>
                `<li><a href="${escapeHtml(stationPath(entry.uuid))}" style="color:#78d6ff">${escapeHtml(entry.name)}</a></li>`
            )
            .join(''),
          `</ul>`
        ].join('')
      : '',
    `<p style="margin:0;opacity:.6"><a href="/" style="color:#78d6ff">Все радиостанции мира на RadioAtlas</a></p>`,
    `</div>`
  ].join('');

  return html.replace(/<div id="root">\s*<\/div>/i, `<div id="root">${body}</div>`);
};

const main = async () => {
  const shellPath = join(DIST, 'index.html');
  const shell = await readFile(shellPath, 'utf8').catch(() => null);
  if (!shell) {
    throw new Error(`No built shell at ${shellPath} — run this after \`vite build\`.`);
  }

  const artifactPath =
    process.env.CATALOG_ARTIFACT || join(ROOT, 'artifacts', 'catalog-fast.json');
  const raw = await readFile(artifactPath, 'utf8').catch(() => null);
  if (!raw) {
    // Not fatal: a build without the artifact should still produce a working
    // app. It just produces no station pages, and says so loudly.
    console.warn(`buildStationPages: no catalogue at ${artifactPath} — skipping station pages.`);
    return;
  }

  const stations = JSON.parse(raw) as Station[];
  const promotable = resolvePromotable(stations);

  const named = promotable
    .map((station) => ({ station, name: usableName(station) }))
    .filter((entry): entry is { station: Station; name: string } => entry.name !== null)
    .filter((entry) => Boolean(entry.station.stationuuid) && Boolean(entry.station.url_resolved));

  // Popularity decides WHICH stations get a page — it is never printed on one.
  const chosen = named
    .sort((left, right) => (right.station.clickcount || 0) - (left.station.clickcount || 0))
    .slice(0, LIMIT);

  const stationDir = join(DIST, 'station');
  await rm(stationDir, { recursive: true, force: true });

  await mkdir(stationDir, { recursive: true });

  // Indexes over the CHOSEN set only, so a related link can never point at a
  // page that was not generated. Insertion order is the popularity order the
  // sort above produced, which makes the first neighbours the ones a listener
  // is most likely to have heard of.
  const byCountry = new Map<string, Related[]>();
  const byGenre = new Map<string, Related[]>();
  for (const { station, name } of chosen) {
    const entry: Related = { uuid: station.stationuuid, name };
    const countryKey = (station.countrycode || '').trim().toUpperCase();
    if (countryKey) {
      const bucket = byCountry.get(countryKey);
      if (bucket) bucket.push(entry);
      else byCountry.set(countryKey, [entry]);
    }
    const genreKey = genreSlugOf(station);
    if (genreKey) {
      const bucket = byGenre.get(genreKey);
      if (bucket) bucket.push(entry);
      else byGenre.set(genreKey, [entry]);
    }
  }

  let bytes = 0;
  let linked = 0;
  for (const { station, name } of chosen) {
    const related = relatedFor(station, byCountry, byGenre, RELATED_LINKS);
    if (related.length) linked += 1;
    const page = renderPage(shell, station, name, related);
    await writeFile(join(stationDir, `${station.stationuuid}.html`), page, 'utf8');
    bytes += Buffer.byteLength(page);
  }

  const urls = [
    `  <url><loc>${ORIGIN}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    ...chosen.map(
      ({ station }) =>
        `  <url><loc>${ORIGIN}${stationPath(station.stationuuid)}</loc><changefreq>weekly</changefreq></url>`
    )
  ].join('\n');

  await writeFile(
    join(DIST, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    'utf8'
  );

  await writeFile(
    join(DIST, 'robots.txt'),
    [
      'User-agent: *',
      'Allow: /',
      // The API answers JSON and has no business in an index; the media proxy
      // would also hand a crawler an endless audio body.
      'Disallow: /api/',
      '',
      `Sitemap: ${ORIGIN}/sitemap.xml`,
      ''
    ].join('\n'),
    'utf8'
  );

  console.log(
    `buildStationPages: ${chosen.length} pages ` +
      `(${promotable.length} promotable of ${stations.length} rows), ` +
      `${linked} with related links, ` +
      `${(bytes / 1024 / 1024).toFixed(1)} MB, sitemap + robots.txt`
  );
};

// Run only as the build step, never on import: `stationPageRelated.test.ts`
// imports `relatedFor` from here, and a module that writes 39MB of HTML the
// moment it is imported is not testable.
if (process.argv[1]?.endsWith('buildStationPages.mts')) {
  await main();
}
