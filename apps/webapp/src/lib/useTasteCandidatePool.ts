import { useEffect, useMemo, useRef, useState } from 'react';
import { buildTasteCandidateQueries } from './tasteCandidates';
import type { TasteProfileV2 } from './tasteProfile';
import type { StationLite } from '../types';
import type { SearchStationsFn } from '../screens/search/types';

/**
 * Fetches an ON-TASTE candidate pool from the FULL catalog so the Home ranker has
 * something of the user's own world to rank.
 *
 * Without it the ranker sees only `summary.catalogPool` — 18 seedless
 * alphabetical rows from US/DE/ES — which is why the owner's Russian-heavy
 * library produced foreign, always-identical recommendations.
 *
 * Deliberately ADDITIVE: the caller merges this pool with the server's, so
 * discovery is never narrowed to the user's existing taste, and a cold-start
 * user (no confident signal → no queries) keeps exactly today's behaviour.
 */
export const useTasteCandidatePool = (
  profile: TasteProfileV2 | null | undefined,
  searchStations: SearchStationsFn,
  seed?: number
): StationLite[] => {
  const [pool, setPool] = useState<StationLite[]>([]);
  const queries = useMemo(() => buildTasteCandidateQueries(profile), [profile]);
  // Identity of the request set, so a re-render with an equal-but-new profile
  // object doesn't refetch.
  const signature = useMemo(
    () => `${queries.map((query) => query.key).join('|')}#${seed ?? 0}`,
    [queries, seed]
  );
  const lastSignatureRef = useRef('');

  useEffect(() => {
    if (!queries.length) {
      setPool([]);
      lastSignatureRef.current = '';
      return undefined;
    }
    if (lastSignatureRef.current === signature) return undefined;
    lastSignatureRef.current = signature;
    let cancelled = false;

    void (async () => {
      const collected: StationLite[] = [];
      const seenIds = new Set<string>();
      for (const query of queries) {
        try {
          const response = await searchStations({ ...query.params, limit: 50, seed });
          if (cancelled) return;
          for (const station of response.items || []) {
            if (!station?.stationuuid || seenIds.has(station.stationuuid)) continue;
            seenIds.add(station.stationuuid);
            collected.push(station);
          }
        } catch {
          // A failed slice is not a failed screen: the server pool still renders.
        }
      }
      if (!cancelled) setPool(collected);
    })();

    return () => {
      cancelled = true;
    };
  }, [queries, searchStations, seed, signature]);

  return pool;
};
