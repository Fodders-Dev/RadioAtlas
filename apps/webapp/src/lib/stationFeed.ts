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

// Collect playable, NEW, LIVE stations in source order. One shared `seen` set
// across sources enforces the de-dup priority (taste → trending → random). The
// `exclude` set drops what's already in the user's world (favorites + recent +
// the currently-playing station) BEFORE weighting, so every card is something
// new — «новизна в твоём вкусе». `isLive` is the health gate: a dead/broken
// station never enters the feed (it would autoplay on swipe).
const collect = (
  stations: Array<StationLite | null | undefined>,
  seen: Set<string>,
  exclude: Set<string>,
  isLive: (station: StationLite) => boolean
) => {
  const out: StationLite[] = [];
  for (const station of stations) {
    if (!station || !station.stationuuid || !station.url_resolved) continue;
    if (exclude.has(station.stationuuid)) continue;
    if (seen.has(station.stationuuid)) continue;
    if (!isLive(station)) continue;
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
  // Station ids already in the user's world (favorites + recent + the current
  // station). Dropped from EVERY source before weighting → the feed is new.
  exclude?: Iterable<string>;
  // Liveness gate run on every candidate (drops dead/broken stations the feed
  // would otherwise autoplay). Defaults to "everything is live" so the pure unit
  // tests and any caller without a health profile keep working.
  isLive?: (station: StationLite) => boolean;
};

const DEFAULT_LIMIT = 40;
const DEFAULT_RANDOM_RATIO = 0.18;
const ALWAYS_LIVE = () => true;

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
  randomRatio = DEFAULT_RANDOM_RATIO,
  exclude,
  isLive = ALWAYS_LIVE
}: BuildStationFeedInput): StationLite[] => {
  const excludeSet = exclude instanceof Set ? exclude : new Set(exclude ?? []);
  const seen = new Set<string>();
  // Priority order for de-dup: taste → trending → random pool. Every source is
  // exclude- and liveness-filtered HERE, before any weighting, so the mix only
  // ever positions stations that are genuinely new and playable.
  const taste = collect(tasteStations, seen, excludeSet, isLive);
  const trend = collect(trending, seen, excludeSet, isLive);

  const randomCandidates = collect(pool, seen, excludeSet, isLive).sort(
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

  // Card 0 = the strongest PERSONAL pick (top of the taste deck) so opening the
  // feed lands on «твой вайб» immediately. It's pinned out of the weighted mix
  // (already in `seen`, so it never reappears) and the rest interleave behind it.
  const lead = taste[0] ?? null;
  const tasteRest = lead ? taste.slice(1) : taste;

  const sources: Array<{ items: StationLite[]; weight: number }> = [
    { items: tasteRest, weight: 0.5 },
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

  const mixed = keyed.map((entry) => entry.station);
  const ordered = lead ? [lead, ...mixed] : mixed;
  return ordered.slice(0, limit);
};
