import { catalogueTagEvidence } from './catalogueTagEvidence.js';
import { sourceFacts, sourceGenres } from './currentSourceDiscovery.js';
import type { VerifiedStationRef } from './types.js';

const MAX_COMPARISON_TAGS = 80;
const MAX_DISPLAY_LABELS = 6;
const normalize = (value: string) => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');

// Only reviewed labels get subtype wording. Each one is still checked through
// the closed sourceGenres vocabulary before it can become evidence.
const SUBGENRE_FAMILIES: Record<string, string> = {
  'smooth jazz': 'jazz', 'vocal jazz': 'jazz',
  'classic rock': 'rock', 'alternative rock': 'rock', 'indie rock': 'rock', 'russian rock': 'rock',
  'deep house': 'house', 'tech house': 'house',
  'heavy metal': 'metal', 'nu metal': 'metal', 'death metal': 'metal',
  'post-punk': 'punk', 'synth pop': 'pop', synthpop: 'pop', 'russian pop': 'pop',
  'psytrance': 'trance'
};
const SUBGENRE_LABELS: Record<string, string> = { synthpop: 'synth pop' };

type Profile = { families: Set<string>; subgenres: Map<string, string> };

const profile = (station: VerifiedStationRef): Profile => {
  const families = new Set<string>();
  const subgenres = new Map<string, string>();
  for (const tag of catalogueTagEvidence(station).slice(0, MAX_COMPARISON_TAGS)) {
    const family = sourceGenres([tag])[0];
    if (!family) continue;
    families.add(family);
    const label = normalize(tag);
    if (SUBGENRE_FAMILIES[label] === family) subgenres.set(SUBGENRE_LABELS[label] || label, family);
  }
  return { families, subgenres };
};

const ownLabels = ({ families, subgenres }: Profile): string[] => {
  const coveredFamilies = new Set(subgenres.values());
  return [...subgenres.keys(), ...[...families].filter(family => !coveredFamilies.has(family))]
    .slice(0, MAX_DISPLAY_LABELS);
};

export const describeSourceComparison = (
  first: VerifiedStationRef,
  second: VerifiedStationRef,
  english: boolean
): string => {
  const rows = [first, second];
  const profiles = rows.map(profile);
  const facts = rows.map(sourceFacts);
  const stationLines = rows.map((_row, index) => {
    const fact = facts[index]!;
    const genres = ownLabels(profiles[index]!);
    const name = english ? `“${fact.name}”` : `«${fact.name}»`;
    const country = fact.country ? ` (${fact.country})` : '';
    const genreText = genres.length ? genres.join(', ') : (english ? 'not enough genre information' : 'недостаточно данных о жанре');
    return `${name}${country} — ${genreText}.`;
  });

  const [a, b] = profiles as [Profile, Profile];
  const sharedSubgenres = [...a.subgenres.keys()].filter(label => b.subgenres.has(label));
  const sharedFamilies = [...a.families].filter(family => b.families.has(family));
  const exactFamiliesCovered = new Set(sharedSubgenres.map(label => a.subgenres.get(label)!));
  const subtypeFamilies = new Set([...a.subgenres.values(), ...b.subgenres.values()]);
  const sharedSubtypeFamilies = sharedFamilies.filter(family => subtypeFamilies.has(family) && !exactFamiliesCovered.has(family));
  const shared = [...sharedSubgenres, ...sharedSubtypeFamilies,
    ...sharedFamilies.filter(family => !exactFamiliesCovered.has(family) && !subtypeFamilies.has(family))]
    .slice(0, MAX_DISPLAY_LABELS);
  const bothHaveGenres = a.families.size > 0 && b.families.size > 0;

  let relation: string;
  if (shared.length) {
    relation = english ? `Shared catalogue genres: ${shared.join(', ')}.` : `Общие жанры каталога: ${shared.join(', ')}.`;
  } else if (!bothHaveGenres) {
    relation = english
      ? 'There is not enough catalogue genre information to compare them.'
      : 'В каталоге недостаточно жанровых данных для сравнения.';
  } else {
    relation = english
      ? 'The recognized catalogue genre labels do not overlap.'
      : 'Распознанные жанровые метки каталога не пересекаются.';
  }
  const footer = english
    ? "I compare catalogue formats, not the music in either live programme."
    : 'Сравниваю формат по каталогу, а не музыку в эфире.';
  return `${stationLines.join('\n')}\n${relation} ${footer}`;
};
