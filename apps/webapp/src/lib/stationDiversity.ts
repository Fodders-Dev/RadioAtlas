export type StationDiversityCandidate = {
  stationuuid: string;
  name: string;
  country?: string | null;
  tags?: string | string[] | null;
};

export type StationDiversityOptions = {
  limit?: number;
  preserveFirst?: boolean;
  maxPerCountry?: number;
  maxPerPrimaryTag?: number;
  maxPerNameKey?: number;
};

const normalizeLabel = (value: string | null | undefined) =>
  String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

export const stationNameDiversityKey = (name: string | null | undefined) =>
  normalizeLabel(name)
    .replace(/\b(?:hd|hq|hi-fi|hifi|opus|aac|mp3|ogg|flac|online|radio|stream)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const firstMeaningfulTag = (tags: string | string[] | null | undefined) => {
  const values = Array.isArray(tags) ? tags : String(tags || '').split(',');
  return values.map(normalizeLabel).find((tag) => tag && tag !== 'no tags') || '';
};

const canPick = <T extends StationDiversityCandidate>(
  station: T,
  counts: {
    countries: Map<string, number>;
    tags: Map<string, number>;
    names: Map<string, number>;
  },
  options: Required<Pick<StationDiversityOptions, 'maxPerCountry' | 'maxPerPrimaryTag' | 'maxPerNameKey'>>
) => {
  const country = normalizeLabel(station.country);
  const tag = firstMeaningfulTag(station.tags);
  const name = stationNameDiversityKey(station.name);
  if (name && (counts.names.get(name) || 0) >= options.maxPerNameKey) return false;
  if (country && (counts.countries.get(country) || 0) >= options.maxPerCountry) return false;
  if (tag && (counts.tags.get(tag) || 0) >= options.maxPerPrimaryTag) return false;
  return true;
};

const recordPick = <T extends StationDiversityCandidate>(
  station: T,
  counts: {
    countries: Map<string, number>;
    tags: Map<string, number>;
    names: Map<string, number>;
  }
) => {
  const country = normalizeLabel(station.country);
  const tag = firstMeaningfulTag(station.tags);
  const name = stationNameDiversityKey(station.name);
  if (country) counts.countries.set(country, (counts.countries.get(country) || 0) + 1);
  if (tag) counts.tags.set(tag, (counts.tags.get(tag) || 0) + 1);
  if (name) counts.names.set(name, (counts.names.get(name) || 0) + 1);
};

export const diversifyStationOrder = <T extends StationDiversityCandidate>(
  stations: T[],
  {
    limit = stations.length,
    preserveFirst = false,
    maxPerCountry = 3,
    maxPerPrimaryTag = 3,
    maxPerNameKey = 1
  }: StationDiversityOptions = {}
): T[] => {
  const target = Math.max(0, limit);
  if (!target || stations.length <= 1) return stations.slice(0, target);

  const selected: T[] = [];
  const overflow: T[] = [];
  const seen = new Set<string>();
  const counts = {
    countries: new Map<string, number>(),
    tags: new Map<string, number>(),
    names: new Map<string, number>()
  };

  const tryPick = (station: T) => {
    if (!station.stationuuid || seen.has(station.stationuuid)) return;
    if (!canPick(station, counts, { maxPerCountry, maxPerPrimaryTag, maxPerNameKey })) {
      overflow.push(station);
      return;
    }
    seen.add(station.stationuuid);
    selected.push(station);
    recordPick(station, counts);
  };

  const rest = preserveFirst ? stations.slice(1) : stations;
  if (preserveFirst && stations[0]) {
    selected.push(stations[0]);
    seen.add(stations[0].stationuuid);
    recordPick(stations[0], counts);
  }

  rest.forEach(tryPick);
  if (selected.length < target) {
    for (const station of overflow) {
      if (selected.length >= target) break;
      if (!station.stationuuid || seen.has(station.stationuuid)) continue;
      selected.push(station);
      seen.add(station.stationuuid);
    }
  }

  return selected.slice(0, target);
};
