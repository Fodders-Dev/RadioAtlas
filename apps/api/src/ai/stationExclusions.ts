import { stationStreamIdentity } from './stationStreamIdentity.js';
import { nearStationIdentity } from './sourceAlternatives.js';

export type StationExclusionRow = {
  stationuuid: string;
  name?: string | null;
  country?: string | null;
  url_resolved?: string | null;
};

export const MAX_EXCLUDED_IDS = 128;

/** Keep only verified rows for the first bounded IDs, in the caller's priority order. */
export function confirmedStationExclusionRows<T extends StationExclusionRow>(
  excludedIds: readonly string[],
  rows: readonly T[]
): T[] {
  const ids = [...new Set(excludedIds.filter(Boolean))];
  const lookupIds = new Set(ids.slice(0, MAX_EXCLUDED_IDS));
  const byId = new Map<string, T>();
  for (const row of rows) {
    if (lookupIds.has(row.stationuuid) && !byId.has(row.stationuuid)) byId.set(row.stationuuid, row);
  }
  return ids.slice(0, MAX_EXCLUDED_IDS).flatMap(id => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

export function createStationExclusionMatcherFromRows(
  excludedIds: readonly string[],
  rows: readonly StationExclusionRow[]
): (row: StationExclusionRow) => boolean {
  const ids = [...new Set(excludedIds.filter(Boolean))];
  const excluded = new Set(ids);
  const streams = new Set<string>();
  const identities = new Set<string>();

  for (const row of confirmedStationExclusionRows(ids, rows)) {
    if (row.url_resolved) streams.add(stationStreamIdentity({ url_resolved: row.url_resolved }));
    const identity = nearStationIdentity({ name: row.name || '', country: row.country || '' });
    if (identity) identities.add(identity);
  }

  return row => {
    if (excluded.has(row.stationuuid)) return true;
    if (row.url_resolved && streams.has(stationStreamIdentity({ url_resolved: row.url_resolved }))) return true;
    const identity = nearStationIdentity({ name: row.name || '', country: row.country || '' });
    return Boolean(identity && identities.has(identity));
  };
}

/** Build a request-scoped predicate for explicit IDs and confirmed station mirrors. */
export async function createStationExclusionMatcher(
  excludedIds: readonly string[],
  getStation: (id: string) => Promise<StationExclusionRow | null>
): Promise<(row: StationExclusionRow) => boolean> {
  const ids = [...new Set(excludedIds.filter(Boolean))];
  const anchors: StationExclusionRow[] = [];
  for (const id of ids.slice(0, MAX_EXCLUDED_IDS)) {
    try {
      const row = await getStation(id);
      if (row?.stationuuid === id) anchors.push(row);
    } catch { /* Missing anchors never suppress unrelated candidates. */ }
  }
  return createStationExclusionMatcherFromRows(ids, anchors);
}
