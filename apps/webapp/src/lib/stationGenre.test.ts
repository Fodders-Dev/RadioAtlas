import { describe, expect, it } from 'vitest';
import { GENRE_SLUGS, stationGenreSlug } from './stationGenre';

const station = (tags: string, name = 'Some Station') =>
  ({ name, tags, url_resolved: '', url: '', homepage: '' }) as never;

describe('stationGenreSlug', () => {
  it('recognises a plain genre tag', () => {
    expect(stationGenreSlug(station('jazz'))).toBe('jazz');
    expect(stationGenreSlug(station('pop,top 40'))).toBe('pop');
  });

  it('normalises punctuation and case', () => {
    expect(stationGenreSlug(station('Hip-Hop'))).toBe('hipHop');
    expect(stationGenreSlug(station('  DEEP   HOUSE '))).toBe('deepHouse');
  });

  it('folds the decade spellings the catalogue really carries', () => {
    for (const tag of ['80s', "80's", '1980s', '80er']) {
      expect(stationGenreSlug(station(tag))).toBe('eighties');
    }
  });

  it('strips decoration around a genre word', () => {
    expect(stationGenreSlug(station('jazz radio'))).toBe('jazz');
    expect(stationGenreSlug(station('blues music'))).toBe('blues');
    expect(stationGenreSlug(station('the blues'))).toBe('blues');
  });

  // Broadcasters lead with a business word far more often than with the music.
  it('scans past a business tag to the music behind it', () => {
    expect(stationGenreSlug(station('entretenimiento,hits,reggaeton'))).toBe('hits');
    expect(stationGenreSlug(station('commercial,local radio,rock'))).toBe('rock');
  });

  // ⚠ The map IS the filter: anything unrecognised yields null so the caller can
  // fall back to «Прямой эфир». Nothing unrecognised is ever shown to a listener.
  describe('junk from the real catalogue yields nothing', () => {
    it.each([
      ['❤️'],
      ['généraliste'],
      ['full service'],
      ['iheart'],
      ['discography'],
      ['1.fm'],
      ['#'],
      ['78'],
      ['']
    ])('«%s» is not a genre', (tag) => {
      expect(stationGenreSlug(station(tag))).toBeNull();
    });

    it('a station with no tags at all yields nothing', () => {
      expect(stationGenreSlug({ name: 'X' } as never)).toBeNull();
      expect(stationGenreSlug(null)).toBeNull();
    });
  });

  // ⚠⚠ Radio Browser tags Quran recitation «classical» — 64 of the 108 stations
  // whose name says Quran carry exactly that tag. Announcing recitation of
  // scripture as a music genre is not a rounding error, so the name wins.
  describe('the station name overrides a tag that would misrepresent it', () => {
    it.each([
      ['إذاعة القرآن الكريم', 'classical'],
      ['#radio quran', 'classical'],
      ['Quran Radio Station-Nablus', ''],
      ['Saudi Quran', 'islam'],
      ['Радио Коран', 'classical']
    ])('«%s» is recitation, not a genre', (name, tags) => {
      expect(stationGenreSlug(station(tags, name))).toBe('quran');
    });

    it('does not claim a station that merely contains the letters', () => {
      expect(stationGenreSlug(station('rock', 'Corandum Rock'))).toBe('rock');
      expect(stationGenreSlug(station('jazz', 'Koranga Jazz'))).toBe('jazz');
    });
  });

  it('every slug the resolver can return is in the exported list', () => {
    // Guards the locale contract: the caller renders `genre.<slug>`, so a slug
    // outside this list would surface as a raw i18n key on screen.
    const slugs = new Set<string>(GENRE_SLUGS);
    for (const tag of ['jazz', 'deep house', 'quran', '80s', 'adult contemporary']) {
      const slug = stationGenreSlug(station(tag));
      expect(slug).not.toBeNull();
      expect(slugs.has(slug as string)).toBe(true);
    }
  });
});
