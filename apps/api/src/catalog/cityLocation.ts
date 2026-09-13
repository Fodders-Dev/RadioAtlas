import { russianCities } from './russianCities.js';

export type CityLocation = { name: string; lat: number; lon: number; geonameId: number };
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g, 'е')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');

// Country-scoped, exact aliases. A collision means unknown, never "largest wins".
const byName = new Map<string, CityLocation | null>();
for (const [geonameId, name, lat, lon, names] of russianCities) {
  const city = { geonameId, name, lat, lon };
  for (const alias of names) {
    const key = normalize(alias);
    if (key.length < 3) continue;
    const prior = byName.get(key);
    if (prior === null || (prior && prior.geonameId !== geonameId)) byName.set(key, null);
    else byName.set(key, city);
  }
}

export function resolveCityLocation(station: { country?: string; countrycode?: string; state?: string }): CityLocation | null {
  const code = station.countrycode?.trim().toUpperCase();
  if (code ? code !== 'RU' : !['russia', 'russian federation', 'the russian federation', 'россия'].includes(normalize(station.country || ''))) return null;
  const countries = ['ru', 'russia', 'russian federation', 'the russian federation', 'россия', 'российская федерация'];
  let raw = (station.state || '').trim();
  // A country qualifier is safe only when it agrees with this lookup's RU
  // scope. "Moscow (Idaho)" must not silently become Moscow, Russia.
  const qualified = raw.match(/^(.*?)\s*\(([^()]+)\)$/);
  if (qualified && countries.includes(normalize(qualified[2] || ''))) raw = qualified[1] || '';
  const parts = raw.split(',').map(part => part.trim());
  if (parts.length === 2) {
    if (countries.includes(normalize(parts[0] || ''))) raw = parts[1] || '';
    else if (countries.includes(normalize(parts[1] || ''))) raw = parts[0] || '';
  }
  const state = normalize(raw).replace(/^(город|г) /, '');
  if (['volga', 'волга', 'ural', 'урал', 'siberia', 'сибирь'].includes(state)) return null;
  // Do not extract a city token from an oblast, station name or compound field.
  return byName.get(state) || null;
}
