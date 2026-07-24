import type { TasteProfileV2 } from './tasteProfile';

/**
 * Taste-scoped candidate queries for the Home/personal-radio recommendation pool.
 *
 * WHY THIS EXISTS. The server's `summary.catalogPool` is `sorted.slice(0, 18)`
 * with a seedless `name.localeCompare` tiebreak, so every user — on every seed,
 * on every «Обновить» — gets the SAME 18 alphabetical `__`-prefixed rows from
 * US/DE/ES. Live-verified. The taste ranker downstream is correct; it simply had
 * nothing on-taste to rank, which is exactly the owner's «рекомендации совсем
 * никакие и постоянно однообразные… у меня в медиатеке совсем другой вкус».
 *
 * WHY LANGUAGE/COUNTRY LEAD AND TAG ONLY REFINES. Measured against the live
 * catalog (limit=50):
 *   tag=pop                  → 2/50 Russian   ← a tag-led fetch re-imports the
 *   language=russian         → 46/50 Russian     very "foreign pop" complaint
 *   language=russian&tag=pop → 47/50 Russian
 *   country=<top country>    → 50/50 Russian
 * A favourite's PRIMARY tag is routinely a bare foreign-worded «pop»/«rock», so
 * leading with it drags in foreign stations. Language/country carry the user's
 * actual locale; the tag then sharpens within it.
 */

export type TasteCandidateQuery = {
  /** URLSearchParams-ready filter pairs, e.g. { language: 'russian', tag: 'pop' }. */
  params: Record<string, string>;
  /** Stable identity for de-duping/caching (order-independent). */
  key: string;
};

/** A score below this is noise (a single skipped play), not a preference. */
export const TASTE_CANDIDATE_MIN_SCORE = 5;
/** Keep the fan-out small: this runs on Home mount over a mobile connection. */
export const MAX_TASTE_CANDIDATE_QUERIES = 3;

const topKeysByScore = (scores: Record<string, number> | undefined, limit: number): string[] =>
  Object.entries(scores || {})
    .filter(([label, score]) => Boolean(label) && Number.isFinite(score) && score >= TASTE_CANDIDATE_MIN_SCORE)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([label]) => label);

const toQuery = (params: Record<string, string>): TasteCandidateQuery => ({
  params,
  key: Object.keys(params)
    .sort()
    .map((name) => `${name}=${params[name]}`)
    .join('&')
});

/**
 * Build up to MAX_TASTE_CANDIDATE_QUERIES catalog queries that describe what this
 * user actually listens to. Returns [] when the profile carries no confident
 * signal — a new user must keep the server's generic pool rather than be handed
 * an empty screen.
 */
export const buildTasteCandidateQueries = (
  profile: TasteProfileV2 | null | undefined
): TasteCandidateQuery[] => {
  if (!profile) return [];
  const [topLanguage] = topKeysByScore(profile.languageScores, 1);
  const [topCountry] = topKeysByScore(profile.countryScores, 1);
  const topTags = topKeysByScore(profile.tagScores, 2);

  const queries: TasteCandidateQuery[] = [];
  const seen = new Set<string>();
  const push = (params: Record<string, string>) => {
    if (queries.length >= MAX_TASTE_CANDIDATE_QUERIES) return;
    const query = toQuery(params);
    if (seen.has(query.key)) return;
    seen.add(query.key);
    queries.push(query);
  };

  // 1) The sharpest on-taste slice: locale + favourite genre.
  const scope: Record<string, string> | null = topLanguage
    ? { language: topLanguage }
    : topCountry
      ? { country: topCountry }
      : null;
  if (scope && topTags[0]) push({ ...scope, tag: topTags[0] });
  // 2) The same locale, second genre — variety WITHIN the user's world.
  if (scope && topTags[1]) push({ ...scope, tag: topTags[1] });
  // 3) The locale alone: broad enough to keep discovery alive, still on-taste.
  if (scope) push({ ...scope });
  // A user with genres but no locale signal yet (e.g. tags synced from
  // favourites whose language field was empty) still gets an on-genre pool.
  if (!scope && topTags[0]) push({ tag: topTags[0] });

  return queries;
};
