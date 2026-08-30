import { describe, expect, it } from 'vitest';
import { relatedFor } from '../../../scripts/buildStationPages.mjs';

/**
 * The neighbour links on a prerendered station page.
 *
 * Measured against production on 2026-08-30, before these existed: the home
 * page a crawler receives carried **zero** links to any station page, and a
 * station page carried exactly one `<a>` — back to the home page. All 5 000
 * pages were orphans, discoverable only through sitemap.xml and linking
 * nowhere. A search engine will crawl that and has no reason to rank it, and a
 * person who lands there has no way onward except installing the app.
 *
 * Two things can go quietly wrong with the fix, and both are asserted here.
 *
 * A link to a station that got no page is a 404 shipped five thousand times
 * over — and it would look fine in the generator's own output, because the
 * href is well-formed. The picker is therefore only ever handed the CHOSEN
 * set, and this pins that it does not invent members.
 *
 * And a picker that silently returns nothing leaves the pages exactly as
 * orphaned as before while the build still reports success. The build now
 * prints how many pages got links (4 966 of 5 000 on the current catalogue —
 * the remainder have neither a country code nor a mappable genre), and these
 * hold the behaviour that number depends on.
 */

type Row = { stationuuid: string; name: string; countrycode: string; tags: string };

const station = (uuid: string, countrycode: string, tags: string): Row => ({
  stationuuid: uuid,
  name: `Station ${uuid}`,
  countrycode,
  tags
});

const index = (rows: Row[]) => {
  const byCountry = new Map<string, { uuid: string; name: string }[]>();
  const byGenre = new Map<string, { uuid: string; name: string }[]>();
  for (const row of rows) {
    const entry = { uuid: row.stationuuid, name: row.name };
    const country = row.countrycode.toUpperCase();
    if (country) byCountry.set(country, [...(byCountry.get(country) ?? []), entry]);
    // The genre key here is the raw tag, which is what stationGenreSlug maps
    // these fixtures to; the picker reads the slug itself.
    if (row.tags) byGenre.set(row.tags, [...(byGenre.get(row.tags) ?? []), entry]);
  }
  return { byCountry, byGenre };
};

describe('related station links', () => {
  it('never links a station to itself', () => {
    const rows = [station('a', 'DE', 'jazz'), station('b', 'DE', 'jazz')];
    const { byCountry, byGenre } = index(rows);
    const picked = relatedFor(rows[0] as never, byCountry, byGenre, 6);
    expect(picked.map((entry) => entry.uuid)).not.toContain('a');
  });

  it('never returns a station that has no page', () => {
    // The indexes ARE the set of generated pages. Anything outside them would
    // be a 404 with a well-formed href — the kind of breakage that looks right
    // in every log.
    const rows = [station('a', 'FR', 'rock'), station('b', 'FR', 'rock'), station('c', 'FR', 'rock')];
    const { byCountry, byGenre } = index(rows);
    const generated = new Set(rows.map((row) => row.stationuuid));
    for (const row of rows) {
      for (const entry of relatedFor(row as never, byCountry, byGenre, 6)) {
        expect(generated.has(entry.uuid)).toBe(true);
      }
    }
  });

  it('prefers a neighbour that shares BOTH country and genre', () => {
    const subject = station('subject', 'IT', 'jazz');
    const sameBoth = station('both', 'IT', 'jazz');
    const sameCountry = station('country', 'IT', 'rock');
    const rows = [subject, sameCountry, sameBoth];
    const { byCountry, byGenre } = index(rows);
    const picked = relatedFor(subject as never, byCountry, byGenre, 1);
    expect(picked).toHaveLength(1);
    expect(picked[0].uuid).toBe('both');
  });

  it('falls back to the country, then to the genre, rather than returning nothing', () => {
    const subject = station('subject', 'JP', 'jazz');
    const countryOnly = station('countryOnly', 'JP', 'rock');
    const genreOnly = station('genreOnly', 'BR', 'jazz');
    const rows = [subject, countryOnly, genreOnly];
    const { byCountry, byGenre } = index(rows);
    const picked = relatedFor(subject as never, byCountry, byGenre, 6);
    expect(picked.map((entry) => entry.uuid)).toEqual(['countryOnly', 'genreOnly']);
  });

  it('returns each neighbour once, even when it matches on both axes', () => {
    const subject = station('subject', 'ES', 'jazz');
    const twice = station('twice', 'ES', 'jazz');
    const rows = [subject, twice];
    const { byCountry, byGenre } = index(rows);
    const picked = relatedFor(subject as never, byCountry, byGenre, 6);
    expect(picked.filter((entry) => entry.uuid === 'twice')).toHaveLength(1);
  });

  it('honours the limit, so a page cannot turn into a link farm', () => {
    const subject = station('subject', 'US', 'jazz');
    const rows = [subject, ...Array.from({ length: 40 }, (_, i) => station(`n${i}`, 'US', 'jazz'))];
    const { byCountry, byGenre } = index(rows);
    expect(relatedFor(subject as never, byCountry, byGenre, 6)).toHaveLength(6);
  });

  it('returns nothing rather than something wrong when there is no neighbour', () => {
    const subject = station('subject', '', '');
    const { byCountry, byGenre } = index([subject]);
    expect(relatedFor(subject as never, byCountry, byGenre, 6)).toEqual([]);
  });
});
