import { normalizeGenreTag, stationGenreFamily } from '../catalog/genreFamily.js';
import { catalogueTagEvidence } from './catalogueTagEvidence.js';
import { sourceGenres } from './currentSourceDiscovery.js';
import type { VerifiedStationRef } from './types.js';

// A bounded latest-turn override, not a general intent detector. Only explicit
// style-switch/refinement clauses with an entirely known genre may override the
// earlier positive request. Country/exclusions/count still use their own context.
const SPELLINGS = new Map([
  ['джаз','jazz'], ['рок','rock'], ['фанк','funk'], ['соул','soul'], ['блюз','blues'],
  ['хаус','house'], ['эмбиент','ambient'], ['классика','classical'], ['регги','reggae'],
  ['поп','pop'], ['хип хоп','hip hop'], ['hiphop','hip hop'], ['электроника','electronic'],
  ['dnb','drum and bass'], ['drum bass','drum and bass'], ['drum n bass','drum and bass'], ["drum 'n' bass",'drum and bass']
]);
export const normalizeRefinementGenre = (text: string): string => {
  const label = normalizeGenreTag(text);
  const spelling = SPELLINGS.get(label);
  if (spelling) return spelling;
  const alias = sourceGenres([text])[0];
  return alias && !stationGenreFamily(label) ? alias : label;
};

export const declinesStationRecommendations = (message: string): boolean =>
  /(?:^|[.!?]\s*)не\s+(?:подбирай|ищи|рекомендуй|предлагай|советуй)\s+(?:станци[а-яё]*|радио|новую\s+подборку)[.!?\s]*$/iu.test(message) ||
  /^не\s+(?:предлагай|подбирай|ищи)\s+друг(?:ой|ое)\s+(?:стиль|жанр)(?:\s*[:—–-]\s*|\s+на\s+)/iu.test(message);

export const requestedGenreRefinement = (message: string): string | undefined => {
  if (declinesStationRecommendations(message)) return undefined;
  const match = message.match(/^(?:а\s+)?(?:(?:совсем|давай)\s+)?(?:друг(?:ой|ое)\s+(?:стиль|жанр)|сменим\s+(?:стиль|жанр))(?:\s*[:—–-]\s*|\s+на\s+)([^.,;!?\n]+)/iu)
    ?? message.match(/^(?:а\s+)?(?:теперь|ближе\s+к|больше)\s+([^.,;!?\n]+)/iu);
  if (!match?.[1]) return undefined;
  const label = normalizeRefinementGenre(match[1].trim());
  return label && stationGenreFamily(label) && stationGenreFamily(label) !== 'talk' ? label : undefined;
};

export const matchesGenreRefinement = (station: VerifiedStationRef, genre: string): boolean =>
  catalogueTagEvidence(station).some(tag => normalizeRefinementGenre(tag) === genre);
