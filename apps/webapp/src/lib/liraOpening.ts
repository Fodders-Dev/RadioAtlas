// The first line of Лира's section is a musical offer built from what the
// screen really shows — the station on air and the catalogue picks under it —
// and from nothing else. A genre is named only when the station's own tags map
// to a family (`stationGenreFamily`); a station with no readable genre is
// offered by name alone, never dressed in one.
import type { StationLite } from '../types';
import { normalizeStationName } from './stationUtils';
import { stationGenreFamily, type GenreFamily } from './stationGenre';

export type OpeningPiece = { name: string; genre: string | null };

const lowerFirst = (value: string): string => (value ? value[0].toLocaleLowerCase() + value.slice(1) : value);

export const liraOpeningPieces = (
  stations: StationLite[],
  familyLabel: (family: GenreFamily) => string
): OpeningPiece[] =>
  stations.slice(0, 2).map((station) => {
    const family = stationGenreFamily(station);
    return { name: normalizeStationName(station.name), genre: family ? lowerFirst(familyLabel(family)) : null };
  });

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
