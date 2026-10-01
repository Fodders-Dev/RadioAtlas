import { catalogueTagEvidence } from './catalogueTagEvidence.js';
import { sourceFacts, sourceGenres } from './currentSourceDiscovery.js';
import { matchesRequestedCountry } from './requestedCountry.js';
import { stationStreamIdentity } from './stationStreamIdentity.js';
import type { ToolProvider, VerifiedStationRef } from './types.js';

// These umbrellas alone are too weak to call another station close. Exact
// recognised subgenres (e.g. indie rock) can establish a narrower connection.
const BROAD_GENRES = new Set(['electronic', 'rock', 'world', 'pop', 'dance']);
// Known musical directions outside the connection vocabulary still count as
// differences. They never establish a match or imply how the live audio sounds.
const OTHER_GENRES = new Set(['hardcore', 'industrial', 'noise', 'experimental', 'gabber', 'hardstyle', 'punk', 'post-punk', 'grunge']);
const normalize = (value: string) => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
const profile = (tags: readonly string[]) => {
  const genres = new Set<string>();
  const subgenres = new Set<string>();
  const otherGenres = new Set<string>();
  for (const tag of tags.slice(0, 80)) {
    const raw = normalize(tag);
    if (OTHER_GENRES.has(raw)) otherGenres.add(raw);
    const canonical = sourceGenres([tag])[0];
    if (!canonical) continue;
    genres.add(canonical);
    // Aliases such as джаз are not an extra musical direction. Only a known
    // compound label carries additional specificity, never arbitrary metadata.
    if (raw.includes(' ') && raw !== canonical) subgenres.add(raw);
  }
  return { genres, subgenres, otherGenres };
};

export type NearSourceAnchor = { stationuuid: string; url_resolved: string; tags: readonly string[] };
export type NearSourceScore = { common: string[]; exactSubgenres: number; specificGenres: number; otherExtra: number; overlap: number; extra: number };
export const createNearSourceScorer = (tags: readonly string[]) => {
  const anchor = profile(tags);
  return (candidateTags: readonly string[]): NearSourceScore | undefined => {
    const candidate = profile(candidateTags);
    const common = [...anchor.genres].filter(genre => candidate.genres.has(genre));
    const specificGenres = common.filter(genre => !BROAD_GENRES.has(genre)).length;
    const sharedSubgenres = [...anchor.subgenres].filter(genre => candidate.subgenres.has(genre));
    const exactSubgenres = sharedSubgenres.length;
    if (!specificGenres && !exactSubgenres) return undefined;
    const union = new Set([...anchor.genres, ...candidate.genres]).size;
    return { common: [...sharedSubgenres, ...common], exactSubgenres, specificGenres,
      otherExtra: [...candidate.otherGenres].filter(genre => !anchor.otherGenres.has(genre)).length, overlap: common.length / union,
      extra: candidate.genres.size - common.length };
  };
};

// Negative means a is preferred; equal scores preserve catalogue ordering.
export const compareNearScores = (a: NearSourceScore, b: NearSourceScore): number =>
  b.exactSubgenres - a.exactSubgenres || b.specificGenres - a.specificGenres ||
  a.otherExtra - b.otherExtra || b.overlap - a.overlap || a.extra - b.extra;

export const isDistinctNearSource = (row: Pick<VerifiedStationRef, 'stationuuid' | 'url_resolved'>, anchor: NearSourceAnchor): boolean =>
  Boolean(row.stationuuid && row.stationuuid !== anchor.stationuuid && row.url_resolved && anchor.url_resolved &&
    stationStreamIdentity(row) !== stationStreamIdentity(anchor));

export async function findNearSources(tools: ToolProvider, source: VerifiedStationRef, count: number,
  excludedIds: string[], country?: string): Promise<VerifiedStationRef[]> {
  const anchor: NearSourceAnchor = { stationuuid: source.stationuuid, url_resolved: source.url_resolved,
    tags: catalogueTagEvidence(source) };
  const excluded = new Set(excludedIds.slice(0, 128));
  const score = createNearSourceScorer(anchor.tags);
  const rows = await tools.searchStations({ query: '', nearSource: anchor, country,
    excludeStationIds: [...excluded], limit: 8 });
  const ranked = rows.flatMap(row => {
    if (excluded.has(row.stationuuid) || !isDistinctNearSource(row, anchor) ||
        (country && !matchesRequestedCountry(row.country, country))) return [];
    const relation = score(catalogueTagEvidence(row));
    return relation ? [{ row, relation }] : [];
  }).sort((a, b) => compareNearScores(a.relation, b.relation));
  const ids = new Set<string>(), streams = new Set<string>();
  return ranked.filter(({row}) => {
    const stream = stationStreamIdentity(row);
    if (ids.has(row.stationuuid) || streams.has(stream)) return false;
    ids.add(row.stationuuid); streams.add(stream); return true;
  }).slice(0, Math.max(1, Math.min(3, count))).map(({row}) => row);
}

export function describeNearSources(source: VerifiedStationRef, stations: VerifiedStationRef[], count: number, english: boolean): string {
  const anchor = sourceFacts(source);
  const score = createNearSourceScorer(catalogueTagEvidence(source));
  const lines = [english ? `Closer by catalogue genres to “${anchor.name}”:` : `Ближе по жанрам каталога к «${anchor.name}»:`];
  for (const station of stations) {
    const facts = sourceFacts(station);
    const common = score(catalogueTagEvidence(station))?.common.slice(0, 4) || [];
    lines.push(english ? `“${facts.name}”${facts.country ? ` (${facts.country})` : ''} — shared: ${common.join(', ')}.`
      : `«${facts.name}»${facts.country ? ` (${facts.country})` : ''} — общее: ${common.join(', ')}.`);
  }
  if (stations.length < count) lines.push(english
    ? `Found ${stations.length} of ${count}; I won't fill the missing places with unrelated stations.`
    : `Нашла ${stations.length} из ${count}; остальные места случайными станциями не заполняю.`);
  lines.push(english ? "This is a catalogue relationship; I can't hear the live programme."
    : 'Это связь по жанрам каталога; текущий эфир я не слышу.');
  return lines.join('\n');
}
