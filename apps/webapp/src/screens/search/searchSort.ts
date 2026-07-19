import { normalizeStationName } from '../../lib/stationUtils';
import type { StationLite } from '../../types';

// Search sort modes. ONLY orderings the app can honestly implement over the
// data it actually has are offered:
//   relevance — the existing blend (server quality-sort + the client re-ranker)
//   name      — A→Я on the normalized display name
//   country   — country, then name as the tie-break
// No «По популярности»: votes/clickcount are not serialized to StationLite, and
// relabelling either one as popularity is the same fabrication as the listener
// count the owner explicitly deferred to its own feature.
export const SORT_MODES = ['relevance', 'name', 'country'] as const;

export type SearchSortMode = (typeof SORT_MODES)[number];

export const SORT_LABEL_KEY: Record<SearchSortMode, string> = {
  relevance: 'search.sortRelevance',
  name: 'search.sortName',
  country: 'search.sortCountry'
};

export const isSearchSortMode = (value: unknown): value is SearchSortMode =>
  typeof value === 'string' && (SORT_MODES as ReadonlyArray<string>).includes(value);

// Intl-aware so Cyrillic sorts the way a Russian reader expects (а < б < я),
// not by UTF-16 code unit. `undefined` locale = the runtime's, which the app
// already syncs to the active UI locale via <html lang>.
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

const byName = (left: StationLite, right: StationLite) =>
  collator.compare(normalizeStationName(left.name) || '', normalizeStationName(right.name) || '');

const byCountry = (left: StationLite, right: StationLite) => {
  // Stations with no country sink to the bottom rather than sorting as ''.
  const leftCountry = (left.country || '').trim();
  const rightCountry = (right.country || '').trim();
  if (!leftCountry && rightCountry) return 1;
  if (leftCountry && !rightCountry) return -1;
  const byCountryName = collator.compare(leftCountry, rightCountry);
  return byCountryName !== 0 ? byCountryName : byName(left, right);
};

const SORT_COMPARATORS: Record<
  Exclude<SearchSortMode, 'relevance'>,
  (left: StationLite, right: StationLite) => number
> = {
  name: byName,
  country: byCountry
};

/**
 * Pure downstream pass over an ALREADY-RANKED list.
 *
 * 'relevance' returns the *same array reference* it was given, so the default
 * path is byte-identical to the pre-redesign render — the DOM-order assertions
 * in mobile.spec.ts cannot regress. The other modes copy before sorting, so the
 * frozen ranking snapshot upstream is never mutated.
 */
export const applySearchSort = (
  list: StationLite[],
  mode: SearchSortMode
): StationLite[] => {
  if (mode === 'relevance') return list;
  const comparator = SORT_COMPARATORS[mode];
  if (!comparator) return list;
  return [...list].sort(comparator);
};
