import type { StationLite } from '../types';
import { countryCodeOf } from '../lib/countryName';

export type CalmCountryDeck = {
  key: string;
  country: string;
  countrycode: string;
  stations: StationLite[];
};

const countryKey = (station: StationLite): string => {
  const rawCode = countryCodeOf(station);
  const code = rawCode === 'UK' ? 'GB' : rawCode === 'FX' ? 'FR' : rawCode;
  if (code) return `country:${code}`;
  const name = station.country.trim().toLocaleLowerCase();
  return name ? `name:${name}` : '';
};

const hasPlayableUrl = (station: StationLite) => {
  const value = station.url_resolved?.trim();
  if (!value) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
  } catch {
    return false;
  }
};

// This receives Home's already frozen, recommendation-filtered public pool.
// Country decks are snapshots of that pool, not a new catalogue request.
export const buildCalmCountryDecks = (pool: StationLite[]): CalmCountryDeck[] => {
  const groups = new Map<string, CalmCountryDeck>();
  const seen = new Set<string>();
  for (const station of pool) {
    if (seen.has(station.stationuuid) || station.lastcheckok === 0 || !hasPlayableUrl(station)) continue;
    seen.add(station.stationuuid);
    const key = countryKey(station);
    if (!key) continue;
    let group = groups.get(key);
    if (!group) {
      const rawCode = countryCodeOf(station) || '';
      group = { key, country: station.country.trim(), countrycode: rawCode === 'UK' ? 'GB' : rawCode === 'FX' ? 'FR' : rawCode, stations: [] };
      if (!group.country) continue;
      groups.set(key, group);
    }
    group.stations.push(station);
  }
  return [...groups.values()];
};

// The frozen pool order gives the quick country switch a stable, repeatable
// sequence. It skips the active country and wraps only on explicit invocation.
export const nextCalmCountryDeck = (
  decks: CalmCountryDeck[],
  activeStation: StationLite | null
): CalmCountryDeck | null => {
  if (decks.length < 2) return null;
  const activeKey = activeStation ? countryKey(activeStation) : '';
  const activeIndex = decks.findIndex((deck) => deck.key === activeKey);
  for (let offset = 1; offset <= decks.length; offset += 1) {
    const deck = decks[(activeIndex + offset + decks.length) % decks.length];
    if (deck.key !== activeKey && deck.stations.length) return deck;
  }
  return null;
};
