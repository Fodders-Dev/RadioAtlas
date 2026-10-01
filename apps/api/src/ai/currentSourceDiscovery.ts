import { sanitizeSnippet } from './untrustedData.js';
import type { ChatTurn, ToolProvider, VerifiedStationRef } from './types.js';

// Closed catalogue vocabulary, not arbitrary metadata interpreted as a prompt.
// These are catalogue relationships, not claims about the currently playing song.
const GENRE_ALIASES: Record<string, string> = {
  jazz: 'jazz', 'smooth jazz': 'jazz', 'vocal jazz': 'jazz', джаз: 'jazz',
  blues: 'blues', блюз: 'blues', soul: 'soul', соул: 'soul', funk: 'funk', фанк: 'funk',
  rock: 'rock', 'classic rock': 'rock', 'alternative rock': 'rock', 'indie rock': 'rock',
  'russian rock': 'rock', рок: 'rock', metal: 'metal', 'heavy metal': 'metal',
  'nu metal': 'metal', 'death metal': 'metal', punk: 'punk', 'post-punk': 'punk',
  pop: 'pop', 'russian pop': 'pop', 'synth pop': 'pop', 'synthpop': 'pop',
  'hip hop': 'hip hop', 'hip-hop': 'hip hop', hiphop: 'hip hop', rap: 'hip hop',
  'r&b': 'r&b', rnb: 'r&b', reggae: 'reggae', ska: 'ska',
  electronic: 'electronic', electronica: 'electronic', edm: 'electronic',
  house: 'house', 'deep house': 'house', 'tech house': 'house', techno: 'techno',
  trance: 'trance', 'psytrance': 'trance', 'drum and bass': 'drum and bass',
  'drum & bass': 'drum and bass', dnb: 'drum and bass',
  ambient: 'ambient', downtempo: 'downtempo', chillout: 'chillout', 'chill out': 'chillout',
  lofi: 'lofi', 'lo-fi': 'lofi', classical: 'classical', классика: 'classical',
  folk: 'folk', world: 'world', country: 'country', latin: 'latin',
  'bossa nova': 'bossa nova', bossa: 'bossa nova', disco: 'disco', dance: 'dance'
};

const normalize = (value: string): string => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
const countryNames = new Map<string, string>();
const regions = new Intl.DisplayNames(['en'], { type: 'region' });
for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
  const code = String.fromCharCode(a, b);
  const name = regions.of(code);
  if (!name || name === code || name === 'Unknown Region' || ['EU', 'EZ', 'UN', 'QO'].includes(code)) continue;
  countryNames.set(normalize(code), normalize(name));
  countryNames.set(normalize(name), normalize(name));
}
const COUNTRY_ALIASES: Record<string, string> = {
  usa: 'united states', 'united states of america': 'united states', uk: 'united kingdom',
  'russian federation': 'russia', 'czech republic': 'czechia',
  'republic of korea': 'south korea', 'korea republic of': 'south korea'
};
export const sourceGenres = (tags: string[]): string[] =>
  [...new Set(tags.map((tag) => {
    const key = normalize(tag);
    return Object.hasOwn(GENRE_ALIASES, key) ? GENRE_ALIASES[key] : undefined;
  }).filter((tag): tag is string => Boolean(tag)))].slice(0, 6);

export const knownSourceCountry = (country: string): string => {
  const value = normalize(country).replace(/^the\s+/, '');
  return countryNames.get(COUNTRY_ALIASES[value] || value) || '';
};

export type SourceDiscoveryAnchor = { stationuuid: string; country: string; genres: string[] };

export const matchesForeignSource = (station: VerifiedStationRef, anchor: SourceDiscoveryAnchor): boolean => {
  const country = knownSourceCountry(station.country);
  return Boolean(country && country !== knownSourceCountry(anchor.country) &&
    station.stationuuid !== anchor.stationuuid && station.url_resolved &&
    sourceGenres(station.tags).some((genre) => anchor.genres.includes(genre)));
};

const OTHER_COUNTRY = /друг(?:ой|ую|ая|ие|их)\s+стран|another\s+country|different\s+countr/i;
const RELATIVE_SOURCE = /похож(?:ее|ую|ие|ую станцию)|в том же духе|как (?:эта|эта станция|сейчас)|так(?:ую|ое) же|similar (?:station|to this)|like this/i;
const SHORT_FOLLOWUP = /^(?:давай|ещ[её](?:\s+(?:один|два|две|три|четыре|пять|[1-5]))?(?:\s+(?:вариант[а-яё]*|станции|эфиры?))?(?:,?\s+предыдущие\s+не\s+повторяй)?|другие|да|yes|more|go ahead)[.!?\s]*$/i;

export const wantsForeignSource = (message: string, history: ChatTurn[] = []): boolean => {
  const text = effectiveSourceRequest(message, history);
  const isRequest = (value: string) => OTHER_COUNTRY.test(value) &&
    (RELATIVE_SOURCE.test(value) || /^(?:а\s+)?(?:из\s+)?(?:другая|другую|другой)\s+стран[а-яё]*[.!?\s]*$/i.test(value) || /^(?:another country|a different country)[.!?\s]*$/i.test(value));
  return isRequest(text);
};

export const effectiveSourceRequest = (message: string, history: ChatTurn[] = []): string => {
  if (!SHORT_FOLLOWUP.test(message.trim())) return message;
  return [...history].reverse().find((turn) => turn.role === 'user' && !SHORT_FOLLOWUP.test(turn.text.trim()))?.text || message;
};

export const referencesCurrentSource = (message: string): boolean =>
  /в том же духе|как (?:эта станция|сейчас)|так(?:ую|ое) же|похож[а-яё]*\s+на\s+(?:эту|текущую)\s+станцию|similar to this|like this/i.test(message) ||
  /^(?:(?:найди|подбери|посоветуй|покажи)\s+)?похож(?:ее|ие|ую станцию)[.!?\s]*$/i.test(message);

// The catalogue cannot confirm energy/vocals or arbitrary compound geography.
// Refuse those extra promises in this lane rather than weakening the request.
export const unsupportedSourceModifier = (message: string): boolean => {
  // Consume the supported request, not a denylist of all possible modifiers.
  // Any leftover semantic text is an extra condition we cannot silently drop.
  const remaining = normalize(message)
    .replace(/на\s+(?:эту|текущую)\s+станцию/gi, ' ')
    .replace(/друг(?:ой|ую|ая|ие|их)\s+стран[а-яё]*|(?:another\s+country|different\s+countries|different\s+country)/gi, ' ')
    .replace(/похож(?:ее|ую|ие)|в том же духе|как (?:эта станция|сейчас)|так(?:ую|ое) же|similar(?:\s+to this)?|like this/gi, ' ')
    .replace(/не\s+(?:включ[а-яё]*|запуск[а-яё]*|проигрыв[а-яё]*)(?:\s+(?:ничего|пока|сейчас|автоматически))*/gi, ' ')
    .replace(/не\s+(?:добав[а-яё]*|сохран[а-яё]*)(?:\s+(?:эту|станцию|текущую))*\s+в\s+(?:очередь|избранное)/gi, ' ')
    .replace(/(?:do not|don['’]t|without)\s+(?:play|start|autoplay|sound)(?:\s+(?:it|yet|now))*/gi, ' ')
    .replace(/(?:do not|don['’]t)\s+(?:add|save)(?:\s+(?:this|station|it))*\s+(?:to|in)\s+(?:the\s+)?(?:queue|favorites)/gi, ' ')
    .replace(/(?:^|[^\p{L}])(?:найди|подбери|посоветуй|покажи|хочу|включи|поставь|поищи|пожалуйста|мне|а|но|из|только|станцию|станции|радио|источники|find|recommend|show|play|please|me|a|some|stations?|radio|from|but)(?=$|[^\p{L}])/giu, ' ')
    // Adjacent filler words may share the boundary consumed by the first pass.
    .replace(/(?:^|[^\p{L}])(?:мне|а|но|из|станцию|станции|радио|please|me|a|some|stations?|radio|from|but)(?=$|[^\p{L}])/giu, ' ');
  return /[\p{L}\p{N}]/u.test(remaining);
};

export const resolveCurrentSource = async (tools: ToolProvider, uuid?: string): Promise<VerifiedStationRef | null> => {
  if (!uuid) return null;
  const station = await tools.getStation(uuid);
  return station?.stationuuid === uuid ? station : null;
};

export const sourceFacts = (station: VerifiedStationRef) => ({
  id: station.stationuuid,
  name: sanitizeSnippet(station.name).replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120),
  country: sanitizeSnippet(station.country).replace(/<[^>]*>/g, '').slice(0, 60),
  genres: sourceGenres(station.tags)
});

export const findForeignSources = async (tools: ToolProvider, source: VerifiedStationRef, excludedIds: string[] = []): Promise<VerifiedStationRef[]> => {
  const anchor: SourceDiscoveryAnchor = {
    stationuuid: source.stationuuid, country: source.country, genres: sourceGenres(source.tags)
  };
  if (!knownSourceCountry(anchor.country) || !anchor.genres.length) return [];
  // Internal provider filter is applied BEFORE its cap; validate again at the
  // brain boundary so even a misbehaving tool cannot introduce unrelated cards.
  const excluded = new Set(excludedIds.slice(0, 128));
  const candidates = await tools.searchStations({ query: '', relatedTo: anchor, excludeStationIds: [...excluded], limit: 8 });
  return [...new Map(candidates.filter((candidate) => !excluded.has(candidate.stationuuid) && matchesForeignSource(candidate, anchor))
    .map((candidate) => [candidate.stationuuid, candidate])).values()].slice(0, 8);
};
