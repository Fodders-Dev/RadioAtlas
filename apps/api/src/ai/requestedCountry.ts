import { knownSourceCountry } from './currentSourceDiscovery.js';

const normalize = (value: string): string => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');

// Curated common Russian country forms follow explicit location prepositions.
// This is intentionally bounded: Intl localized names do not provide reliable
// Russian case forms, and heuristic declension can turn unrelated words into
// country matches. Adjectives such as «японский» are not geographic scope.
const RU_COUNTRIES: Record<string, string> = {
  'япония': 'Japan', 'японии': 'Japan', 'японию': 'Japan', 'японией': 'Japan',
  'франция': 'France', 'франции': 'France', 'францию': 'France', 'францией': 'France',
  'германия': 'Germany', 'германии': 'Germany', 'германию': 'Germany', 'германией': 'Germany',
  'россия': 'Russia', 'россии': 'Russia', 'россию': 'Russia', 'россией': 'Russia',
  'нидерланды': 'Netherlands', 'нидерландах': 'Netherlands', 'нидерландов': 'Netherlands',
  'голландия': 'Netherlands', 'голландии': 'Netherlands', 'голландию': 'Netherlands',
  'великобритания': 'United Kingdom', 'великобритании': 'United Kingdom', 'великобританию': 'United Kingdom',
  'британия': 'United Kingdom', 'британии': 'United Kingdom', 'британию': 'United Kingdom',
  'сша': 'United States', 'америка': 'United States', 'америке': 'United States', 'америки': 'United States',
  'канада': 'Canada', 'канаде': 'Canada', 'канаду': 'Canada', 'канады': 'Canada',
  'дания': 'Denmark', 'дании': 'Denmark', 'данию': 'Denmark',
  'италия': 'Italy', 'италии': 'Italy', 'италию': 'Italy',
  'испания': 'Spain', 'испании': 'Spain', 'испанию': 'Spain',
  'португалия': 'Portugal', 'португалии': 'Portugal', 'португалию': 'Portugal',
  'австралия': 'Australia', 'австралии': 'Australia', 'австралию': 'Australia',
  'бразилия': 'Brazil', 'бразилии': 'Brazil', 'бразилию': 'Brazil',
  'мексика': 'Mexico', 'мексике': 'Mexico', 'мексики': 'Mexico',
  'индия': 'India', 'индии': 'India', 'индию': 'India',
  'китай': 'China', 'китае': 'China', 'китая': 'China',
  'таиланд': 'Thailand', 'таиланда': 'Thailand', 'таиланде': 'Thailand',
  'южная корея': 'South Korea', 'южной кореи': 'South Korea', 'южной корее': 'South Korea', 'южную корею': 'South Korea',
  'швеция': 'Sweden', 'швеции': 'Sweden', 'швецию': 'Sweden',
  'норвегия': 'Norway', 'норвегии': 'Norway', 'норвегию': 'Norway',
  'финляндия': 'Finland', 'финляндии': 'Finland', 'финляндию': 'Finland',
  'польша': 'Poland', 'польше': 'Poland', 'польшу': 'Poland',
  'украина': 'Ukraine', 'украине': 'Ukraine', 'украину': 'Ukraine',
  'турция': 'Turkey', 'турции': 'Turkey', 'турцию': 'Turkey',
  'аргентина': 'Argentina', 'аргентине': 'Argentina', 'аргентину': 'Argentina',
  'ирландия': 'Ireland', 'ирландии': 'Ireland', 'ирландию': 'Ireland',
  'бельгия': 'Belgium', 'бельгии': 'Belgium', 'бельгию': 'Belgium',
  'швейцария': 'Switzerland', 'швейцарии': 'Switzerland', 'швейцарию': 'Switzerland',
  'австрия': 'Austria', 'австрии': 'Austria', 'австрию': 'Austria',
  'чехия': 'Czechia', 'чехии': 'Czechia', 'чехию': 'Czechia',
  'греция': 'Greece', 'греции': 'Greece', 'грецию': 'Greece',
  'израиль': 'Israel', 'израиле': 'Israel', 'израиля': 'Israel',
  'новая зеландия': 'New Zealand', 'новой зеландии': 'New Zealand', 'новую зеландию': 'New Zealand'
};

const regions = new Intl.DisplayNames(['en'], { type: 'region' });
const EN_COUNTRIES = new Map<string, string>();
for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
  const code = String.fromCharCode(a, b);
  const name = regions.of(code);
  if (!name || name === code || name === 'Unknown Region' || ['EU', 'EZ', 'UN', 'QO'].includes(code)) continue;
  EN_COUNTRIES.set(normalize(name), name);
}
for (const alias of ['USA', 'United States of America', 'UK', 'Russia', 'The Netherlands', 'Czech Republic', 'United Kingdom of Great Britain and Northern Ireland']) {
  const key = alias.toLowerCase() === 'usa' || alias === 'United States of America' ? 'United States'
    : alias === 'UK' || alias === 'United Kingdom of Great Britain and Northern Ireland' ? 'United Kingdom'
      : alias === 'Russia' ? 'Russia' : alias === 'Czech Republic' ? 'Czechia'
        : 'Netherlands';
  EN_COUNTRIES.set(normalize(alias), key);
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const englishNames = [...EN_COUNTRIES.keys()].sort((a, b) => b.length - a.length).map(escapeRegex).join('|');
const EN_LOCATION = new RegExp(`\\b(?:from|in)\\s+(?:the\\s+)?(${englishNames})\\b`, 'giu');
const RU_NAMES = Object.keys(RU_COUNTRIES).sort((a, b) => b.length - a.length).map(escapeRegex).join('|');
const RU_LOCATION = new RegExp(`(?:^|[^\\p{L}])(?:из|в|по)\\s+(${RU_NAMES})(?=$|[^\\p{L}])`, 'giu');
const NEGATED_LOCATION = /(?:не\s+(?:из|в|по|from|in)\s+|not\s+(?:from|in|из|в|по)\s+(?:the\s+)?|never\s+(?:from|in)\s+(?:the\s+)?|без(?:\s+\p{L}+){0,3}\s+(?:из|в|по|from|in)\s+(?:the\s+)?|without(?:\s+\p{L}+){0,3}\s+(?:from|in)\s+(?:the\s+)?|кроме\s+)$/iu;
const LIST_JOIN = /^(?:\s|,|;|\band\b|\bor\b|\bи\b|\bили\b|\/|\bvs\.?\b|\bversus\b|\bfrom\b|\bin\b|из|в|по)*$/iu;
type Match = { start: number; end: number; country: string };

export const requestedCountry = (message: string): string | undefined => {
  const matches: Match[] = [];
  for (const match of message.matchAll(EN_LOCATION)) {
    const name = match[1];
    if (!name) continue;
    const start = match.index ?? 0;
    const locationStart = start + match[0].lastIndexOf(name);
    const prefix = message.slice(Math.max(0, locationStart - 32), locationStart);
    if (NEGATED_LOCATION.test(prefix)) continue;
    const key = normalize(name);
    const country = EN_COUNTRIES.get(key);
    if (country) matches.push({ start: locationStart, end: locationStart + name.length, country });
  }
  for (const match of message.matchAll(RU_LOCATION)) {
    const name = match[1];
    if (!name) continue;
    const start = match.index ?? 0;
    const locationStart = start + match[0].lastIndexOf(name);
    const prefix = message.slice(Math.max(0, locationStart - 32), locationStart);
    if (NEGATED_LOCATION.test(prefix)) continue;
    const country = RU_COUNTRIES[normalize(name)];
    if (country) matches.push({ start: locationStart, end: locationStart + name.length, country });
  }
  matches.sort((a, b) => a.start - b.start);
  if (!matches.length) return undefined;
  const lastMention = matches.at(-1)!;
  const unscopedListItem = new RegExp(`^\\s*(?:,|and|or|и|или|/|vs\\.?|versus)\\s+(?:the\\s+)?(?:${englishNames}|${RU_NAMES})(?=$|[^\\p{L}])`, 'iu');
  if (unscopedListItem.test(message.slice(lastMention.end))) return undefined;
  const distinct = [...new Set(matches.map((match) => match.country))];
  if (distinct.length > 1) {
    const last = matches.at(-1)!;
    const previousDifferent = [...matches].reverse().find((match) => match.country !== last.country)!;
    const between = message.slice(previousDifferent.end, last.start);
    // A later explicit scope replaces earlier context; joined lists and
    // comparisons do not identify one country reliably.
    if (LIST_JOIN.test(between)) return undefined;
  }
  const canonical = matches.at(-1)!.country;
  return knownSourceCountry(canonical) ? canonical : undefined;
};

export const matchesRequestedCountry = (stationCountry: string, requested: string): boolean => {
  const canonicalize = (country: string): string => {
    const value = normalize(country).replace(/^the\s+/, '');
    if (value === 'united kingdom of great britain and northern ireland') return 'united kingdom';
    return knownSourceCountry(country);
  };
  const actual = canonicalize(stationCountry);
  return Boolean(actual && actual === canonicalize(requested));
};

// Only one shared trailing country clause can be removed for a closed grammar.
// Per-slot countries, lists, negations and extra conditions remain unconsumed.
export const omitSharedCountrySuffix = (message: string): string => {
  const matches = [...message.matchAll(EN_LOCATION), ...message.matchAll(RU_LOCATION)];
  if (matches.length !== 1 || !requestedCountry(message)) return message;
  const match = matches[0]!;
  const end = (match.index || 0) + match[0].length;
  const tail = message.slice(end).replace(/не\s+включай|(?:do not|don't|don’t)\s+play/giu, '');
  if (/[\p{L}\p{N}]/u.test(tail)) return message;
  return message.slice(0, match.index) + ' ' + message.slice(end);
};
