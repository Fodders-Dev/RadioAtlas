import { stationStreamIdentity } from './stationStreamIdentity.js';
import { nearStationIdentity } from './sourceAlternatives.js';

export type StationExclusionRow = {
  stationuuid: string;
  name?: string | null;
  country?: string | null;
  url_resolved?: string | null;
};

const MAX_EXCLUDED_IDS = 128;

/** Build a request-scoped predicate for explicit IDs and confirmed station mirrors. */
export async function createStationExclusionMatcher(
  excludedIds: readonly string[],
  getStation: (id: string) => Promise<StationExclusionRow | null>
): Promise<(row: StationExclusionRow) => boolean> {
  const ids = [...new Set(excludedIds.filter(Boolean))];
  const excluded = new Set(ids);
  const streams = new Set<string>();
  const identities = new Set<string>();

  // Provider lookups are individually best-effort: a missing row must not
  // suppress unrelated candidates, while its explicit UUID remains excluded.
  const anchors: Array<StationExclusionRow | null> = [];
  for (const id of ids.slice(0, MAX_EXCLUDED_IDS)) {
    try {
      const row = await getStation(id);
      anchors.push(row?.stationuuid === id ? row : null);
    } catch {
      anchors.push(null);
    }
  }
  for (const row of anchors) {
    if (!row) continue;
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
