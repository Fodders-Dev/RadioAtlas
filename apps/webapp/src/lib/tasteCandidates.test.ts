import { describe, expect, it } from 'vitest';
import { buildTasteCandidateQueries, TASTE_CANDIDATE_MIN_SCORE } from './tasteCandidates';
import { DEFAULT_TASTE_PROFILE_V2 } from './tasteProfile';

const profileWith = (over: Partial<typeof DEFAULT_TASTE_PROFILE_V2>) => ({
  ...DEFAULT_TASTE_PROFILE_V2,
  ...over
});

describe('buildTasteCandidateQueries', () => {
  it('leads with LANGUAGE (not tag) and refines with the top genres', () => {
    // Measured on the live catalog: tag=pop → 2/50 Russian, language=russian →
    // 46/50. A tag-led fetch re-imports the exact "foreign pop" complaint, so
    // the locale must scope the query and the tag may only sharpen it.
    const queries = buildTasteCandidateQueries(
      profileWith({
        languageScores: { russian: 20 },
        countryScores: { 'The Russian Federation': 18 },
        tagScores: { pop: 15, rock: 9, jazz: 2 }
      })
    );
    expect(queries.map((query) => query.params)).toEqual([
      { language: 'russian', tag: 'pop' },
      { language: 'russian', tag: 'rock' },
      { language: 'russian' }
    ]);
    // «jazz» scored 2 — below the noise floor, so it never becomes a query.
    expect(JSON.stringify(queries)).not.toContain('jazz');
  });

  it('falls back to COUNTRY when no language signal exists', () => {
    const queries = buildTasteCandidateQueries(
      profileWith({
        countryScores: { 'The Russian Federation': 12 },
        tagScores: { 'russian pop': 11 }
      })
    );
    expect(queries[0]?.params).toEqual({
      country: 'The Russian Federation',
      tag: 'russian pop'
    });
    expect(queries.at(-1)?.params).toEqual({ country: 'The Russian Federation' });
  });

  it('still returns an on-genre pool when only tags are known', () => {
    const queries = buildTasteCandidateQueries(profileWith({ tagScores: { synthwave: 14 } }));
    expect(queries).toHaveLength(1);
    expect(queries[0]?.params).toEqual({ tag: 'synthwave' });
  });

  it('COLD START: no confident signal → no queries (keeps today’s behaviour)', () => {
    // A brand-new user must NOT get a narrowed/empty screen: with no queries the
    // caller merges nothing and the server pool renders exactly as before.
    expect(buildTasteCandidateQueries(DEFAULT_TASTE_PROFILE_V2)).toEqual([]);
    expect(buildTasteCandidateQueries(null)).toEqual([]);
    expect(
      buildTasteCandidateQueries(
        profileWith({ tagScores: { pop: TASTE_CANDIDATE_MIN_SCORE - 1 } })
      )
    ).toEqual([]);
  });

  it('caps the fan-out and keys are stable + de-duped', () => {
    const queries = buildTasteCandidateQueries(
      profileWith({
        languageScores: { russian: 30 },
        tagScores: { pop: 20, rock: 19, jazz: 18, folk: 17 }
      })
    );
    expect(queries.length).toBeLessThanOrEqual(3);
    expect(new Set(queries.map((query) => query.key)).size).toBe(queries.length);
    expect(queries[0]?.key).toBe('language=russian&tag=pop');
  });
});
