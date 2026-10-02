// Binds the brain's ToolProvider to the API's in-process catalogService. Typed
// against a minimal structural interface so the ai/ core stays free of route /
// catalog-internal imports. Even Telegram tool calls run through here in-process
// (the bot calls the brain over HTTP; the brain calls the catalog in-process).

import { artistTokensMatch, normalizeArtist } from './curatedArtistIndex.js';
import { placeMatchesQuery } from '../catalog/service.js';
import { knownSourceCountry, matchesForeignSource, sourceGenres } from './currentSourceDiscovery.js';
import { parseCatalogueTagEvidence, registerCatalogueTagEvidence } from './catalogueTagEvidence.js';
import { stationStreamIdentity } from './stationStreamIdentity.js';
import { compareNearScores, createNearSourceScorer, isDistinctNearSource, nearStationIdentity, type NearSourceScore } from './sourceAlternatives.js';
import { createStationExclusionMatcher, type StationExclusionRow } from './stationExclusions.js';
import type { CuratedArtistHit, ToolProvider, TrendingRail, VerifiedStationRef } from './types.js';

// The handful of station fields the brain needs, as the catalogService returns
// them (a superset is fine).
type CatalogStationLite = {
  stationuuid: string;
  name: string;
  country?: string | null;
  state?: string | null;
  tags?: string | null;
  favicon?: string | null;
  url_resolved?: string | null;
};

export type CatalogServiceLike = {
  search: (filters: {
    q: string;
    country: string;
    language: string;
    tag: string;
    continent: string;
    limit: number;
    cursor: number;
    relevance?: boolean;
  }) => Promise<{ items: CatalogStationLite[]; nextCursor?: string | number | null }>;
  getStationById: (id: string) => Promise<CatalogStationLite | null>;
  getSummary: (seed: number) => Promise<{
    moodRails?: Array<{ id: string; stations: CatalogStationLite[] }>;
    trending?: CatalogStationLite[];
  }>;
  // Full profiled catalog (curated overlay already applied) — scanned by the
  // artist-search layers for live-card lookup and name matching.
  getCatalog: (mode: 'full') => Promise<CatalogStationLite[]>;
};

const CDN_HOST = 'icecast-radiovanya.cdnvideo.ru';

// Lowercased CDN mount path of a station url, or '' when it isn't a Radio-Vanya
// CDN url (mirrors curatedOverlay.cdnMountOf so a curated hit's `mount` lines up
// with the live row's url_resolved).
const mountOf = (rawUrl: string | null | undefined): string => {
  if (!rawUrl) return '';
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname.toLowerCase() !== CDN_HOST) return '';
    return parsed.pathname.replace(/^\/+/, '').toLowerCase();
  } catch {
    return '';
  }
};

const MAX_NAME_MATCHES = 5;

const MOOD_LABELS: Record<string, string> = {
  'mood-late-night': 'Поздний вечер',
  'mood-workout': 'Тренировка',
  'mood-focus': 'Фокус',
  'mood-driving': 'Дорога'
};

const splitTags = (values: readonly string[]): string[] => {
  const recognized: string[] = [];
  const metadata: string[] = [];
  for (const tag of values) {
    (sourceGenres([tag]).length ? recognized : metadata).push(tag);
  }
  return [...recognized, ...metadata].slice(0, 6);
};

// Spoken-word / news / talk formats that pollute MUSIC recommendations (France
// Info, BBC World Service, RTL surfaced for «что послушать сегодня?»). Matched on
// name+tags. EN + a few common non-EN markers. NOT applied to the main catalog
// ranking — only here, in the AI rec path, and only when the user didn't ask for
// talk/news themselves.
const TALK_FORMAT =
  /(\bnews\b|\btalk\b|talk\s*radio|sport[s]?\s*talk|spoken\s*word|\binfo\b|actualit|nachrichten|noticias|g[eé]n[eéa]ralist|\bparliament\b|pol[ií]tica|разговорн|новост|\bречь\b)/i;

// Brand denylist for generalist talk/news stations whose NAME + (often empty)
// tags don't reveal the format, so TALK_FORMAT can't catch them — e.g. «RTL»
// (France, tags ''), which leaked in first on «что послушать?». Bounded so music
// siblings stay: \brtl\b matches «RTL» but NOT «RTL2» (pop,rock). Mirrored in
// queryWantsTalk so an explicit «включи RTL» is still honored. Keep this list
// SHORT + verified — only opaque brands with no music namesake in the catalog.
const TALK_BRANDS = /(\brtl\b)/i;
const HUMOR_TALK_FORMAT =
  /(анекдот|юмор|шутк|прикол|стендап|stand\s*up|comedy|humou?r|sketch|кабаре|kabar[ée])/i;

const isTalkFormat = (station: CatalogStationLite): boolean =>
  TALK_FORMAT.test(`${station.name || ''} ${station.tags || ''}`) ||
  TALK_BRANDS.test(station.name || '');

// Did the user's own query/tag ask for talk/news (or name a talk brand)? Then we
// must NOT filter it out.
const queryWantsTalk = (query: string, tag?: string): boolean =>
  TALK_FORMAT.test(`${query} ${tag || ''}`) ||
  TALK_BRANDS.test(`${query} ${tag || ''}`) ||
  HUMOR_TALK_FORMAT.test(`${query} ${tag || ''}`);

const normalizePlace = (value?: string | null) => String(value || '').trim().toLowerCase();

const toRef = (station: CatalogStationLite): VerifiedStationRef => {
  const fullTags = parseCatalogueTagEvidence(station.tags);
  const ref: VerifiedStationRef = {
    stationuuid: station.stationuuid,
    name: station.name,
    country: station.country || '',
    tags: splitTags(fullTags),
    favicon: station.favicon || '',
    url_resolved: station.url_resolved || ''
  };
  registerCatalogueTagEvidence(ref, fullTags);
  return ref;
};

const hashSeed = (seed: string | undefined): number => {
  let hash = 0;
  for (const ch of String(seed || 'now')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash || 7;
};

export const createCatalogToolProvider = (catalog: CatalogServiceLike): ToolProvider => ({
  searchStations: async (args) => {
    const limit = Math.min(8, Math.max(1, args.limit || 8));
    const excludedIds = args.excludeStationIds || [];
    const isExcluded = excludedIds.length
      ? await createStationExclusionMatcher(excludedIds, id => catalog.getStationById(id))
      : (_station: StationExclusionRow) => false;
    if (args.nearSource) {
      const anchor = args.nearSource;
      const score = createNearSourceScorer(anchor.tags);
      const country = args.country ? knownSourceCountry(args.country) : '';
      if (args.country && !country) return [];
      const best: Array<{station: CatalogStationLite; relation: NearSourceScore; stream: string; identity?: string}> = [];
      // Rank the eligible full catalogue before the cap, retaining at most eight
      // unique sources. Mirrors cannot consume the cap before a distinct result.
      for (const station of await catalog.getCatalog('full')) {
        if (!station.url_resolved || isExcluded(station) || isTalkFormat(station) ||
            !isDistinctNearSource({stationuuid:station.stationuuid,url_resolved:station.url_resolved,
              name:station.name,country:station.country || ''}, anchor) ||
            (country && knownSourceCountry(station.country || '') !== country)) continue;
        const relation = score(parseCatalogueTagEvidence(station.tags));
        if (!relation) continue;
        const stream = stationStreamIdentity({url_resolved:station.url_resolved});
        const identity = nearStationIdentity({name:station.name,country:station.country || ''});
        const duplicate = best.findIndex(item => item.stream === stream || item.station.stationuuid === station.stationuuid ||
          (identity && item.identity === identity));
        if (duplicate >= 0) {
          if (compareNearScores(relation, best[duplicate]!.relation) >= 0) continue;
          best.splice(duplicate, 1);
        }
        const position = best.findIndex(item => compareNearScores(relation, item.relation) < 0);
        best.splice(position < 0 ? best.length : position, 0, {station, relation, stream, identity});
        if (best.length > limit) best.pop();
      }
      return best.map(item => toRef(item.station));
    }
    if (args.requiredGenre) {
      const genre = args.requiredGenre;
      if (!sourceGenres([genre]).includes(genre)) return [];
      const country = args.country ? knownSourceCountry(args.country) : '';
      if (args.country && !country) return [];
      const streams = new Set<string>();
      const identities = new Set<string>();
      const seenIds = new Set(excludedIds.slice(0, 128));
      const matches: VerifiedStationRef[] = [];
      for (const station of await catalog.getCatalog('full')) {
        if (!station.url_resolved || seenIds.has(station.stationuuid) || isExcluded(station) || isTalkFormat(station)) continue;
        if (country && knownSourceCountry(station.country || '') !== country) continue;
        // Match each tag separately: a six-genre summary is not exhaustive.
        const evidence = parseCatalogueTagEvidence(station.tags);
        if (!evidence.some(tag => sourceGenres([tag]).includes(genre))) continue;
        const stream = stationStreamIdentity({url_resolved:station.url_resolved});
        const identity = nearStationIdentity({name:station.name,country:station.country || ''});
        if (streams.has(stream) || (excludedIds.length && identity && identities.has(identity))) continue;
        streams.add(stream);
        if (excludedIds.length && identity) identities.add(identity);
        seenIds.add(station.stationuuid);
        matches.push(toRef(station));
        if (matches.length >= limit) break;
      }
      return matches;
    }
    if (args.relatedTo) {
      // A home-country-heavy ranked page must not hide all foreign matches.
      // Read the existing profiled catalogue, filter first, cap last.
      const stations = await catalog.getCatalog('full');
      const matches: VerifiedStationRef[] = [];
      const seen = new Set<string>();
      const streams = new Set<string>();
      const identities = new Set<string>();
      for (const station of stations) {
        if (isTalkFormat(station) || seen.has(station.stationuuid) || isExcluded(station)) continue;
        const ref = toRef(station);
        if (!matchesForeignSource(ref, args.relatedTo)) continue;
        const stream = stationStreamIdentity(ref);
        const identity = nearStationIdentity({name:station.name,country:station.country || ''});
        if (excludedIds.length && (streams.has(stream) || (identity && identities.has(identity)))) continue;
        seen.add(ref.stationuuid);
        if (excludedIds.length) {
          streams.add(stream);
          if (identity) identities.add(identity);
        }
        matches.push(ref);
        if (matches.length >= limit) break;
      }
      return matches;
    }
    const wantsTalk = queryWantsTalk(args.query || '', args.tag);
    // When we'll drop talk/news rows, over-fetch so a genre query still returns a
    // full set of MUSIC stations after filtering (the main ranking is untouched —
    // we just ask the same ranked search for more rows and post-filter here).
    const fetchLimit = wantsTalk ? limit : Math.min(24, limit * 3);
    const canonicalCountry = args.country && knownSourceCountry(args.country);
    const countryLabels = canonicalCountry
      ? [...new Set((await catalog.getCatalog('full'))
        .filter(station => knownSourceCountry(station.country || '') === canonicalCountry)
        .map(station => station.country || ''))].slice(0, 6)
      : [args.country || ''];
    const placeTerm = String(args.query || '').trim();
    const enoughCards = (rows: CatalogStationLite[]) => {
      const ids = new Set<string>();
      const streams = new Set<string>();
      const identities = new Set<string>();
      const candidates = rows.filter(station => {
        if (!station.url_resolved || ids.has(station.stationuuid) || isExcluded(station) ||
            (!wantsTalk && isTalkFormat(station)) ||
            (canonicalCountry && knownSourceCountry(station.country || '') !== canonicalCountry)) return false;
        ids.add(station.stationuuid);
        const stream = stationStreamIdentity({ url_resolved: station.url_resolved });
        const identity = nearStationIdentity({ name: station.name, country: station.country || '' });
        if (streams.has(stream) || (identity && identities.has(identity))) return false;
        streams.add(stream);
        if (identity) identities.add(identity);
        return true;
      });
      const hits = placeTerm ? candidates.filter(station => placeMatchesQuery(station, placeTerm)) : [];
      const grounded = hits.length
        ? candidates.filter(station => placeMatchesQuery(station, placeTerm) ||
            hits.some(hit => normalizePlace(hit.country) === normalizePlace(station.country)))
        : candidates;
      return grounded.length >= limit;
    };
    // The catalogue stores legacy labels too (USA/Czech Republic). Resolve
    // its actual labels before each country-filtered ranked search; filtering
    // aliases after a global capped page cannot recover hidden local stations.
    const searches = await Promise.all((countryLabels.length ? countryLabels : [args.country || '']).map(async country => {
      const pages: CatalogStationLite[] = [];
      const maxPages = excludedIds.length ? 3 : 1;
      let cursor = 0;
      for (let page = 0; page < maxPages; page += 1) {
        const response = await catalog.search({
          q: args.query || '', country, language: args.language || '', tag: args.tag || '',
          continent: '', limit: fetchLimit, cursor,
          // Лира ranks by genre relevance (not popularity-only) so a bare-genre ask
          // returns actual genre stations instead of the most-voted substring match.
          relevance: true
        });
        pages.push(...(response.items || []));
        if (!excludedIds.length || response.nextCursor === null || enoughCards(pages)) break;
        cursor += fetchLimit;
      }
      return { items: pages };
    }));
    const seen = new Set<string>();
    const items = searches.flatMap(response => response.items || [])
      .filter(station => {
        if (seen.has(station.stationuuid)) return false;
        seen.add(station.stationuuid);
        if (isExcluded(station)) return false;
        return !canonicalCountry || knownSourceCountry(station.country || '') === canonicalCountry;
      })
      .filter((station) => station.url_resolved)
      .filter((station) => wantsTalk || !isTalkFormat(station));
    // Geography: when the query names a place and stations located there
    // exist, a station that only carries the word in its NAME and sits in
    // another country is dropped — «Radio Art — Tokyo» (Greece) is not a
    // station from Tokyo. Same-country name matches stay (a «Tokyo FM» filed
    // without a state is still Japanese).
    const placeHits = placeTerm ? items.filter((station) => placeMatchesQuery(station, placeTerm)) : [];
    const grounded = placeHits.length
      ? items.filter((station) => {
          if (placeMatchesQuery(station, placeTerm)) return true;
          const country = normalizePlace(station.country);
          return placeHits.some((hit) => normalizePlace(hit.country) === country);
        })
      : items;
    if (excludedIds.length) {
      const streams = new Set<string>();
      const identities = new Set<string>();
      return grounded.filter(station => {
        const stream = stationStreamIdentity({ url_resolved: station.url_resolved || '' });
        const identity = nearStationIdentity({ name: station.name, country: station.country || '' });
        if (streams.has(stream) || (identity && identities.has(identity))) return false;
        streams.add(stream);
        if (identity) identities.add(identity);
        return true;
      }).slice(0, limit).map(toRef);
    }
    return grounded.slice(0, limit).map(toRef);
  },
  getStation: async (id) => {
    if (!id) return null;
    const station = await catalog.getStationById(id);
    return station && station.url_resolved ? toRef(station) : null;
  },
  // L1 card fetch: locate the LIVE catalog row for a curated artist hit so the
  // card carries the real (overlay-resolved) uuid + stream, not the fallback id.
  // Match by CDN mount first (stable across overlay uuid claiming), then by exact
  // name, then by the curated fallback uuid.
  resolveArtistStation: async (hit: CuratedArtistHit) => {
    const stations = await catalog.getCatalog('full');
    const byMount = hit.mount
      ? stations.find((s) => mountOf(s.url_resolved) === hit.mount)
      : undefined;
    const match =
      byMount ||
      stations.find((s) => s.name === hit.name) ||
      stations.find((s) => s.stationuuid === hit.stationuuid);
    return match && match.url_resolved ? toRef(match) : null;
  },
  // L3: catalog stations whose NAME (not tags) matches the artist by case-tolerant
  // token-prefix. Catalog order is already quality-ranked, so the first matches
  // are the strongest; cap to keep the card list tight.
  matchStationsByArtistName: async (artist: string, excludeStationIds: string[] = []) => {
    const artistNorm = normalizeArtist(artist);
    if (!artistNorm) return [];
    const isArtistExcluded = excludeStationIds.length
      ? await createStationExclusionMatcher(excludeStationIds, id => catalog.getStationById(id))
      : (_station: StationExclusionRow) => false;
    // Name-collision guard. «Шура» (the singer) name-matched «Шура Каретный 18+
    // Радио» — a TALK station about a comedian — and, because that counted as a
    // verified hit, the artist path never fell back to the русская-эстрада
    // genre. Drop a talk-format hit ONLY when the query is a strict SUBSET of the
    // station name (asks fewer meaningful tokens than the station has), so
    // «шура»→drops the Каретный talk row but an explicit «Шура Каретный» keeps
    // it. An explicit talk/humour ask («анекдоты», «включи Каретный») is honored
    // via queryWantsTalk. Every other artist path already runs isTalkFormat;
    // this was the one that didn't.
    const wantsTalk = queryWantsTalk(artist);
    const NAME_NOISE = new Set(['радио', 'radio', 'fm', 'онлайн', 'online', 'plus', 'плюс', 'hd', '18']);
    const meaningfulTokens = (norm: string) =>
      norm.split(' ').filter((token) => token && !NAME_NOISE.has(token));
    const queryTokenCount = meaningfulTokens(artistNorm).length;
    const stations = await catalog.getCatalog('full');
    const out: VerifiedStationRef[] = [];
    for (const station of stations) {
      if (!station.url_resolved || isArtistExcluded(station)) continue;
      // artist is the KEY (every artist token must appear in the station NAME);
      // the name is the haystack. So «Linkin Park» matches «Linkin Park Radio».
      const stationNorm = normalizeArtist(station.name);
      if (!artistTokensMatch(stationNorm, artistNorm)) continue;
      const looseCollision = meaningfulTokens(stationNorm).length > queryTokenCount;
      if (looseCollision && !wantsTalk && isTalkFormat(station)) continue;
      out.push(toRef(station));
      if (out.length >= MAX_NAME_MATCHES) break;
    }
    return out;
  },
  discoverTrending: async (seed) => {
    const summary = await catalog.getSummary(hashSeed(seed));
    const rails: TrendingRail[] = (summary.moodRails || [])
      .map((rail) => ({
        id: rail.id,
        label: MOOD_LABELS[rail.id] || rail.id,
        // discover_trending is pure music discovery (no user query to honour a
        // talk/news ask) — always drop talk-format rows here. This is the
        // «что послушать сегодня?» path that leaked RTL / France Info; the
        // query-aware filter on searchStations didn't cover it.
        stations: (rail.stations || []).filter((s) => s.url_resolved && !isTalkFormat(s)).map(toRef)
      }))
      .filter((rail) => rail.stations.length);
    const trending = (summary.trending || [])
      .filter((s) => s.url_resolved && !isTalkFormat(s))
      .map(toRef);
    if (trending.length) {
      rails.unshift({ id: 'trending', label: 'Сейчас в тренде', stations: trending.slice(0, 6) });
    }
    return rails;
  }
});
