import { normalizeGenreTag, stationGenreFamily } from '../catalog/genreFamily.js';
import { catalogueTagEvidence } from './catalogueTagEvidence.js';
import { sourceFacts, sourceGenres } from './currentSourceDiscovery.js';
import { normalizeRefinementGenre } from './genreRefinement.js';
import type { JsonSchemaOutput } from './modelClient.js';
import type { VerifiedStationRef } from './types.js';

type Evidence = { key: string; label: string; genre: string };
type CardEvidence = { stationId: string; evidence: Evidence[] };
const MAX_PROJECTED_TAGS = 12;
const DNB_STYLES = new Set(['liquid dnb', 'liquid drum and bass', 'neurofunk', 'tech step']);

// Only the existing closed format vocabulary may become explanatory text.
// Arbitrary broadcaster metadata (including "no ads") is not proof of a claim.
const approvedEvidence = (station: VerifiedStationRef): Evidence[] => {
  const labels = new Map<string, string>();
  for (const raw of catalogueTagEvidence(station).slice(0, 80)) {
    const normalized = normalizeGenreTag(raw).replace(/^the /, '').replace(/ (radio|fm|station)$/, '');
    const label = normalizeRefinementGenre(normalized);
    const genre = DNB_STYLES.has(label) ? 'drum and bass' : sourceGenres([raw])[0];
    const family = stationGenreFamily(label);
    if (!family && !genre) continue;
    const safeLabel = family || DNB_STYLES.has(label) ? label : genre!;
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
  const lines = rows.map(({station, evidence}) => {
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
    const facts = sourceFacts(station);
    const detail = highlights.length ? highlights.slice(0, 3).map(tag => tag.label).join(', ')
      : en ? 'not enough catalogue genre data' : 'жанровых данных в каталоге не хватает';
    return `«${facts.name}» — ${detail}${facts.country ? ` (${facts.country})` : ''}.`;
  });
  if (rows.length > 1 && rows.every(row => row.evidence.length > 0)) {
    const common = [...new Set(rows[0]!.evidence.map(tag => tag.genre))]
      .filter(genre => rows.every(row => row.evidence.some(tag => tag.genre === genre))).slice(0, 2);
    if (common.length) lines.push(`${en ? 'Shared catalogue tags' : 'Общее в тегах'} — ${common.join(', ')}.`);
    const identical = rows.every(row => row.evidence.length === rows[0]!.evidence.length &&
      row.evidence.every(tag => rows[0]!.evidence.some(other => other.label === tag.label)));
    if (identical) lines.push(en ? 'These tags do not establish a difference in sound.' : 'По этим тегам различие в звучании подтвердить не могу.');
  }
  if (options.culturalVibe) lines.push(en ? 'A genre association, not an official soundtrack.' : 'Это подборка по жанрам, не официальный саундтрек.');
  return {reply: `${en ? 'By catalogue tags:' : 'По тегам каталога:'}\n${lines.join('\n')}`, validSelection: Boolean(selected)};
};
