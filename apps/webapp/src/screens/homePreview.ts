import type { StationLite } from '../types';

export const SEARCH_PREVIEW_LIMIT = 3;
export const DENSE_SEARCH_PREVIEW_LIMIT = 2;

export const filterPreviewStations = (
  catalog: StationLite[],
  rawQuery: string,
  limit = SEARCH_PREVIEW_LIMIT
) => {
  const normalized = rawQuery.trim().toLowerCase();
  if (!normalized) return [];

  return catalog
    .filter((station) =>
      [
        station.name,
        station.country,
        station.state,
        (station as { language?: string }).language,
        station.tags
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalized)
    )
    .slice(0, limit);
};
