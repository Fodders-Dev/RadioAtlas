// Binds the brain's ToolProvider to the API's in-process catalogService. Typed
// against a minimal structural interface so the ai/ core stays free of route /
// catalog-internal imports. Even Telegram tool calls run through here in-process
// (the bot calls the brain over HTTP; the brain calls the catalog in-process).

import type { ToolProvider, TrendingRail, VerifiedStationRef } from './types.js';

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
  }) => Promise<{ items: CatalogStationLite[] }>;
  getStationById: (id: string) => Promise<CatalogStationLite | null>;
  getSummary: (seed: number) => Promise<{
    moodRails?: Array<{ id: string; stations: CatalogStationLite[] }>;
    trending?: CatalogStationLite[];
  }>;
};

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
    const response = await catalog.search({
      q: args.query || '',
      country: args.country || '',
      language: args.language || '',
      tag: args.tag || '',
      continent: '',
      limit,
      cursor: 0
    });
    return (response.items || [])
      .filter((station) => station.url_resolved)
      .slice(0, limit)
      .map(toRef);
  },
  getStation: async (id) => {
    if (!id) return null;
    const station = await catalog.getStationById(id);
    return station && station.url_resolved ? toRef(station) : null;
  },
  discoverTrending: async (seed) => {
    const summary = await catalog.getSummary(hashSeed(seed));
    const rails: TrendingRail[] = (summary.moodRails || [])
      .map((rail) => ({
        id: rail.id,
        label: MOOD_LABELS[rail.id] || rail.id,
        stations: (rail.stations || []).filter((s) => s.url_resolved).map(toRef)
      }))
      .filter((rail) => rail.stations.length);
    const trending = (summary.trending || []).filter((s) => s.url_resolved).map(toRef);
    if (trending.length) {
      rails.unshift({ id: 'trending', label: 'Сейчас в тренде', stations: trending.slice(0, 6) });
    }
    return rails;
  }
});
