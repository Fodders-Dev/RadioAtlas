import { describe, expect, it } from 'vitest';
import { countryCodeOf, localizedCountry } from './countryName';

describe('localizedCountry', () => {
  it('prefers the station code and speaks the listener language', () => {
    expect(localizedCountry({ country: 'Greece', countrycode: 'GR' }, 'ru')).toBe('Греция');
    expect(localizedCountry({ country: 'Greece', countrycode: 'gr' }, 'en')).toBe('Greece');
  });

  it('recovers the code from Radio Browser official English names when the code is missing', () => {
    expect(countryCodeOf({ country: 'The Philippines' })).toBe('PH');
    expect(countryCodeOf({ country: 'The United Kingdom Of Great Britain And Northern Ireland' })).toBe('GB');
    expect(localizedCountry({ country: 'The United Kingdom Of Great Britain And Northern Ireland' }, 'ru')).toBe('Великобритания');
    expect(localizedCountry({ country: 'The Philippines', countrycode: '' }, 'ru')).toBe('Филиппины');
  });

  it('keeps the raw name when nothing is recognisable — never a guess', () => {
    // Mutation this answers: a "closest match" would turn an unknown place
    // into a real country on a card.
    expect(countryCodeOf({ country: 'Pirate Bay Broadcasting' })).toBeNull();
    expect(localizedCountry({ country: 'Pirate Bay Broadcasting' }, 'ru')).toBe('Pirate Bay Broadcasting');
    expect(localizedCountry({ country: '' }, 'ru')).toBe('');
  });
});
