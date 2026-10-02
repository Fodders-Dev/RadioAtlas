import { catalogueTagEvidence } from './catalogueTagEvidence.js';
import { normalizeRefinementGenre } from './genreRefinement.js';
import { collectVerifiedStations } from './antiHallucination.js';
import type { VerifiedStationRef } from './types.js';

export type SemanticSearch = { kind: 'genre' | 'hypothesis'; tags: string[] };

// Accept the separators used in real genre labels (Hip-Hop, Lo-Fi, Drum & Bass,
// Drum 'n' Bass) while excluding punctuation that can form URLs or commands.
const SAFE_RADIO_TAG = /^[a-z0-9][a-z0-9 +&'-]*$/;

const normalizeSafeTag = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  if (/[\r\n]/.test(value)) return undefined;
  const lowered = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (lowered.length < 2 || lowered.length > 40 || !SAFE_RADIO_TAG.test(lowered)) return undefined;
  const normalized = normalizeRefinementGenre(lowered);
  const compactAliases: Record<string,string> = {lofi:'lo fi',deephouse:'deep house',triphop:'trip hop'};
  return compactAliases[normalized] || normalized || undefined;
};

export const parseSemanticSearch = (value: unknown): SemanticSearch | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes('kind') || !keys.includes('tags')) return undefined;

  const candidate = value as { kind?: unknown; tags?: unknown };
  if (candidate.kind !== 'genre' && candidate.kind !== 'hypothesis') return undefined;
  if (!Array.isArray(candidate.tags) || candidate.tags.length < 1 || candidate.tags.length > 2) return undefined;

  const tags: string[] = [];
  for (const raw of candidate.tags) {
    const tag = normalizeSafeTag(raw);
    if (!tag) return undefined;
    if (!tags.includes(tag)) tags.push(tag);
  }
  return { kind: candidate.kind, tags };
};

export const matchesSemanticTag = (station: VerifiedStationRef, tag: string): boolean => {
  const normalizedTag = normalizeSafeTag(tag);
  if (!normalizedTag) return false;
  return catalogueTagEvidence(station).some(evidence =>
    normalizeSafeTag(normalizeRefinementGenre(evidence)) === normalizedTag
  );
};

// Spelling alternatives, not broader genres. The catalogue's ordinary literal
// search does not fold punctuation or aliases; keep this bounded and opt-in.
export const semanticTagSpellings = (tag: string): string[] => {
  const key = normalizeSafeTag(tag);
  if (!key) return [];
  const spellings: Record<string,string[]> = {
    'drum and bass':['drum and bass','drum n bass',"drum 'n' bass",'drum & bass','dnb','drum bass'],
    'hip hop':['hip hop','hip-hop','hiphop'],
    'lo fi':['lo fi','lo-fi','lofi'],
    'deep house':['deep house','deep-house','deephouse'],
    'trip hop':['trip hop','trip-hop','triphop']
  };
  return spellings[key] || [...new Set([key,key.replace(/ /g,'-')])];
};

export const balancedSemanticStations = (
  groups: readonly VerifiedStationRef[][]
): VerifiedStationRef[] => {
  const transposed: VerifiedStationRef[] = [];
  const maxLength = groups.reduce((max, group) => Math.max(max, group.length), 0);
  for (let index = 0; index < maxLength; index++) {
    for (const group of groups) {
      const station = group[index];
      if (station) transposed.push(station);
    }
  }
  return collectVerifiedStations([{
    tool: 'semantic_search',
    args: {},
    found: transposed.length > 0,
    stations: transposed
  }]);
};
