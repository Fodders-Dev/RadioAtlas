import type { StationExposureLedger } from './stationExposure';
import type { StationLite } from '../types';

// «Лента» filter chips → the SOURCES buildStationFeed already understands. This
// module is the whole filter dimension: it owns which chips exist, which are
// honestly backed by real data, and how each one maps onto the existing knobs
// (tasteStations / trending / an `include` predicate). buildStationFeed itself
// gained exactly one optional field for this; no filter enum leaked into it.
//
// WHAT IS AND IS NOT HERE — the honesty accounting for this feature:
//
//   'picks'   «Подборка»        REAL. Today's exact default mix: the taste deck
//                               (createHomeRecommendationFeed + rankStationsForUser)
//                               leads at weight 0.76.
//   'fresh'   «Новое для тебя»  REAL, under that precise label. Backed by the
//                               exposure ledger (stationExposure.ts): stations the
//                               feed/Home has NOT shown you inside EXPOSURE_TTL_MS
//                               (3 days). A bare «Новое» would claim CATALOG
//                               recency, and there is no such signal anywhere:
//                               CatalogStation/StationLite carry no created-at or
//                               lastchangetime, and the summary's `freshSignals` is
//                               literally a seeded RANDOM sample, not new stations.
//                               THE CHIP IS NOT RENDERED on an empty ledger: with
//                               nothing to exclude the predicate admits everything
//                               and the deck is identical to «Подборка», i.e. the
//                               control would visibly do nothing.
//   'popular' «Популярное»      REAL where the server sends it: summary.trending
//                               (clicktrend) ∪ summary.topVoted (votes). `topVoted`
//                               was already fetched and never read by the feed.
//                               The CHIP IS NOT RENDERED when both are empty —
//                               degrading to the default mix under a «Популярное»
//                               label would be a lie, and a permanently-disabled
//                               chip reads as broken. The deck is the server set
//                               ALONE (randomRatio: 0) — see the branch below.
//
//   «LIVE»                      DROPPED, deliberately. The liveness gate is already
//                               applied to EVERY candidate inside collect(), so the
//                               chip would filter nothing — a visibly dead control.
//                               The only stricter predicate available
//                               (lastcheckok===1 within 24h) means "upstream
//                               reached the stream recently", not "on air"; there is
//                               no on-air signal in this stack, so no honest chip.
//
// Note there is no listener-count filter or sort either, for the same reason the
// card omits the listeners line: votes/clicktrend/clickcount exist only on the
// API's CatalogStation and are dropped by toStationLite's whitelist projection.

export type FeedFilter = 'picks' | 'fresh' | 'popular';

export type FeedFilterSources = {
  tasteStations: StationLite[];
  trending: StationLite[];
  include?: (station: StationLite) => boolean;
  randomRatio?: number;
};

export type ResolveFeedFilterSourcesInput = {
  filter: FeedFilter;
  taste: StationLite[];
  trending: StationLite[];
  // mergeUnique(summary.trending, summary.topVoted) — the server-ranked popular set.
  popular: StationLite[];
  exposure: StationExposureLedger | null | undefined;
};

// A chip only exists when the signal behind its LABEL exists. The UI asks this
// before rendering, so an absent signal removes the control instead of either
// serving the default mix behind someone else's label or shipping a control that
// visibly does nothing.
//
//   'popular' — needs a server-sent popular set.
//   'fresh'   — needs a non-empty exposure ledger. Its whole predicate is
//               "not shown to you recently"; with an empty ledger that admits
//               EVERYTHING, so the deck it builds is byte-identical to
//               «Подборка» and tapping the chip changes nothing on screen.
//               Measured on a virgin profile: «Подборка · 15» → «Новое для
//               тебя · 15», same card 0, same peek station. The ledger is
//               written on feed close (and by Home), so this only removes the
//               chip on a genuinely cold first open. (Residual, accepted: a
//               ledger that is non-empty but disjoint from the deck still
//               yields an identical list — gating on a real intersection would
//               mean building both decks on every render.)
export const isFeedFilterAvailable = (
  filter: FeedFilter,
  {
    popular,
    exposure
  }: { popular: StationLite[]; exposure?: StationExposureLedger | null }
): boolean => {
  if (filter === 'popular') return popular.length > 0;
  if (filter === 'fresh') return Boolean(exposure && Object.keys(exposure).length > 0);
  return true;
};

export const resolveFeedFilterSources = ({
  filter,
  taste,
  trending,
  popular,
  exposure
}: ResolveFeedFilterSourcesInput): FeedFilterSources => {
  if (filter === 'popular') {
    // Emptying tasteStations flips buildStationFeed's weights from
    // 0.76/0.16/0.08 to 0/0.64/0.36 automatically, so the popular set leads.
    //
    // randomRatio: 0 is NOT optional. The interleave key is
    // (indexInSource + jitter) / weight, so at weight 0.36 a random station's
    // key can be as low as 0/0.36 while popular[1] sits at 1/0.64 = 1.56 —
    // random stations sort straight into the TOP of the deck, not into a tail.
    // Measured: under «Популярное», card 4 of 6 carried no popularity signal at
    // all. Presenting a station with no popularity data under a popularity
    // label is exactly the fabrication this feature refuses everywhere else, so
    // the deck here is the server-ranked set and nothing but (plus the pin,
    // which bypasses every source by design). A short popular set therefore
    // yields a short deck, and the UI's `filterRanDry` band offers the way back.
    return { tasteStations: [], trending: popular, randomRatio: 0 };
  }
  if (filter === 'fresh') {
    // "Not shown to you in the last 3 days" — the ledger prunes past its TTL, so
    // an absent entry genuinely means "not recently surfaced", not "never seen".
    return {
      tasteStations: taste,
      trending,
      include: (station) => !exposure?.[station.stationuuid]
    };
  }
  return { tasteStations: taste, trending };
};
