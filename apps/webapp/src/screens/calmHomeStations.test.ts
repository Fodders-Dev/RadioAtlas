import { describe, expect, it } from 'vitest';
import type { StationLite } from '../types';
import { buildCalmCountryDecks, nextCalmCountryDeck } from './calmHomeStations';

const station = (stationuuid: string, country: string, countrycode = '', overrides: Partial<StationLite> = {}): StationLite & { countrycode: string } => ({
  stationuuid, name: stationuuid, url: `https://radio.example/${stationuuid}`, url_resolved: `https://radio.example/${stationuuid}`,
  homepage: '', favicon: '', tags: '', country, countrycode, state: '', language: '', codec: 'MP3', bitrate: 128,
  geo_lat: null, geo_long: null, ...overrides
});

describe('calm Home country decks', () => {
  it('groups by country code, normalizes codes, and preserves eligible pool order without duplicates', () => {
    const pool = [
      station('first', 'United Kingdom', 'gb'),
      station('first', 'United Kingdom', 'GB'),
      station('uk-alias', 'The United Kingdom Of Great Britain And Northern Ireland', 'UK'),
      station('france', 'France', 'fx'),
      station('france-fr', 'France', 'FR'),
      station('france-name', 'France', ''),
      station('down', 'Germany', 'DE', { lastcheckok: 0 }),
      station('bad-url', 'Italy', 'IT', { url_resolved: 'javascript:alert(1)' }),
      station('invalid-host', 'Spain', 'ES', { url_resolved: 'https:///' }),
      station('no-country', '', '')
    ];
    const decks = buildCalmCountryDecks(pool);
    expect(decks.map((deck) => deck.key)).toEqual(['country:GB', 'country:FR']);
    expect(decks[1].countrycode).toBe('FR');
    expect(decks[0].stations.map((item) => item.stationuuid)).toEqual(['first', 'uk-alias']);
    expect(decks[1].stations.map((item) => item.stationuuid)).toEqual(['france', 'france-fr', 'france-name']);
  });

  it('returns the next different country in stable order and wraps on explicit selection', () => {
    const pool = [station('de', 'Germany', 'DE'), station('fr', 'France', 'FR'), station('it', 'Italy', 'IT')];
    const decks = buildCalmCountryDecks(pool);
    expect(nextCalmCountryDeck(decks, pool[0])?.key).toBe('country:FR');
    expect(nextCalmCountryDeck(decks, station('fr-alias', 'France', 'FX'))?.key).toBe('country:IT');
    expect(nextCalmCountryDeck(decks, pool[2])?.key).toBe('country:DE');
    expect(nextCalmCountryDeck(decks, null)?.key).toBe('country:DE');
    expect(nextCalmCountryDeck(decks.slice(0, 1), pool[0])).toBeNull();
  });
});
