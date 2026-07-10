// Binds the brain's ToolProvider to the API's in-process catalogService. Typed
// against a minimal structural interface so the ai/ core stays free of route /
// catalog-internal imports. Even Telegram tool calls run through here in-process
// (the bot calls the brain over HTTP; the brain calls the catalog in-process).

import { artistTokensMatch, normalizeArtist } from './curatedArtistIndex.js';
import type { CuratedArtistHit, ToolProvider, TrendingRail, VerifiedStationRef } from './types.js';

// The handful of station fields the brain needs, as the catalogService returns
// them (a superset is fine).
type CatalogStationLite = {
  stationuuid: string;
  name: string;
  country?: string | null;
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
  }) => Promise<{ items: CatalogStationLite[] }>;
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

const splitTags = (tags: string | null | undefined): string[] =>
  String(tags || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag && tag.toLowerCase() !== 'no tags')
    .slice(0, 6);

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

const toRef = (station: CatalogStationLite): VerifiedStationRef => ({
  stationuuid: station.stationuuid,
  name: station.name,
  country: station.country || '',
  tags: splitTags(station.tags),
  favicon: station.favicon || '',
  url_resolved: station.url_resolved || ''
});

const hashSeed = (seed: string | undefined): number => {
  let hash = 0;
  for (const ch of String(seed || 'now')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash || 7;
};

export const createCatalogToolProvider = (catalog: CatalogServiceLike): ToolProvider => ({
  searchStations: async (args) => {
    const limit = Math.min(8, Math.max(1, args.limit || 8));
    const wantsTalk = queryWantsTalk(args.query || '', args.tag);
    // When we'll drop talk/news rows, over-fetch so a genre query still returns a
    // full set of MUSIC stations after filtering (the main ranking is untouched —
    // we just ask the same ranked search for more rows and post-filter here).
    const fetchLimit = wantsTalk ? limit : Math.min(24, limit * 3);
    const response = await catalog.search({
      q: args.query || '',
      country: args.country || '',
      language: args.language || '',
      tag: args.tag || '',
      continent: '',
      limit: fetchLimit,
      cursor: 0,
      // Лира ranks by genre relevance (not popularity-only) so a bare-genre ask
      // returns actual genre stations instead of the most-voted substring match.
      relevance: true
    });
    return (response.items || [])
      .filter((station) => station.url_resolved)
      .filter((station) => wantsTalk || !isTalkFormat(station))
      .slice(0, limit)
      .map(toRef);
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
  matchStationsByArtistName: async (artist: string) => {
    const artistNorm = normalizeArtist(artist);
    if (!artistNorm) return [];
    const stations = await catalog.getCatalog('full');
    const out: VerifiedStationRef[] = [];
    for (const station of stations) {
      if (!station.url_resolved) continue;
      // artist is the KEY (every artist token must appear in the station NAME);
      // the name is the haystack. So «Linkin Park» matches «Linkin Park Radio».
      if (artistTokensMatch(normalizeArtist(station.name), artistNorm)) {
        out.push(toRef(station));
        if (out.length >= MAX_NAME_MATCHES) break;
      }
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
