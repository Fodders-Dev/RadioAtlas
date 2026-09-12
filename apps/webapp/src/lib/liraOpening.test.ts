import { describe, expect, it } from 'vitest';
import type { StationLite } from '../types';
import { liraOpeningLine, liraOpeningPieces, liraOpeningStations } from './liraOpening';

const station = (over: Partial<StationLite>): StationLite =>
  ({
    stationuuid: 'x',
    name: 'FIP',
    url: '',
    url_resolved: 'https://example.test/x',
    homepage: '',
    favicon: '',
    tags: '',
    country: 'France',
    countrycode: 'FR',
    language: '',
    codec: '',
    bitrate: 0,
    lastcheckok: 1,
    geo_lat: null,
    geo_long: null,
    ...over
  }) as StationLite;

const label = (genre: string) => ({ jazz: 'Джаз', electronic: 'Электроника', sports: 'Спорт' })[genre] ?? genre;

const words = {
  first: (name: string) => `Можно начать с ${name}`,
  second: (name: string) => `Или свернуть к ${name}`,
  genre: (genre: string) => ` — там ${genre}`,
  askTwo: 'Какой поворот выбираем?',
  askOne: 'Или спросите о своём.',
  empty: 'пусто'
};

describe('liraOpening', () => {
  it('names only a genre supported by the tags, not the whole map family', () => {
    // Mutation this answers: a default genre word for an untagged station
    // would put a genre in Лира's mouth that no data supports.
    const pieces = liraOpeningPieces(
      [station({ name: 'FIP', tags: 'jazz,soul' }), station({ name: 'Radio Meuh', tags: 'local music' })],
      label
    );
    expect(pieces).toEqual([
      { name: 'FIP', genre: 'джаз' },
      { name: 'Radio Meuh', genre: null }
    ]);
    expect(liraOpeningLine(pieces, words)).toBe(
      'Можно начать с FIP — там джаз. Или свернуть к Radio Meuh. Какой поворот выбираем?'
    );
  });

  it('offers one station without a choice, and nothing invented with none', () => {
    expect(liraOpeningLine(liraOpeningPieces([station({ name: 'Gong', tags: 'electronic' })], label), words)).toBe(
      'Можно начать с Gong — там электроника. Или спросите о своём.'
    );
    expect(liraOpeningLine([], words)).toBe('пусто');
  });

  it('takes at most two stations', () => {
    const three = [station({ name: 'A' }), station({ name: 'B' }), station({ name: 'C' })];
    expect(liraOpeningPieces(three, label).map((piece) => piece.name)).toEqual(['A', 'B']);
  });

  it('does not turn sports into news or infer a genre from a name', () => {
    expect(liraOpeningPieces([station({ tags: 'sports' }), station({ name: 'Nightride FM', tags: '' })], label)
      .map(piece => piece.genre)).toEqual(['спорт', null]);
  });

  it('keeps the current spoken source but offers known music before untagged sources', () => {
    const talk = station({ stationuuid: 'talk', tags: 'sports' });
    const unknown = station({ stationuuid: 'unknown' });
    const jazz = station({ stationuuid: 'jazz', tags: 'jazz' });
    const rock = station({ stationuuid: 'rock', tags: 'rock' });
    const broken = station({ stationuuid: 'broken', tags: 'pop', lastcheckok: 0 });
    const pool = [talk, unknown, broken, jazz, jazz, rock];
    expect(liraOpeningStations(talk, pool).map(s => s.stationuuid)).toEqual(['talk', 'jazz', 'rock']);
    expect(liraOpeningStations(null, pool).map(s => s.stationuuid)).toEqual(['jazz', 'rock']);
    expect(liraOpeningStations(null, [talk, unknown]).map(s => s.stationuuid)).toEqual(['unknown']);
  });
});
