import { describe, expect, it } from 'vitest';
import type { StationLite } from '../types';
import {
  formatCountryLabel,
  normalizeStationName,
  stationLocation,
  stationTags
} from './stationUtils';

describe('normalizeStationName — encoder metadata', () => {
  // Real rows from artifacts/catalog-full.json. Radio Browser keeps the encoder
  // settings in the display name; 4.0% of the catalogue carries a codec token.
  it('drops a bracket whose entire content is technical', () => {
    expect(normalizeStationName('VIP Radio (MP3)')).toBe('VIP Radio');
    expect(normalizeStationName('Wave FM - Wollongong - 96.5 FM (AAC)')).toBe(
      'Wave FM - Wollongong - 96.5 FM'
    );
    expect(normalizeStationName('RadioBOB Rock Hits (64 kbps AAC)')).toBe('RadioBOB Rock Hits');
    expect(normalizeStationName('SWR 2  [AAC 96k]')).toBe('SWR 2');
    expect(normalizeStationName('Kontrafunk (AAC 64)')).toBe('Kontrafunk');
    expect(normalizeStationName('Antenne Saar (56 kbit/s)')).toBe('Antenne Saar');
  });

  it('drops a trailing technical run after a separator', () => {
    expect(normalizeStationName('Deutschlandfunk | DLF | MP3 128k')).toBe('Deutschlandfunk | DLF');
    expect(normalizeStationName('Radio Beat 128 MP3')).toBe('Radio Beat');
    expect(normalizeStationName('Radio Paradise Main Mix (EU) 320k AAC')).toBe(
      'Radio Paradise Main Mix (EU)'
    );
    expect(normalizeStationName('radio 3 | rbb | LQ')).toBe('radio 3 | rbb');
    expect(normalizeStationName('la cordobesa 96.0 link alterno')).toBe('la cordobesa 96.0');
  });

  it('KEEPS a bracket that carries meaning', () => {
    expect(normalizeStationName('Radio Paradise Main Mix (EU)')).toBe('Radio Paradise Main Mix (EU)');
    expect(normalizeStationName('Vibe FM (Guadalajara)')).toBe('Vibe FM (Guadalajara)');
    expect(normalizeStationName('Schwarzwaldradio (AAC, New Stream URL as of 2023)')).toBe(
      'Schwarzwaldradio (AAC, New Stream URL as of 2023)'
    );
  });

  // ⚠ The whole risk of this change. A number in a station name is usually the
  // station's IDENTITY, and the catalogue is full of «Radio NNN» rows.
  it('never eats a number that is the station name', () => {
    for (const name of ['Radio 538', 'Radio 357', 'Radio 10', 'Radio 105', 'Radio 80', 'Радио 7']) {
      expect(normalizeStationName(name)).toBe(name);
    }
    // A codec may follow the identity number without taking it along.
    expect(normalizeStationName('Radio 538 MP3')).toBe('Radio 538');
    // 320 IS on the bitrate ladder, but it is not trailing-technical here.
    expect(normalizeStationName('Studio 320')).toBe('Studio 320');
  });

  // Found by diffing the new output against the old one over all 61 481 rows.
  // An earlier draft trimmed trailing separators unconditionally and ate the
  // closing half of symmetric decoration.
  it('keeps decorative separators when nothing technical was removed', () => {
    expect(normalizeStationName('-=PoWeR=-')).toBe('-=PoWeR=-');
    expect(normalizeStationName('-=- Relax-FM -=-')).toBe('-=- Relax-FM -=-');
    expect(normalizeStationName('| COBrOx.RADiO.fm |')).toBe('| COBrOx.RADiO.fm |');
    expect(normalizeStationName('Dark Radio - Die Darkzone im Netz -')).toBe(
      'Dark Radio - Die Darkzone im Netz -'
    );
  });

  it('leaves frequencies and dash tails alone (9.8% and 14.4% of the catalogue)', () => {
    expect(normalizeStationName('Авторадио 90.3 FM')).toBe('Авторадио 90.3 FM');
    expect(normalizeStationName('Europa Plus 101.7')).toBe('Europa Plus 101.7');
    expect(normalizeStationName('Radio Nova - Dublin')).toBe('Radio Nova - Dublin');
    expect(normalizeStationName('Radio Blue Mountains - Katoomba - 89.1 FM')).toBe(
      'Radio Blue Mountains - Katoomba - 89.1 FM'
    );
  });

  it('does not strip a technical word that is the real name', () => {
    expect(normalizeStationName('MP3')).toBe('MP3');
    expect(normalizeStationName('Radio Mirror')).toBe('Radio Mirror');
    // «High»/«Low» are deliberately not treated as quality markers.
    expect(normalizeStationName('High Energy Radio')).toBe('High Energy Radio');
    // Found by scanning the real catalogue, not by thinking: Opus is a codec AND
    // a station. LRT runs Radijas / Klasika / Opus, so «LRT» alone is ambiguous.
    expect(normalizeStationName('LRT Opus')).toBe('LRT Opus');
    // «Radio 24» keeps its number even though 24 is on the bitrate ladder,
    // because a bare number is never strong enough on its own.
    expect(normalizeStationName('Radio 24')).toBe('Radio 24');
  });
});

describe('normalizeStationName', () => {
  it('trims leading underscores and spaces', () => {
    expect(normalizeStationName('___80 EXITOS')).toBe('80 EXITOS');
    expect(normalizeStationName('   Radio One')).toBe('Radio One');
  });

  it('trims trailing underscores and spaces', () => {
    expect(normalizeStationName('Radio One___')).toBe('Radio One');
    expect(normalizeStationName('Radio One   ')).toBe('Radio One');
  });

  it('collapses runs of whitespace and underscores', () => {
    expect(normalizeStationName('Radio    Salü')).toBe('Radio Salü');
  });

  it('drops a single underscore that hugs a space', () => {
    // PR-4: "CHRISTMAS CHOR_ by" -> "CHRISTMAS CHOR by"
    expect(normalizeStationName('CHRISTMAS CHOR_ by')).toBe('CHRISTMAS CHOR by');
    expect(normalizeStationName('by _CHRISTMAS')).toBe('by CHRISTMAS');
    expect(normalizeStationName('Jazz __ Cool')).toBe('Jazz Cool');
    expect(normalizeStationName('  __80__  EXITOS  ')).toBe('80 EXITOS');
  });

  it('preserves an underscore between word characters', () => {
    expect(normalizeStationName('LO_FI')).toBe('LO_FI');
    expect(normalizeStationName('DEEP_HOUSE FM')).toBe('DEEP_HOUSE FM');
  });

  it('handles empty / nullish input', () => {
    expect(normalizeStationName('')).toBe('');
    expect(normalizeStationName(undefined)).toBe('');
    expect(normalizeStationName(null)).toBe('');
    expect(normalizeStationName('___')).toBe('');
    expect(normalizeStationName('   ')).toBe('');
  });

  it('leaves an already-clean name unchanged', () => {
    expect(normalizeStationName('BBC Radio 6 Music')).toBe('BBC Radio 6 Music');
  });
});

describe('station display fallbacks', () => {
  const station = {
    stationuuid: 'station',
    name: 'Station',
    country: '',
    state: '',
    tags: ''
  } as StationLite;

  it('lets localized callers supply empty-state copy', () => {
    expect(stationLocation(station, 'Локация не указана')).toBe('Локация не указана');
    expect(stationTags(station, '')).toBe('');
  });

  it('shortens verbose catalog country names for display', () => {
    expect(formatCountryLabel('The United Kingdom Of Great Britain And Northern Ireland')).toBe(
      'United Kingdom'
    );
  });
});
