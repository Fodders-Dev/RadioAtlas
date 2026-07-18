import type { StationLite } from '../types';
import { diversifyStationOrder } from './stationDiversity';

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
const normalizeFeedText = (value?: string | null) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const FEED_NON_MUSIC_PATTERN =
  /\b(?:news|talk|spoken\s*word|sports?|public\s*radio|parliament|politic(?:s|al)?|business|traffic|weather|scanner|dispatch|sermon|preach|generaliste|actualites?|noticias|nachrichten|information|infos?|новост(?:и|ное|ная|ной)?|разговорн\w*|политик\w*|спорт\w*|трафик|погод\w*)\b/i;

export const isFeedStationEligible = (station: StationLite) => {
  const name = normalizeFeedText(station.name).replace(/\s+/g, ' ').trim();
  const haystack = normalizeFeedText(`${station.name || ''} ${station.tags || ''}`);
  if (name === 'rtl') return false;
  if (FEED_NON_MUSIC_PATTERN.test(haystack)) return false;
  return true;
};

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
    if (!isFeedStationEligible(station)) continue;
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
  // The station the feed was ENTERED from — the Home hero the user just pulled
  // down. It becomes card 0 unconditionally and BYPASSES collect()'s
  // exclude / eligibility / liveness gates: those gates exist to keep DISCOVERY
  // cards good, and must never veto the very card the expand gesture is morphing
  // from (the current station is always in `exclude`, so without this the hero
  // would visibly turn into a different station mid-expand).
  //
  // The CALLER validates an idle pin — see StationFeed.tsx. When nothing is
  // playing, resolveFeedEntry returns autoplayInitial:true and card 0 IS played
  // on open, so an idle pin must clear the same liveness bar as any other card.
  pinFirst?: StationLite | null;
};

const DEFAULT_LIMIT = 40;
const DEFAULT_RANDOM_RATIO = 0.1;
const PERSONAL_LEAD_POOL = 4;
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
  isLive = ALWAYS_LIVE,
  pinFirst
}: BuildStationFeedInput): StationLite[] => {
  const excludeSet = exclude instanceof Set ? exclude : new Set(exclude ?? []);
  const seen = new Set<string>();
  // Seeding the pin into `seen` BEFORE any collect() call de-dupes it out of
  // every source at once (collect skips on `seen` as well as `exclude`), so it
  // can never appear twice. `exclude` itself is left untouched.
  const pin = pinFirst && pinFirst.stationuuid && pinFirst.url_resolved ? pinFirst : null;
  if (pin) seen.add(pin.stationuuid);
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

  // Card 0 rotates inside the strongest personal mini-pool. The old invariant
  // pinned `taste[0]` forever, so every Feed open started with the same station
  // even though the tail reshuffled. Rotating among the top few keeps the first
  // card personal while making repeat opens feel fresh.
  const leadPool = taste.slice(0, PERSONAL_LEAD_POOL);
  const rotatedLead = leadPool.length
    ? [...leadPool].sort(
        (left, right) =>
          seededJitter(left.stationuuid, seed + 911) - seededJitter(right.stationuuid, seed + 911)
      )[0] ?? null
    : null;
  // An entry pin always wins card 0 — «герой ЕСТЬ первая карточка ленты».
  // `preserveFirst: Boolean(lead)` below is therefore true whenever a pin
  // exists, and diversifyStationOrder pushes stations[0] into the result before
  // any diversity rule can displace it.
  const lead = pin ?? rotatedLead;
  const tasteRest = lead ? taste.filter((station) => station.stationuuid !== lead.stationuuid) : taste;

  const hasPersonalSource = taste.length > 0;
  const sources: Array<{ items: StationLite[]; weight: number }> = [
    { items: tasteRest, weight: hasPersonalSource ? 0.76 : 0 },
    { items: trend, weight: hasPersonalSource ? 0.16 : 0.64 },
    { items: random, weight: hasPersonalSource ? 0.08 : 0.36 }
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
  return diversifyStationOrder(ordered, {
    limit,
    preserveFirst: Boolean(lead),
    maxPerCountry: 4,
    maxPerPrimaryTag: 5,
    maxPerNameKey: 1
  });
};
