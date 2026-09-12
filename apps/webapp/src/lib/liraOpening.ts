// The first line of Лира's section is a musical offer built from what the
// screen really shows — the station on air and the catalogue picks under it —
// and from nothing else. A genre is named only when the station's own tags map
// to a precise genre; a station with no readable genre is
// offered by name alone, never dressed in one.
import type { StationLite } from '../types';
import { normalizeStationName } from './stationUtils';
import { genreFamilyOfSlug, stationGenreSlug, type GenreSlug } from './stationGenre';

export type OpeningPiece = { name: string; genre: string | null };

const lowerFirst = (value: string): string => (value ? value[0].toLocaleLowerCase() + value.slice(1) : value);

export const liraOpeningPieces = (
  stations: StationLite[],
  genreLabel: (genre: GenreSlug) => string
): OpeningPiece[] =>
  stations.slice(0, 2).map((station) => {
    const genre = stationGenreSlug({ ...station, name: '' });
    return { name: normalizeStationName(station.name), genre: genre ? lowerFirst(genreLabel(genre)) : null };
  });

// Keep the listener's current source, including spoken radio. New offers lead
// with known music; untagged sources are a fallback, never invented genres.
export const liraOpeningStations = (current: StationLite | null, pool: StationLite[]): StationLite[] => {
  const result = current ? [current] : [];
  const music: StationLite[] = [], unknown: StationLite[] = [];
  for (const station of pool) {
    if (station.lastcheckok === 0 || !station.url_resolved) continue;
    const genre = stationGenreSlug({ ...station, name: '' });
    if (!genre) unknown.push(station);
    else if (genreFamilyOfSlug(genre) !== 'talk') music.push(station);
  }
  for (const station of [...music, ...unknown]) {
    if (result.length >= (current ? 3 : 2)) break;
    if (!result.some(item => item.stationuuid === station.stationuuid)) result.push(station);
  }
  return result;
};

export type OpeningWords = {
  first: (name: string) => string;
  second: (name: string) => string;
  genre: (genre: string) => string;
  askTwo: string;
  askOne: string;
  empty: string;
};

export const liraOpeningLine = (pieces: OpeningPiece[], words: OpeningWords): string => {
  if (!pieces.length) return words.empty;
  const clause = (piece: OpeningPiece, lead: (name: string) => string) =>
    `${lead(piece.name)}${piece.genre ? words.genre(piece.genre) : ''}.`;
  const parts = [clause(pieces[0], words.first)];
  if (pieces[1]) parts.push(clause(pieces[1], words.second), words.askTwo);
  else parts.push(words.askOne);
  return parts.join(' ');
};
