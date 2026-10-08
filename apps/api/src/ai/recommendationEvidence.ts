import { normalizeGenreTag, stationGenreFamily } from '../catalog/genreFamily.js';
import { catalogueTagEvidence } from './catalogueTagEvidence.js';
import { sourceGenres } from './currentSourceDiscovery.js';
import { normalizeRefinementGenre } from './genreRefinement.js';
import type { JsonSchemaOutput } from './modelClient.js';
import type { VerifiedStationRef } from './types.js';

type Evidence = { key: string; label: string; genre: string };
type CardEvidence = { stationId: string; evidence: Evidence[] };
const MAX_PROJECTED_TAGS = 12;
const DNB_STYLES = new Set(['liquid dnb', 'liquid drum and bass', 'neurofunk', 'tech step']);
const REVIEWED_FORMAT_GENRES = new Map([
  ['breakbeat', 'breakbeat'], ['breaks', 'breakbeat'], ['breakcore', 'breakcore'],
  ['industrial', 'industrial'], ['industrial music', 'industrial'], ['industrial techno', 'industrial techno'], ['ebm', 'ebm']
]);
// Translate only reviewed catalogue genres into a short listener-facing
// explanation. The labels themselves remain on the cards; this copy conveys
// their musical relationship without repeating station names, tags or country.
const STYLE_EXPLANATIONS = new Map<string, string>([
  ['drum and bass', 'плотный басовый ритм'],
  ['liquid dnb', 'мягкий, мелодичный уклон'],
  ['liquid drum and bass', 'мягкий, мелодичный уклон'],
  ['neurofunk', 'жёсткий басовый уклон'],
  ['tech step', 'жёсткий басовый уклон'],
  ['synthwave', 'ретро-электронное настроение'],
  ['downtempo', 'неторопливый, спокойный характер'],
  ['ambient', 'атмосферный, созерцательный оттенок'],
  ['shoegaze', 'размытые гитарные фактуры'],
  ['house', 'ритмичное танцевальное направление'],
  ['deep house', 'глубокое, плавное танцевальное направление'],
  ['progressive house', 'развивающееся, танцевальное направление'],
  ['breakcore', 'резкие, дробные электронные ритмы'],
  ['industrial techno', 'жёсткий индустриальный характер'],
  ['jungle', 'быстрые ломаные ритмы'],
  ['breakbeat', 'упругие ломаные ритмы'],
  ['industrial', 'жёсткий индустриальный характер'],
  ['ebm', 'механичный танцевальный характер'],
  ['trance', 'пульсирующее танцевальное направление'],
  ['90s', 'ностальгическое настроение девяностых'],
  ['1990s', 'ностальгическое настроение девяностых'],
  ['2000s', 'настроение нулевых'],
  ['2010s', 'настроение десятых']
]);
const STYLE_EXPLANATIONS_EN = new Map<string, string>([
  ['drum and bass', 'a bass-heavy, broken rhythm'],
  ['liquid dnb', 'a softer, melodic edge'],
  ['liquid drum and bass', 'a softer, melodic edge'],
  ['neurofunk', 'a harder, bass-led edge'],
  ['tech step', 'a harder, bass-led edge'],
  ['synthwave', 'a retro electronic mood'],
  ['downtempo', 'a slower, more relaxed feel'],
  ['ambient', 'an atmospheric, contemplative feel'],
  ['shoegaze', 'hazy guitar textures'],
  ['house', 'a rhythmic dance direction'],
  ['deep house', 'a deeper, smoother dance direction'],
  ['progressive house', 'a dance direction that gradually builds'],
  ['breakcore', 'sharp, fragmented electronic rhythms'],
  ['industrial techno', 'a harder industrial edge'],
  ['jungle', 'fast broken rhythms'],
  ['breakbeat', 'buoyant broken rhythms'],
  ['industrial', 'a harder industrial edge'],
  ['ebm', 'a mechanical dance feel'],
  ['trance', 'pulsing dance music'],
  ['90s', 'a nostalgic nineties mood'],
  ['1990s', 'a nostalgic nineties mood'],
  ['2000s', 'a mood from the 2000s'],
  ['2010s', 'a mood from the 2010s']
]);
const FAMILY_EXPLANATIONS: Record<string, string> = {
  electronic: 'электронное направление', pop: 'мелодичное поп-настроение',
  rock: 'гитарный характер', jazz: 'джазовая сторона', classical: 'классическое направление',
  chill: 'спокойный, атмосферный фон', hiphop: 'ритмичная городская сторона', world: 'региональные мотивы',
  talk: 'разговорный формат'
};
const FAMILY_EXPLANATIONS_EN: Record<string, string> = {
  electronic: 'an electronic direction', pop: 'a melodic pop mood',
  rock: 'a guitar-led character', jazz: 'a jazz feel', classical: 'a classical direction',
  chill: 'a calm, atmospheric feel', hiphop: 'a rhythmic urban feel', world: 'regional influences',
  talk: 'a talk format'
};

// Only the existing closed format vocabulary may become explanatory text.
// Arbitrary broadcaster metadata (including "no ads") is not proof of a claim.
const approvedEvidence = (station: VerifiedStationRef): Evidence[] => {
  const labels = new Map<string, string>();
  for (const raw of catalogueTagEvidence(station).slice(0, 80)) {
    const normalized = normalizeGenreTag(raw).replace(/^the /, '').replace(/ (radio|fm|station)$/, '');
    const label = normalizeRefinementGenre(normalized);
    const reviewedFormat = REVIEWED_FORMAT_GENRES.get(label);
    const genre = DNB_STYLES.has(label) ? 'drum and bass' : reviewedFormat || sourceGenres([raw])[0];
    const family = stationGenreFamily(label);
    if (!family && !genre) continue;
    const safeLabel = reviewedFormat || (family || DNB_STYLES.has(label) ? label : genre!);
    if (safeLabel && !labels.has(safeLabel)) labels.set(safeLabel, genre || safeLabel);
  }
  return [...labels].map(([label, genre], index) => ({key: `t${index}`, label, genre}));
};

export const recommendationEvidence = (stations: readonly VerifiedStationRef[]): CardEvidence[] => stations.map(station => ({
  stationId: station.stationuuid, evidence: approvedEvidence(station).slice(0, MAX_PROJECTED_TAGS)
}));

export const RECOMMENDATION_EVIDENCE_SCHEMA: JsonSchemaOutput = {
  name: 'station_evidence_selection',
  schema: { type: 'object', additionalProperties: false, required: ['v', 'cards'], properties: {
    v: {type: 'integer', const: 1}, cards: {type: 'array', maxItems: 5, items: {
      type: 'object', additionalProperties: false, required: ['stationId', 'tagKeys'], properties: {
        stationId: {type: 'string'}, tagKeys: {type: 'array', maxItems: 3, uniqueItems: true, items: {type: 'string'}}
      }
    }}
  }}
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const exactKeys = (row: Record<string, unknown>, keys: string[]) => Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key));

// Provider JSON mode is not a validation boundary. No free-form text survives
// an invalid response, and selection never changes the final cards or actions.
export const validateEvidenceSelection = (content: string, cards: readonly CardEvidence[]): Map<string, string[]> | undefined => {
  if (content.length > 16_384) return undefined;
  let value: unknown;
  try { value = JSON.parse(content); } catch { return undefined; }
  if (!isRecord(value) || !exactKeys(value, ['v', 'cards']) || value.v !== 1 || !Array.isArray(value.cards) || value.cards.length > 5) return undefined;
  const selected = new Map<string, string[]>();
  for (const row of value.cards) {
    if (!isRecord(row) || !exactKeys(row, ['stationId', 'tagKeys']) || typeof row.stationId !== 'string' ||
        selected.has(row.stationId) || !Array.isArray(row.tagKeys) || row.tagKeys.length > 3 ||
        !row.tagKeys.every(key => typeof key === 'string') || new Set(row.tagKeys).size !== row.tagKeys.length) return undefined;
    const own = cards.find(card => card.stationId === row.stationId);
    if (!own || row.tagKeys.some(key => !own.evidence.some(tag => tag.key === key))) return undefined;
    selected.set(row.stationId, row.tagKeys as string[]);
  }
  return selected;
};

export const renderRecommendationEvidence = (
  stations: readonly VerifiedStationRef[], content: string, options: {english?: boolean; culturalVibe?: boolean; preferredTags?: string[]} = {}
): {reply: string; validSelection: boolean} => {
  const rows = stations.slice(0, 5).map(station => ({station, evidence: approvedEvidence(station)}));
  const selected = validateEvidenceSelection(content, recommendationEvidence(stations));
  const en = options.english;
  const cardDescriptions = rows.map(({station, evidence}) => {
    const keys = selected?.get(station.stationuuid);
    let highlights = keys?.length ? keys.map(key => evidence.find(tag => tag.key === key)!) : evidence.slice(0, 2);
    // The actual retrieval genre is evidence only if this station has it. Keep
    // that reason visible even beyond the model projection (e.g. 20 era tags).
    const preferred = (options.preferredTags || []).map(normalizeRefinementGenre)
      .map(label => evidence.find(tag => tag.label === label)).find(Boolean);
    if (preferred) highlights = [preferred, ...highlights.filter(tag => tag.label !== preferred.label)].slice(0, 3);
    // Do not let selected highlights hide a known distinction. This compares
    // complete approved evidence, not the model's chosen subset.
    const distinct = evidence.find(tag => rows.some(other => other.station.stationuuid !== station.stationuuid &&
      other.evidence.length > 0 && !other.evidence.some(candidate => candidate.label === tag.label)));
    if (distinct && !highlights.some(tag => tag.label === distinct.label)) {
      if (highlights.length >= 3) highlights[2] = distinct;
      else highlights.push(distinct);
    }
    return [...new Set(highlights.slice(0, 3).map(tag => {
      const family = stationGenreFamily(tag.label) || tag.genre;
      return en
        ? STYLE_EXPLANATIONS_EN.get(tag.label) || FAMILY_EXPLANATIONS_EN[family] || 'a distinct musical direction'
        : STYLE_EXPLANATIONS.get(tag.label) || FAMILY_EXPLANATIONS[family] || 'отдельное музыкальное направление';
    }))];
  });
  const descriptions = [...new Set(cardDescriptions.flat())].slice(0, 6);
  const dnbStyles = new Set(rows.flatMap(({evidence}) => evidence.map(tag => tag.label)));
  const hasLiquid = dnbStyles.has('liquid dnb') || dnbStyles.has('liquid drum and bass');
  const hasNeuro = dnbStyles.has('neurofunk') || dnbStyles.has('tech step');
  const hasDnb = dnbStyles.has('drum and bass') || hasLiquid || hasNeuro;
  const decadeLabels = [...dnbStyles].filter(label => ['90s','1990s','2000s','2010s'].includes(label));
  const periodEnglish = [
    ...(decadeLabels.some(label => ['90s','1990s'].includes(label)) ? ['the nineties'] : []),
    ...(decadeLabels.includes('2000s') ? ['the 2000s'] : []),
    ...(decadeLabels.includes('2010s') ? ['the 2010s'] : [])
  ].join(' and ');
  const periodRussian = [
    ...(decadeLabels.some(label => ['90s','1990s'].includes(label)) ? ['девяностых'] : []),
    ...(decadeLabels.includes('2000s') ? ['нулевых'] : []),
    ...(decadeLabels.includes('2010s') ? ['десятых'] : [])
  ].join(' и ');
  const periodSound = en ? periodEnglish : `звучанию ${periodRussian}`;
  const periodReference = periodEnglish || periodRussian ? (en ? `with a reference to ${periodEnglish}` : `с отсылкой к ${periodSound}`) : '';
  const localeStyles = en ? STYLE_EXPLANATIONS_EN : STYLE_EXPLANATIONS;
  const musicalDescriptions = descriptions.filter(description => !decadeLabels.some(label => localeStyles.get(label) === description));
  const describeSet = (values: string[]) => en
    ? values.length < 4
      ? values.join(', ')
      : `${values.slice(0,3).join(', ')}. ${values.slice(3).join(', ')}`
    : values.length < 4
      ? values.join(', ')
      : `${values.slice(0,3).join(', ')}; ${values.slice(3).join(', ')}.`;
  const summary = hasDnb && hasLiquid && hasNeuro
    ? en
      ? 'The bass-driven picks range from soft, melodic passages to a harder, more forceful sound.'
      : 'Здесь басовая электроника звучит по-разному: от мягкой и мелодичной до жёсткой и напористой.'
    : periodReference && musicalDescriptions.length
      ? en
        ? `This selection leans toward ${musicalDescriptions[0]} ${periodReference}.`
        : `В подборке есть ${musicalDescriptions[0]} ${periodReference}.`
      : periodReference
        ? en ? `This selection carries a mood tied to ${periodEnglish}.` : `В подборке есть отсылка к ${periodSound}.`
    : descriptions.length
      ? en
        ? descriptions.length === 1
          ? `This selection leans toward ${descriptions[0]}.`
          : `This selection brings together ${describeSet(descriptions)}.`
        : descriptions.length === 1
          ? `В подборке есть ${descriptions[0]}.`
          : `В подборке есть ${describeSet(descriptions)}.`
      : en
        ? 'I found stations for this direction, but the catalogue does not give enough musical detail to describe their sound.'
        : 'Подходящие станции нашлись, но в каталоге недостаточно музыкальных деталей, чтобы описать их звучание.';
  const partialEvidence = rows.some(row => row.evidence.length === 0)
    ? en ? 'Some cards have too little catalogue evidence for a more specific explanation.'
      : 'Для части вариантов в каталоге мало данных, чтобы точнее описать их характер.'
    : '';
  const cultural = options.culturalVibe
    ? en ? 'They are selected for the association, not as an official soundtrack.' : 'Это подборка по ассоциации, не официальный саундтрек.'
    : '';
  const groundedSummary = hasDnb && periodReference
    ? `${summary} ${en ? `There is also ${periodReference}.` : `Есть и отсылка к ${periodSound}.`}`
    : summary;
  return {reply: [groundedSummary, partialEvidence, cultural].filter(Boolean).join(' '), validSelection: Boolean(selected)};
};
