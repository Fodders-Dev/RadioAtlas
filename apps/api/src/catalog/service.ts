import { DEAD_STREAM_IDS } from './deadStreams.js';
import { createSummaryCache } from './summaryCache.js';

export type CatalogStation = {
  stationuuid: string;
  name: string;
  url: string;
  url_resolved: string;
  homepage: string;
  favicon: string;
  tags: string;
  country: string;
  countrycode: string;
  state: string;
  language: string;
  codec: string;
  bitrate: number;
  geo_lat: number | null;
  geo_long: number | null;
  // Upstream Radio Browser stream-check signal. 1/0 if known,
  // undefined if the artifact predates this column.
  lastcheckok?: 0 | 1;
  // Epoch ms — when Radio Browser last performed the check.
  lastcheckok_at?: number | null;
  stationArtwork?: string | null;
  isClaimed?: boolean;
  isVerified?: boolean;
  promoted?: boolean;
  description?: string | null;
  websiteUrl?: string | null;
  scheduleNote?: string | null;
  // Radio Browser community/popularity signals, carried through unchanged from
  // the upstream artifact. votes = cumulative community votes; clicktrend =
  // recent click momentum ("rising"); clickcount = total clicks. Used to build
  // the Trending / Top-voted discovery rails (T2.21). Optional because older
  // artifacts may predate these columns.
  votes?: number;
  clicktrend?: number;
  clickcount?: number;
  // T_perf_search: server-internal precomputed search index. Built ONCE per
  // profiling refresh in getProfiledCatalog (lives on the cached profiled array,
  // invalidated with the catalog) so buildSearchResponse scans ready fields
  // instead of rebuilding ~60k strings per request. NEVER serialized to the wire
  // — toStationLite is a whitelist projection that omits these. buildSearchResponse
  // falls back to live compute per field if any are absent.
  searchHaystack?: string;
  searchCountry?: string;
  searchLanguage?: string;
  searchContinent?: string;
  searchTagText?: string;
  searchTags?: string[];
  // T_station_intel P1 (v1): a precomputed 0-ish quality score (reachability +
  // bitrate + codec + popularity) used to ORDER search results so the top of the
  // slice is the BEST match, not an arbitrary catalog-order one. Matters most for
  // Лира's search_stations (limit 8) — the anti-hallucination cap shows 5 cards,
  // so ranking makes them the best 5. Precomputed once per profiling refresh.
  searchQuality?: number;
};

export type CatalogDependencies = {
  getCatalog: (mode: 'fast' | 'full') => Promise<CatalogStation[]>;
  withStationProfiles: (stations: CatalogStation[]) => Promise<CatalogStation[]>;
};

type CatalogSpotlight = {
  label: string;
  stations: ReturnType<typeof toStationLite>[];
};

type CatalogSearchFilters = {
  q: string;
  country: string;
  language: string;
  tag: string;
  continent: string;
  limit: number;
  cursor: number;
  seed?: number;
  // Opt-in (AI/Лира path only): order a typed-q search by genre RELEVANCE blended
  // with quality, instead of quality-only. Fixes «мимо» picks where a bare-genre
  // `q` substring-matched the whole catalog and popularity alone chose the winner
  // (e.g. soul → generic, pop → global grab-bag). The HTTP catalog/search route
  // leaves this unset so the Search screen's ordering is unchanged.
  relevance?: boolean;
};

const PROFILE_CACHE_TTL_MS = 1000 * 60 * 5;
// T_api_summary_cache: quantize the per-load seed to an hourly bucket so loads
// within the hour share one computed summary; cap the live buckets as a backstop.
const SUMMARY_BUCKET_MS = 1000 * 60 * 60;
const SUMMARY_CACHE_MAX_BUCKETS = 6;
const GENERIC_STATE_KEYS = new Set([
  '',
  'unknown',
  'unknown location',
  'web',
  'the russian federation',
  'russia',
  'pangea'
]);

let profiledFastCache: { ts: number; data: CatalogStation[] } | null = null;
let profiledFullCache: { ts: number; data: CatalogStation[] } | null = null;

const toStationLite = (station: CatalogStation) => ({
  stationuuid: station.stationuuid,
  name: station.name,
  url: station.url,
  url_resolved: station.url_resolved,
  homepage: station.homepage || '',
  favicon: station.favicon || '',
  country: station.country || '',
  countrycode: station.countrycode || '',
  state: station.state || '',
  tags: station.tags || '',
  // Search result rows render «128 kbps» when this is truthy and omit the
  // element entirely when it is 0/absent. It already exists on every catalog
  // artifact; only this whitelist was dropping it. Deliberately NOT adding
  // votes/clickcount — they are not a listener count and must not be relabelled
  // as one.
  bitrate: station.bitrate ?? null,
  geo_lat: station.geo_lat ?? null,
  geo_long: station.geo_long ?? null,
  lastcheckok: station.lastcheckok,
  lastcheckok_at: station.lastcheckok_at ?? null,
  stationArtwork: station.stationArtwork || null,
  isClaimed: station.isClaimed,
  isVerified: station.isVerified,
  promoted: station.promoted,
  description: station.description || null,
  websiteUrl: station.websiteUrl || null,
  scheduleNote: station.scheduleNote || null
});

const normalizeText = (value?: string | null) =>
  value
    ?.trim()
    .replace(/\s+/g, ' ')
    .replace(/\(.*?\)/g, ' ')
    .trim() || '';

const normalizeKey = (value?: string | null) => normalizeText(value).toLowerCase();

const preferDisplayLabel = (current: string, candidate: string) => {
  if (!current) return candidate;
  if (!candidate) return current;
  const currentStartsLower = /^\p{Ll}/u.test(current);
  const candidateStartsUpper = /^\p{Lu}/u.test(candidate);
  if (currentStartsLower && candidateStartsUpper) return candidate;
  const currentAllCaps = current === current.toLocaleUpperCase();
  const candidateAllCaps = candidate === candidate.toLocaleUpperCase();
  if (currentAllCaps && !candidateAllCaps) return candidate;
  return current;
};

// Fold the Cyrillic ё (U+0451) onto е so «ёлка»/«елка» and «весёлый»/«веселый»
// match regardless of which the user typed. Cyrillic-only by design — Latin is
// untouched. Applied symmetrically on the query side (normalizeQuery) and the
// index side (computeSearchHaystack/computeSearchTagText) so the precompute ===
// live invariant holds. Inputs are already lowercased, so the lowercase ё covers
// the uppercase Ё too.
const foldCyrillic = (value: string) => value.replace(/ё/g, 'е');

const hasUsefulState = (state?: string | null, country?: string | null) => {
  const stateKey = normalizeKey(state);
  if (!stateKey || GENERIC_STATE_KEYS.has(stateKey)) return false;
  const countryKey = normalizeKey(country);
  return stateKey !== countryKey;
};

const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized === 'null' || normalized === 'undefined') {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toContinent = (lat: number, lon: number) => {
  if (lat <= -60) return 'Antarctica';
  if (lat >= 15 && lon >= -170 && lon <= -20) return 'North America';
  if (lat < 15 && lon >= -95 && lon <= -30) return 'South America';
  if (lat >= 35 && lon >= -25 && lon <= 45) return 'Europe';
  if (lat >= -35 && lon >= -20 && lon <= 55) return 'Africa';
  if (lon >= 110 && lat < 0) return 'Oceania';
  if (lon >= 40 && lon <= 180 && lat >= -10) return 'Asia';
  if (lon >= -10 && lon <= 55 && lat >= 0) return 'Europe';
  if (lon <= -20) return lat >= 0 ? 'North America' : 'South America';
  return 'Other';
};

const resolveContinent = (station: CatalogStation) => {
  const lat = asNumber(station.geo_lat);
  const lon = asNumber(station.geo_long);
  if (lat === null || lon === null) {
    return 'Other';
  }
  return toContinent(lat, lon);
};

const bucketSizeForZoom = (zoomLevel: number) => {
  if (zoomLevel >= 7) return 0.35;
  if (zoomLevel >= 5) return 0.55;
  if (zoomLevel >= 3.2) return 0.8;
  if (zoomLevel >= 2.4) return 1.2;
  if (zoomLevel >= 1.6) return 2.4;
  if (zoomLevel >= 1.1) return 5;
  return 10;
};

const bucketKeyForCoords = (lat: number, lon: number, bucketSize: number) => {
  const latBucket = Math.round((lat + 90) / bucketSize);
  const lonSpan = bucketSize / Math.max(0.42, Math.cos((Math.abs(lat) * Math.PI) / 180));
  const lonBucket = Math.round((lon + 180) / lonSpan);
  return `${bucketSize}:${latBucket}:${lonBucket}`;
};

export const parseCursor = (value: unknown) => {
  const raw = typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
};

export const parseLimit = (value: unknown, fallback: number, max = 100) => {
  const raw = typeof value === 'string' ? Number(value) : fallback;
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(Math.max(1, Math.floor(raw)), max);
};

export const normalizeQuery = (value: unknown) =>
  typeof value === 'string' ? foldCyrillic(value.trim().toLowerCase()) : '';

export const normalizeCatalogText = (value: unknown) =>
  normalizeText(typeof value === 'string' ? value : '');

const mulberry32 = (seed: number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

// Deterministic seeded ordering of a station list (no slice/projection) — the
// shared core of seededSample, reused by the diversified mood rails so the cap
// is applied to a stable per-seed order rather than the raw catalogue order.
const seededOrder = (stations: CatalogStation[], seed: number) => {
  const random = mulberry32(seed);
  return [...stations]
    .map((station) => ({ station, score: random() }))
    .sort((left, right) => left.score - right.score)
    .map(({ station }) => station);
};

const seededSample = (stations: CatalogStation[], seed: number, limit: number) =>
  seededOrder(stations, seed)
    .slice(0, limit)
    .map((station) => toStationLite(station));

// T_quality (2a/2b): per-country soft cap to break single-country domination —
// prod trending was almost all France; mood buckets repeated one country (e.g.
// «Концентрация» 3/5 Greece). Walk the already-ranked list and keep stations
// while no country exceeds `perCountryCap`; stations over the cap are deferred
// to an overflow list. If the capped picks fall short of `limit`, BACKFILL from
// the overflow in rank order so the rail never drops below its length (a
// tag-narrow, single-country bucket must not fall under MOOD_RAIL_MIN and get
// hidden). Country comparison reuses normalizeKey; blank countries each count
// under a shared "unknown" bucket so a flood of country-less stations is capped
// too. Input order is the caller's ranking (signal / seeded); output preserves
// it within the picked + backfilled sequence.
const diversifyByCountry = (
  ranked: CatalogStation[],
  limit: number,
  perCountryCap: number
): CatalogStation[] => {
  const counts = new Map<string, number>();
  const picked: CatalogStation[] = [];
  const overflow: CatalogStation[] = [];
  for (const station of ranked) {
    if (picked.length >= limit) break;
    const key = normalizeKey(station.country) || '__unknown__';
    const used = counts.get(key) || 0;
    if (used < perCountryCap) {
      counts.set(key, used + 1);
      picked.push(station);
    } else {
      overflow.push(station);
    }
  }
  for (const station of overflow) {
    if (picked.length >= limit) break;
    picked.push(station);
  }
  return picked;
};

// T_quality cap values: trending/topVoted favour maximum variety (2); the
// tag-narrow mood/genre pools get a looser cap (3) so diversification doesn't
// over-thin them before backfill.
const TRENDING_COUNTRY_CAP = 2;
const MOOD_GENRE_COUNTRY_CAP = 3;

const sortByTopSignal = (stations: CatalogStation[]) =>
  [...stations].sort((left, right) => {
    const leftScore = Number(Boolean(left.promoted)) * 4 + Number(Boolean(left.isVerified)) * 2;
    const rightScore = Number(Boolean(right.promoted)) * 4 + Number(Boolean(right.isVerified)) * 2;
    if (leftScore !== rightScore) return rightScore - leftScore;
    return left.name.localeCompare(right.name);
  });

// Rank by a numeric Radio Browser signal (votes / clicktrend), descending.
// Stations missing the signal (or with a non-positive value) are excluded so a
// rail built from this list hides gracefully when the artifact lacks the column.
const rankByNumericSignal = (
  stations: CatalogStation[],
  pick: (station: CatalogStation) => number | undefined
) =>
  stations
    .map((station) => ({ station, score: pick(station) ?? 0 }))
    .filter((entry) => Number.isFinite(entry.score) && entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.station);

const dedupeStations = (stations: CatalogStation[]) => {
  const seen = new Set<string>();
  const out: CatalogStation[] = [];
  for (const station of stations) {
    if (seen.has(station.stationuuid)) continue;
    seen.add(station.stationuuid);
    out.push(station);
  }
  return out;
};

// Top-N by a numeric signal.
const topByNumericSignal = (
  stations: CatalogStation[],
  pick: (station: CatalogStation) => number | undefined,
  limit: number,
  perCountryCap: number
) =>
  // Cap per country first (≤2), then backfill from the overflow so the rail
  // still fills to `limit` even if only a few countries carry the signal.
  diversifyByCountry(rankByNumericSignal(stations, pick), limit, perCountryCap).map(toStationLite);

const buildCountrySpotlight = (
  stations: CatalogStation[],
  seed: number,
  options: { exclude?: string } = {}
): CatalogSpotlight | null => {
  const excludeKey = options.exclude ? normalizeKey(options.exclude) : '';
  const buckets = new Map<string, CatalogStation[]>();
  stations.forEach((station) => {
    const country = normalizeText(station.country);
    if (!country) return;
    const current = buckets.get(country) || [];
    current.push(station);
    buckets.set(country, current);
  });
  const ranked = Array.from(buckets.entries())
    .filter(([label, items]) => items.length >= 4 && normalizeKey(label) !== excludeKey)
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]));
  if (!ranked.length) return null;
  const entry = ranked[seed % ranked.length];
  if (!entry) return null;
  const [label, items] = entry;
  return {
    label,
    stations: sortByTopSignal(items).slice(0, 8).map(toStationLite)
  };
};

const buildGenreSpotlight = (stations: CatalogStation[], seed: number): CatalogSpotlight | null => {
  const buckets = new Map<string, CatalogStation[]>();
  stations.forEach((station) => {
    (station.tags || '')
      .split(',')
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 4)
      .forEach((tag) => {
        const current = buckets.get(tag) || [];
        current.push(station);
        buckets.set(tag, current);
      });
  });
  const ranked = Array.from(buckets.entries())
    .filter(([, items]) => items.length >= 4)
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]));
  if (!ranked.length) return null;
  const entry = ranked[seed % ranked.length];
  if (!entry) return null;
  const [label, items] = entry;
  return {
    label,
    // T_quality (2b): a genre can be dominated by one country (e.g. a tag
    // that's mostly French stations). Cap ≤3 per country, then backfill so the
    // shelf still fills to 8.
    stations: diversifyByCountry(sortByTopSignal(items), 8, MOOD_GENRE_COUNTRY_CAP).map(toStationLite)
  };
};

// T2.22: mood rails — non-personalised shelves grouped by listening context,
// derived from Radio Browser tags. Tag matching is WORD-AWARE (exact match on a
// comma-split tag), never substring: a station tagged "electrock" must not land
// in Driving via "rock". Multi-word tags ("classic rock", "smooth jazz") are
// explicit list entries and match the full tag string. Computed server-side
// because the client only holds the summary's ~60 stations, far too few to
// bucket the catalogue's thousands of mood-tagged stations.
type MoodDefinition = { id: string; tags: string[] };
export const MOOD_DEFINITIONS: MoodDefinition[] = [
  { id: 'mood-late-night', tags: ['chillout', 'ambient', 'lounge', 'downtempo', 'smooth jazz'] },
  { id: 'mood-workout', tags: ['edm', 'house', 'electronic', 'workout', 'high energy'] },
  { id: 'mood-focus', tags: ['classical', 'jazz', 'instrumental', 'lo-fi', 'lofi', 'piano'] },
  { id: 'mood-driving', tags: ['rock', 'classic rock', 'pop rock', 'classic hits', 'hits', 'top 40'] }
];
const MOOD_RAIL_POOL = 10;
const MOOD_RAIL_MIN = 6;
// Size of the bounded, DETERMINISTIC candidate set a mood rail rotates inside.
// See buildMoodRails for why this exists; 4 moods x 30 = 120 stations is a set a
// 60/day scene budget covers in about two days and then only tops up.
const MOOD_RAIL_FEATURED = 30;

const stationTagSet = (station: CatalogStation) =>
  new Set(
    (station.tags || '')
      .split(',')
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean)
  );

const buildMoodRails = (stations: CatalogStation[], seed: number) => {
  // Assignment iteration order is shuffled per seed, so a station matching
  // several moods lands in a different one session-to-session (deterministic
  // for a given seed). Display order below stays fixed.
  const assignmentOrder = [...MOOD_DEFINITIONS]
    .map((mood) => {
      const offset = mood.id.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
      return { mood, score: mulberry32(seed + offset)() };
    })
    .sort((left, right) => left.score - right.score)
    .map((entry) => entry.mood);

  const buckets = new Map<string, CatalogStation[]>(MOOD_DEFINITIONS.map((mood) => [mood.id, []]));
  for (const station of stations) {
    const tagSet = stationTagSet(station);
    if (!tagSet.size) continue;
    const mood = assignmentOrder.find((candidate) => candidate.tags.some((tag) => tagSet.has(tag)));
    if (mood) buckets.get(mood.id)?.push(station);
  }

  // Emit in fixed display order; hide a mood whose bucket can't fill a shelf.
  return MOOD_DEFINITIONS.map((mood, index) => {
    const bucket = buckets.get(mood.id) || [];
    if (bucket.length < MOOD_RAIL_MIN) return null;
    // The visible rows used to be a reshuffle of the ENTIRE bucket — measured
    // against artifacts/catalog-full.json (61 470 stations) those buckets hold
    // 1 080 (late-night) to 6 656 (driving) stations. A generated scene
    // therefore had well under a 1% chance of being on screen in any given
    // hour, so seeded coverage could never accrue: prod measured 0 of 40 mood
    // slots with a scene while trending/topVoted sat at 100%. Rank by a real
    // popularity signal and rotate INSIDE a bounded, deterministic featured
    // pool — the shelf still turns over hourly, but out of a set small enough
    // for the nightly seeder to cover, and a voted station is better radio than
    // a random draw from the tail.
    //
    // ⚠ sortByTopSignal is unusable as the ranker here: it tiebreaks on
    // name.localeCompare, which is exactly what pinned the old catalogPool to
    // the same alphabetical «__»-prefixed rows. It appears only as a stable
    // filler for a bucket too tag-narrow to have MOOD_RAIL_FEATURED voted
    // stations, so the pool stays deterministic (and therefore seedable) even
    // then, and a rail that used to render never vanishes.
    //
    // T_quality (2b) is unchanged and deliberately still applied to the VISIBLE
    // draw: a mood bucket often skews to one country (prod «Концентрация» was
    // 3/5 Greece). Capping only the pool is not equivalent — diversifyByCountry
    // backfills past the cap to fill its limit, so a 4-country pool of 30 holds
    // ~7 per country and a 10-row draw from it took 4. Bound the pool, then cap
    // the shelf exactly as before.
    // ⚠ The vote signal can vanish for the WHOLE catalogue, not just for a
    // tag-narrow bucket: `votes`/`clicktrend` live only on the live Radio
    // Browser rows, and pickStation deliberately drops them from
    // artifacts/catalog-full.json. So whenever the upstream mirrors are
    // unreachable and the API serves its artifact fallback, rankByNumericSignal
    // returns NOTHING for every mood — measured on prod 2026-08-01, with
    // trending and topVoted empty at the same time.
    //
    // The filler must therefore be SEEDED, never sortByTopSignal: that one
    // tiebreaks on name.localeCompare, so in the degraded state every rail
    // collapsed to the same alphabetical rows («16Bit.FM I.D.E.A.»,
    // «101 SMOOTH JAZZ», «24/7 Bossa Nova Radio»). Seeded order is what these
    // rails did before the bounded pool existed, so degraded mode now falls
    // back to the OLD behaviour instead of to garbage.
    const voted = rankByNumericSignal(bucket, (station) => station.votes);
    const pool = diversifyByCountry(
      dedupeStations([...voted, ...seededOrder(bucket, seed + 977 + index)]),
      MOOD_RAIL_FEATURED,
      MOOD_GENRE_COUNTRY_CAP
    );
    const ordered = seededOrder(pool, seed + 401 + index);
    const stations = diversifyByCountry(ordered, MOOD_RAIL_POOL, MOOD_GENRE_COUNTRY_CAP).map(
      toStationLite
    );
    return { id: mood.id, stations };
  }).filter((rail): rail is { id: string; stations: ReturnType<typeof toStationLite>[] } => rail !== null);
};

// T2.21: per-day rotation key for "Around the world" — the country changes at
// UTC midnight and stays fixed all day (deterministic, no server state).
const dayNumber = (now = Date.now()) => Math.floor(now / 86_400_000);

export const buildCatalogSummary = (stations: CatalogStation[], seed: number, now = Date.now()) => {
  // Stations we have PROVEN do not play are not recommended. Probed from the
  // production VPS: five stations on our own shop window answered
  // `lastcheckok = 1` while being stone dead, on an upstream check dated
  // 2026-01-15 — over six months stale. Upstream health is not evidence.
  //
  // Filtered HERE and nowhere else, on purpose: every rail below is built from
  // `promotable`, so nothing we recommend can contain them, while the catalogue
  // itself is untouched — they stay searchable and playable for anyone who goes
  // looking. We are declining to recommend, not deleting. See deadStreams.ts.
  const promotable = DEAD_STREAM_IDS.size
    ? stations.filter((station) => !DEAD_STREAM_IDS.has(station.stationuuid))
    : stations;
  const sorted = sortByTopSignal(promotable);
  const promoted = sorted.filter((station) => station.promoted).slice(0, 6).map(toStationLite);
  const genreSpotlight = buildGenreSpotlight(sorted, seed + 17);
  const countrySpotlight = buildCountrySpotlight(sorted, seed + 29);
  // T2.21 discovery rails — non-personalised, server-side popularity signals.
  // Pools are larger than a rail renders (6) so they survive client-side
  // de-duplication against the personalised fresh-now shelf and still fill.
  const trending = topByNumericSignal(promotable, (station) => station.clicktrend, 12, TRENDING_COUNTRY_CAP);
  const topVoted = topByNumericSignal(promotable, (station) => station.votes, 12, TRENDING_COUNTRY_CAP);
  // Around the world rotates daily and avoids repeating the country-spotlight.
  const aroundTheWorld = buildCountrySpotlight(sorted, dayNumber(now), {
    exclude: countrySpotlight?.label
  });
  // T2.22 mood rails — bucket the full catalogue by listening context.
  const moodRails = buildMoodRails(promotable, seed);
  const tagCount = new Set(
    sorted
      .flatMap((station) => (station.tags || '').split(',').map((tag) => tag.trim().toLowerCase()))
      .filter(Boolean)
  ).size;
  return {
    generatedAt: Date.now(),
    counts: {
      // Counts describe the CATALOGUE, not the subset we are willing to
      // recommend — «Станций: 61 481» is a statement about what is in here, and
      // withholding five from the shelves does not remove them from it.
      stations: stations.length,
      countries: new Set(stations.map((station) => normalizeText(station.country)).filter(Boolean)).size,
      languages: new Set(stations.map((station) => normalizeText(station.language)).filter(Boolean)).size,
      genres: tagCount
    },
    // The client's personalization pool. This used to be `sorted.slice(0, 18)`,
    // and `sortByTopSignal` tiebreaks on `name.localeCompare` with NO seed — so
    // every user on every seed got the SAME 18 alphabetical rows («__1 oldies»,
    // «__80 HITS», …) from US/DE/ES, zero Russian. Live-verified across seeds
    // 1/2/99: byte-identical. That is the whole of «рекомендации однообразные»:
    // the taste ranker was correct but had nothing on-taste to rank.
    // Now seeded and wider (48), so the ranker has real choice. Rotation is
    // HOURLY, not per-refresh: summaryCache quantizes the seed into 1h buckets
    // on purpose (buildCatalogSummary is ~0.85s of sync CPU). Verified with
    // hour-apart seeds — the pool turns over completely and spans ~25 countries
    // incl. Russia, where it used to be 18 fixed `__`-prefixed rows from US/DE/ES.
    // Per-visit freshness comes from the client's own surface seed; on-taste
    // candidates come from the client's taste-scoped /catalog/search fetch.
    catalogPool: seededSample(sorted, seed + 3, 48),
    freshSignals: seededSample(sorted, seed + 1, 8),
    searchLaunch: seededSample(sorted, seed + 7, 8),
    sponsored: promoted,
    countrySpotlight,
    genreSpotlight,
    trending,
    topVoted,
    aroundTheWorld,
    moodRails
  };
};

// T_perf_search: the exact per-field normalizations buildSearchResponse used to
// do inline, now factored out so they can be (1) precomputed once per profiling
// refresh and (2) used as the live-compute fallback. These are pure functions of
// static station fields, so precomputed === live.
const computeSearchHaystack = (station: CatalogStation) =>
  foldCyrillic(
    [station.name, station.tags, station.country, station.state, station.language]
      .join(' ')
      .toLowerCase()
  );
const computeSearchTagText = (station: CatalogStation) =>
  foldCyrillic((station.tags || '').toLowerCase());

// Efficient codecs (AAC/AAC+/OGG/Opus) sound better per bitrate than MP3; any
// declared codec beats none.
const codecQualityBonus = (codec?: string): number => {
  const value = (codec || '').toUpperCase();
  if (!value) return 0;
  if (value.includes('AAC') || value.includes('OGG') || value.includes('OPUS')) return 0.5;
  if (value.includes('MP3') || value.includes('MPEG')) return 0.3;
  return 0.15;
};

// Pure per-station quality score for ORDERING search results (higher = better).
// Reachability dominates (a station Radio Browser just failed sinks below every
// healthy one); bitrate + codec capture stream quality; votes/clicks (log-scaled
// so a few mega-stations don't dwarf the field) capture popularity. Tolerant of
// missing fields (artifact rows without votes ⇒ 0). NOT an absolute metric — only
// the relative order within a result set matters.
const computeQualityScore = (station: CatalogStation): number => {
  const reach = station.lastcheckok === 1 ? 2 : station.lastcheckok === 0 ? -4 : 0;
  const bitrate = Math.min(Math.max(station.bitrate || 0, 0), 320) / 320;
  const codec = codecQualityBonus(station.codec);
  const popularity = Math.log10(
    1 + Math.max(0, station.votes || 0) + Math.max(0, station.clickcount || 0)
  );
  const trend = Math.log10(1 + Math.max(0, station.clicktrend || 0)) * 0.5;
  return reach + bitrate * 1.5 + codec + popularity + trend;
};
const computeSearchTags = (station: CatalogStation) =>
  (station.tags || '')
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);

// Per-field accessors: read the precomputed value when present, else compute
// live. `??` (not `||`) so a legitimately empty string/array precompute is kept.
const searchHaystackOf = (station: CatalogStation) =>
  station.searchHaystack ?? computeSearchHaystack(station);
const searchCountryOf = (station: CatalogStation) =>
  station.searchCountry ?? normalizeText(station.country);
const searchLanguageOf = (station: CatalogStation) =>
  station.searchLanguage ?? normalizeText(station.language);
const searchContinentOf = (station: CatalogStation) =>
  station.searchContinent ?? resolveContinent(station);
const searchTagTextOf = (station: CatalogStation) =>
  station.searchTagText ?? computeSearchTagText(station);
const searchTagsOf = (station: CatalogStation) =>
  station.searchTags ?? computeSearchTags(station);
const searchQualityOf = (station: CatalogStation) =>
  station.searchQuality ?? computeQualityScore(station);

// AI/Лира relevance: how well a station MATCHES the intended genre/name, so a
// bare-genre `q` returns actual genre stations instead of the most-voted row that
// merely contains the substring. Word-aware on the comma-split tags (so `tag=soul`
// hits «soul», «classic soul», «neo soul» but not «Seoul»/«console»). Blended with
// quality (not replacing it) so popularity only breaks ties WITHIN a relevance tier.
const computeSearchRelevance = (station: CatalogStation, q: string, tag: string): number => {
  let score = 0;
  const tags = searchTagsOf(station);
  const tagTerm = foldCyrillic(String(tag || q || '').toLowerCase().trim());
  if (tagTerm) {
    if (tags.includes(tagTerm)) score += 6;
    else if (tags.some((value) => value.split(/\s+/).includes(tagTerm))) score += 4;
    else if (tags.some((value) => value.includes(tagTerm))) score += 2;
  }
  const nameTerm = foldCyrillic(String(q || '').toLowerCase().trim());
  if (nameTerm) {
    const name = foldCyrillic(String(station.name || '').toLowerCase());
    if (name === nameTerm) score += 4;
    else if (name.split(/[^0-9a-zа-я]+/i).filter(Boolean).includes(nameTerm)) score += 3;
    else if (name.includes(nameTerm)) score += 1.5;
  }
  return score;
};
const RELEVANCE_WEIGHT = 3;

const seededSearchBrowseOrder = (
  stations: CatalogStation[],
  seed = Date.now(),
  limit = 50
) => {
  const ranked = [...stations].sort((left, right) => searchQualityOf(right) - searchQualityOf(left));
  const headSize = Math.min(ranked.length, Math.max(600, limit * 24));
  const head = seededOrder(ranked.slice(0, headSize), seed);
  const tail = ranked.length > headSize ? seededOrder(ranked.slice(headSize), seed + 17) : [];
  return [...head, ...tail];
};

// Attach the precomputed search index to every station. Runs ONCE per profiling
// refresh inside getProfiledCatalog (cached in profiledFullCache, invalidated
// with the catalog), and rides the #43 boot-warm path so the first search after
// a deploy is already warm. Returns NEW objects (no mutation of the upstream raw
// catalog) — a ~tens-of-MB delta on the cached profiled array, recomputed only
// on the 5-min refresh.
export const attachSearchIndex = (stations: CatalogStation[]): CatalogStation[] =>
  stations.map((station) => ({
    ...station,
    searchHaystack: computeSearchHaystack(station),
    searchCountry: normalizeText(station.country),
    searchLanguage: normalizeText(station.language),
    searchContinent: resolveContinent(station),
    searchTagText: computeSearchTagText(station),
    searchTags: computeSearchTags(station),
    searchQuality: computeQualityScore(station)
  }));

export const buildSearchResponse = (stations: CatalogStation[], filters: CatalogSearchFilters) => {
  const filtered = stations.filter((station) => {
    // q-haystack stays gated behind the && — a no-q browse never touches it.
    if (filters.q && !searchHaystackOf(station).includes(filters.q)) return false;
    if (filters.country && normalizeKey(searchCountryOf(station)) !== normalizeKey(filters.country)) {
      return false;
    }
    if (filters.language && searchLanguageOf(station) !== filters.language) return false;
    if (filters.tag && !searchTagTextOf(station).includes(filters.tag)) return false;
    if (filters.continent && searchContinentOf(station) !== filters.continent) return false;
    return true;
  });

  const countryCounts = new Map<
    string,
    { count: number; continent: string; label: string }
  >();
  const tagCounts = new Map<string, number>();
  const languageCounts = new Map<string, number>();
  const continentCounts = new Map<string, number>();

  filtered.forEach((station) => {
    const country = searchCountryOf(station);
    const continent = searchContinentOf(station);
    if (country) {
      const countryKey = normalizeKey(country);
      const current = countryCounts.get(countryKey) || { count: 0, continent, label: country };
      current.count += 1;
      current.label = preferDisplayLabel(current.label, country);
      countryCounts.set(countryKey, current);
    }
    const language = searchLanguageOf(station);
    if (language) {
      languageCounts.set(language, (languageCounts.get(language) || 0) + 1);
    }
    searchTagsOf(station).forEach((tag) => {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    });
    continentCounts.set(continent, (continentCounts.get(continent) || 0) + 1);
  });

  const nextCursor =
    filters.cursor + filters.limit < filtered.length ? String(filters.cursor + filters.limit) : null;

  // Typed search stays relevance/quality-first. Browse/filter-only search uses
  // a per-session seeded order inside a large healthy-quality head pool, so the
  // Search screen does not start with the same global leaders on every open.
  // The AI/Лира path opts into genre-relevance ordering (see CatalogSearchFilters).
  const ranked = filters.q
    ? filters.relevance
      ? filtered
          .map((station) => ({
            station,
            order:
              computeSearchRelevance(station, filters.q, filters.tag) * RELEVANCE_WEIGHT +
              searchQualityOf(station)
          }))
          .sort((left, right) => right.order - left.order)
          .map((entry) => entry.station)
      : [...filtered].sort((left, right) => searchQualityOf(right) - searchQualityOf(left))
    : seededSearchBrowseOrder(filtered, filters.seed, filters.limit);

  return {
    items: ranked.slice(filters.cursor, filters.cursor + filters.limit).map(toStationLite),
    total: filtered.length,
    nextCursor,
    facets: {
      countries: Array.from(countryCounts.entries())
        .sort(
          (left, right) =>
            right[1].count - left[1].count || left[1].label.localeCompare(right[1].label)
        )
        .slice(0, 80)
        .map(([, value]) => value.label),
      tags: Array.from(tagCounts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 80)
        .map(([tag]) => tag),
      languages: Array.from(languageCounts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 40)
        .map(([language]) => language),
      continentCounts: Array.from(continentCounts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([id, count]) => ({ id, count })),
      featuredCountries: Array.from(countryCounts.entries())
        .sort(
          (left, right) =>
            right[1].count - left[1].count || left[1].label.localeCompare(right[1].label)
        )
        .slice(0, 12)
        .map(([countryKey, value]) => ({
          key: countryKey,
          country: value.label,
          continent: value.continent,
          count: value.count
        }))
    }
  };
};

const buildAreaListResponse = (stations: CatalogStation[], zoomLevel: number) => {
  const bucketSize = bucketSizeForZoom(zoomLevel);
  const groups = new Map<
    string,
    {
      latTotal: number;
      lonTotal: number;
      count: number;
      stations: CatalogStation[];
      countryCounts: Map<string, number>;
      stateCounts: Map<string, number>;
    }
  >();

  let mappedStations = 0;
  stations.forEach((station) => {
    const lat = asNumber(station.geo_lat);
    const lon = asNumber(station.geo_long);
    if (lat === null || lon === null) return;
    const key = bucketKeyForCoords(lat, lon, bucketSize);
    const current = groups.get(key) || {
      latTotal: 0,
      lonTotal: 0,
      count: 0,
      stations: [],
      countryCounts: new Map<string, number>(),
      stateCounts: new Map<string, number>()
    };
    const country = normalizeText(station.country) || 'Unknown';
    const state = hasUsefulState(station.state, station.country) ? normalizeText(station.state) : '';
    mappedStations += 1;
    current.latTotal += lat;
    current.lonTotal += lon;
    current.count += 1;
    current.stations.push(station);
    current.countryCounts.set(country, (current.countryCounts.get(country) || 0) + 1);
    if (state) {
      current.stateCounts.set(state, (current.stateCounts.get(state) || 0) + 1);
    }
    groups.set(key, current);
  });

  const items = Array.from(groups.entries())
    .map(([id, group]) => {
      const countryEntries = Array.from(group.countryCounts.entries()).sort(
        (left, right) => right[1] - left[1]
      );
      const stateEntries = Array.from(group.stateCounts.entries()).sort(
        (left, right) => right[1] - left[1]
      );
      const country = countryEntries[0]?.[0] || 'Unknown';
      const state = stateEntries[0]?.[0] || '';
      const stateShare = stateEntries[0] ? stateEntries[0][1] / group.count : 0;
      const label =
        state && stateShare >= 0.24 && normalizeKey(state) !== normalizeKey(country) ? state : country;
      const subtitle =
        label === state && normalizeKey(state) !== normalizeKey(country)
          ? country
          : `${group.count} stations`;
      return {
        id,
        lat: group.latTotal / group.count,
        lon: group.lonTotal / group.count,
        label,
        subtitle,
        count: group.count
      };
    })
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

  return {
    items,
    mappedStations,
    totalStations: stations.length
  };
};

const buildAreaStationsResponse = (
  stations: CatalogStation[],
  areaId: string,
  limit: number,
  cursor: number
) => {
  const [bucketSizeRaw] = areaId.split(':');
  const bucketSize = Number(bucketSizeRaw);
  if (!Number.isFinite(bucketSize) || bucketSize <= 0) {
    return { area: null, items: [], nextCursor: null };
  }

  const areaStations = stations
    .filter((station) => {
      const lat = asNumber(station.geo_lat);
      const lon = asNumber(station.geo_long);
      if (lat === null || lon === null) return false;
      return bucketKeyForCoords(lat, lon, bucketSize) === areaId;
    })
    .sort((left, right) => {
      const leftScore = Number(Boolean(left.promoted)) * 4 + Number(Boolean(left.isVerified)) * 2;
      const rightScore = Number(Boolean(right.promoted)) * 4 + Number(Boolean(right.isVerified)) * 2;
      if (leftScore !== rightScore) return rightScore - leftScore;
      return left.name.localeCompare(right.name);
    });

  const areaList = buildAreaListResponse(areaStations, bucketSize);
  return {
    area: areaList.items[0] || null,
    items: areaStations.slice(cursor, cursor + limit).map(toStationLite),
    nextCursor: cursor + limit < areaStations.length ? String(cursor + limit) : null
  };
};

const getProfiledCatalog = async (mode: 'fast' | 'full', dependencies: CatalogDependencies) => {
  const cache = mode === 'fast' ? profiledFastCache : profiledFullCache;
  if (cache && Date.now() - cache.ts < PROFILE_CACHE_TTL_MS) {
    return cache.data;
  }
  // T_perf_search: precompute the search index here so it lives on the cached
  // profiled array (one map per 5-min refresh, on the boot-warm path) and the
  // per-request search just scans ready fields. NOT folded into withStationProfiles
  // — that short-circuits on no overrides and skips unprofiled stations.
  const profiled = await dependencies.withStationProfiles(await dependencies.getCatalog(mode));
  const data = attachSearchIndex(profiled);
  const entry = { ts: Date.now(), data };
  if (mode === 'fast') {
    profiledFastCache = entry;
  } else {
    profiledFullCache = entry;
  }
  return data;
};

// Compact per-station points payload for the immersive globe surface.
// Sends only what's needed to draw a dot and identify it; the full
// station record is fetched on selection through /catalog/stations/:id.
//
// Roughly 11k of 55k Radio Browser stations have explicit geo_lat /
// geo_long. The rest still belong to a known country, so we include
// them with `country` only — the webapp's geoResolver drops them
// inside the country's borders deterministically (seeded by the
// station UUID) so the globe stops looking sparse where it shouldn't.
const buildPointsResponse = (stations: CatalogStation[]) => {
  const items: Array<{
    id: string;
    lat?: number;
    lon?: number;
    country: string;
    state?: string;
    name?: string;
  }> = [];
  let mappedStations = 0;
  stations.forEach((station) => {
    const lat = asNumber(station.geo_lat);
    const lon = asNumber(station.geo_long);
    const country = normalizeText(station.country) || '';
    const state = normalizeText(station.state) || '';
    const name = normalizeText(station.name) || '';
    const hasCoords =
      lat !== null &&
      lon !== null &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180 &&
      !(Math.abs(lat) < 0.000001 && Math.abs(lon) < 0.000001);
    if (!hasCoords && !country) return;
    const entry: {
      id: string;
      lat?: number;
      lon?: number;
      country: string;
      state?: string;
      name?: string;
    } = { id: station.stationuuid, country };
    if (hasCoords) {
      mappedStations += 1;
      entry.lat = lat as number;
      entry.lon = lon as number;
    }
    if (state) entry.state = state;
    if (name) entry.name = name;
    items.push(entry);
  });
  return {
    items,
    mappedStations,
    totalStations: stations.length,
    schemaVersion: 3
  };
};

export const createCatalogService = (dependencies: CatalogDependencies) => {
  // T_api_summary_cache: cache + single-flight the summary. compute is the
  // untouched buildCatalogSummary; `now` is left to default to compute-time
  // inside it (day-granular rotation + generatedAt), only the seed is bucketed.
  const summaryCache = createSummaryCache(
    (catalog: CatalogStation[], bucketSeed: number) => buildCatalogSummary(catalog, bucketSeed),
    { bucketMs: SUMMARY_BUCKET_MS, maxBuckets: SUMMARY_CACHE_MAX_BUCKETS }
  );

  return {
    getCatalog: async (mode: 'fast' | 'full') => getProfiledCatalog(mode, dependencies),
    getSummary: async (seed: number) =>
      summaryCache.resolve(await getProfiledCatalog('full', dependencies), seed),
    search: async (filters: CatalogSearchFilters) =>
      buildSearchResponse(await getProfiledCatalog('full', dependencies), filters),
    listAreas: async (zoomLevel: number) =>
      buildAreaListResponse(await getProfiledCatalog('full', dependencies), zoomLevel),
    listAreaStations: async (areaId: string, limit: number, cursor: number) =>
      buildAreaStationsResponse(await getProfiledCatalog('full', dependencies), areaId, limit, cursor),
    listPoints: async () => buildPointsResponse(await getProfiledCatalog('full', dependencies)),
    getStationById: async (stationId: string) => {
      const stations = await getProfiledCatalog('full', dependencies);
      const item = stations.find((station) => station.stationuuid === stationId) || null;
      return item ? toStationLite(item) : null;
    }
  };
};
