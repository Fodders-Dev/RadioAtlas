import type { StationLite } from '../types';

// Phase 2 Discovery Feed builder. Pure + deterministic on `seed`: blends the
// «Для тебя» taste deck, server trending, and a sprinkle of random discovery
// into ONE deduplicated, shuffled vertical feed. Reuses the existing taste /
// trending SOURCES (homeProfile / catalog summary) — it only mixes them.

const hashValue = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

// Seed-mixed 0..1 jitter (fmix finalizer) so any seed change genuinely permutes
// the order rather than shifting every station by the same amount. Mirrors
// homeProfile.seededJitter / tasteProfile (the «Моя Волна» freshness fix).
const seededJitter = (id: string, seed: number) => {
  let h = (hashValue(id) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h % 1000) / 1000;
};

const dedupe = (stations: Array<StationLite | null | undefined>, seen: Set<string>) => {
  const out: StationLite[] = [];
  for (const station of stations) {
    if (!station || !station.stationuuid || !station.url_resolved) continue;
    if (seen.has(station.stationuuid)) continue;
    seen.add(station.stationuuid);
    out.push(station);
  }
  return out;
};

export type BuildStationFeedInput = {
  tasteStations: StationLite[];
  trending: StationLite[];
  pool: StationLite[];
  seed: number;
  limit?: number;
  // Fraction of the feed pulled from the random pool («редкие случайные»).
  randomRatio?: number;
};

const DEFAULT_LIMIT = 40;
const DEFAULT_RANDOM_RATIO = 0.18;

// Proportional weighted interleave: each source's items keep their internal order
// but are positioned by `(indexInSource + jitter) / weight`, so a higher-weight
// source surfaces earlier and more often while the jitter permutes near-ties per
// seed. Sorting the union by that key produces a stable, on-taste-leaning MIX
// (taste leads, trending threads through, random sprinkles in) — deterministic
// for a fixed seed, genuinely reshuffled when the seed changes.
export const buildStationFeed = ({
  tasteStations,
  trending,
  pool,
  seed,
  limit = DEFAULT_LIMIT,
  randomRatio = DEFAULT_RANDOM_RATIO
}: BuildStationFeedInput): StationLite[] => {
  const seen = new Set<string>();
  // Priority order for de-dup: taste → trending → random pool.
  const taste = dedupe(tasteStations, seen);
  const trend = dedupe(trending, seen);

  const randomCandidates = dedupe(pool, seen).sort(
    (left, right) => seededJitter(left.stationuuid, seed) - seededJitter(right.stationuuid, seed)
  );
  // «редкие случайные»: normally the random pool is capped to a small slice so
  // discovery stays present without diluting the mix. BUT when there's no taste
  // AND no trending signal (a fresh user with only a catalog pool), the pool IS
  // the feed — use it whole (capped only by `limit` below) instead of the ~7-item
  // budget, so the feed isn't near-empty.
  const poolIsPrimary = taste.length === 0 && trend.length === 0;
  const randomBudget = Math.max(2, Math.round(limit * randomRatio));
  const random = poolIsPrimary ? randomCandidates : randomCandidates.slice(0, randomBudget);

  const sources: Array<{ items: StationLite[]; weight: number }> = [
    { items: taste, weight: 0.5 },
    { items: trend, weight: 0.32 },
    { items: random, weight: 0.18 }
  ].filter((source) => source.items.length > 0);

  const keyed = sources.flatMap(({ items, weight }) =>
    items.map((station, index) => ({
      station,
      key: (index + seededJitter(station.stationuuid, seed)) / weight
    }))
  );
  keyed.sort((left, right) => left.key - right.key);

  return keyed.map((entry) => entry.station).slice(0, limit);
};
