import { catalogueTagEvidence } from './catalogueTagEvidence.js';
import { sourceGenres } from './currentSourceDiscovery.js';
import { stationStreamIdentity } from './stationStreamIdentity.js';
import type { ToolProvider, VerifiedStationRef } from './types.js';

export type GenreSlot = { genre: string; count: number };
export type GenreSelection = { slot: GenreSlot; stations: VerifiedStationRef[] };

// Small bounded assignment, not greedy concatenation. A hybrid station should
// remain available for the second genre when the first has another candidate.
// Exact shared streams cannot occupy both places under different UUIDs.
export async function selectGenreSlots(
  slots: GenreSlot[], tools: ToolProvider, excludedIds: string[],
  filter: (stations: VerifiedStationRef[]) => VerifiedStationRef[]
): Promise<GenreSelection[]> {
  if (slots.length !== 2 || slots.some(slot => !Number.isInteger(slot.count) || slot.count < 1 || slot.count > 2)) {
    throw new Error('Unsupported genre slot allocation');
  }
  const excluded = new Set(excludedIds.slice(0, 128));
  const pools: VerifiedStationRef[][] = [];
  for (const slot of slots) {
    const rows = await tools.searchStations({ query: slot.genre, requiredGenre: slot.genre,
      excludeStationIds: [...excluded], limit: 8 });
    pools.push(filter(rows).filter(row => row.stationuuid && row.url_resolved && !excluded.has(row.stationuuid) &&
      catalogueTagEvidence(row).some(tag => sourceGenres([tag]).includes(slot.genre))).slice(0, 8));
  }
  const demands = slots.flatMap((slot, group) => Array.from({ length: slot.count }, () => group));
  let best: VerifiedStationRef[][] = [[], []];
  let bestCoverage = -1, bestCount = -1;
  const visit = (position: number, picked: VerifiedStationRef[][], ids: Set<string>, streams: Set<string>) => {
    if (position === demands.length) {
      const coverage = picked.filter(group => group.length > 0).length;
      const count = picked.reduce((total, group) => total + group.length, 0);
      if (coverage > bestCoverage || (coverage === bestCoverage && count > bestCount)) {
        bestCoverage = coverage; bestCount = count;
        best = picked.map(group => [...group]);
      }
      return;
    }
    const group = demands[position]!;
    for (const row of pools[group]!) {
      const stream = stationStreamIdentity(row);
      if (ids.has(row.stationuuid) || streams.has(stream)) continue;
      picked[group]!.push(row); ids.add(row.stationuuid); streams.add(stream);
      visit(position + 1, picked, ids, streams);
      picked[group]!.pop(); ids.delete(row.stationuuid); streams.delete(stream);
    }
    visit(position + 1, picked, ids, streams);
  };
  visit(0, [[], []], new Set(), new Set());
  return slots.map((slot, index) => ({ slot, stations: best[index]! }));
}

const label = (value: string, max = 100) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const RU_GENRES: Record<string,string> = {funk:'Фанк',ambient:'Эмбиент',jazz:'Джаз',rock:'Рок',soul:'Соул',blues:'Блюз',pop:'Поп',electronic:'Электроника',house:'Хаус',techno:'Техно',classical:'Классика',reggae:'Регги'};
export function describeGenreSlots(selection: GenreSelection[], english: boolean): string {
  const lines = selection.map(({slot, stations}) => {
    const names = stations.map(row => `«${label(row.name)}»${row.country ? ` (${label(row.country, 60)})` : ''}`).join(', ');
    const title = english ? slot.genre : (RU_GENRES[slot.genre] || slot.genre);
    const prefix = stations.length === slot.count ? title : `${title} (${stations.length} ${english ? 'of' : 'из'} ${slot.count})`;
    return names ? `${prefix} — ${names}.` : `${prefix} — ${english ? 'no verified source found' : 'подтверждённый источник не найден'}.`;
  });
  lines.push(english ? 'These are catalogue genres; the live music may differ.' : 'Это жанры из каталога; музыка в живом эфире может отличаться.');
  return lines.join('\n');
}
