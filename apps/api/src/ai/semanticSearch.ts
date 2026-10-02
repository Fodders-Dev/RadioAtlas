import { catalogueTagEvidence } from './catalogueTagEvidence.js';
import { normalizeRefinementGenre } from './genreRefinement.js';
import { collectVerifiedStations } from './antiHallucination.js';
import { stationStreamIdentity } from './stationStreamIdentity.js';
import type { VerifiedStationRef } from './types.js';

export type SemanticSearch = { kind: 'genre' | 'hypothesis'; tags: string[]; excludeTags?: string[] };

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
  if (!keys.includes('kind') || !keys.includes('tags') || keys.some(key=>!['kind','tags','excludeTags'].includes(String(key)))) return undefined;

  const candidate = value as { kind?: unknown; tags?: unknown; excludeTags?: unknown };
  if (candidate.kind !== 'genre' && candidate.kind !== 'hypothesis') return undefined;
  if (!Array.isArray(candidate.tags) || candidate.tags.length < 1 || candidate.tags.length > 2) return undefined;

  const tags: string[] = [];
  for (const raw of candidate.tags) {
    const tag = normalizeSafeTag(raw);
    if (!tag) return undefined;
    if (!tags.includes(tag)) tags.push(tag);
  }
  const excludeTags: string[] = [];
  if (keys.includes('excludeTags')) {
    if (!Array.isArray(candidate.excludeTags) || candidate.excludeTags.length > 2) return undefined;
    for (const raw of candidate.excludeTags) {
      const tag = normalizeSafeTag(raw);
      if (!tag || tags.includes(tag)) return undefined;
      if (!excludeTags.includes(tag)) excludeTags.push(tag);
    }
  }
  return { kind: candidate.kind, tags, ...(excludeTags.length ? {excludeTags} : {}) };
};

export const matchesSemanticTag = (station: VerifiedStationRef, tag: string): boolean => {
  const normalizedTag = normalizeSafeTag(tag);
  if (!normalizedTag) return false;
  return catalogueTagEvidence(station).some(evidence =>
    normalizeSafeTag(normalizeRefinementGenre(evidence)) === normalizedTag
  );
};

// Negative genre constraints include explicitly tagged substyles: rejecting
// ambient also rejects a broadcaster's 'dark ambient' tag. Whole token phrases
// only; a name, inferred family or 'ambiente' cannot establish the genre.
export const matchesSemanticExclusion = (station:VerifiedStationRef, tag:string): boolean => {
  const normalized=normalizeSafeTag(tag);
  if (!normalized) return false;
  return catalogueTagEvidence(station).some(raw=>{
    const own=normalizeSafeTag(raw);
    return Boolean(own && (` ${own} `).includes(` ${normalized} `));
  });
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
  const unique = (rows: VerifiedStationRef[]) => {
    let accepted:VerifiedStationRef[]=[];
    for (const row of rows) {
      if (!row.stationuuid || !row.url_resolved) continue;
      const identity=stationStreamIdentity(row);
      if (accepted.some(other=>stationStreamIdentity(other) === identity)) continue;
      const candidate=collectVerifiedStations([{tool:'semantic_search',args:{},found:true,stations:[...accepted,row]}]);
      if(candidate.length === accepted.length + 1) accepted=candidate;
    }
    return accepted;
  };
  // Reserve a distinct representative for each of the at-most-two directions.
  // Deduplicating an interleaved list AFTER cap loses group two when leads
  // overlap. Backtracking also handles a hybrid being group two's only source.
  const slots = groups.slice(0,2).map(group=>group.slice(0,8));
  let representatives: VerifiedStationRef[] = [];
  const assign = (index:number, selected:VerifiedStationRef[]) => {
    if (index === slots.length) {
      if (selected.length > representatives.length) representatives = selected;
      return;
    }
    for (const row of slots[index]!) {
      if (unique([...selected,row]).length === selected.length + 1) assign(index+1,[...selected,row]);
    }
    assign(index+1,selected);
  };
  assign(0,[]);
  const transposed: VerifiedStationRef[] = [...representatives];
  const maxLength = groups.reduce((max, group) => Math.max(max, group.length), 0);
  for (let index = 0; index < maxLength; index++) {
    for (const group of groups) {
      const station = group[index];
      if (station) transposed.push(station);
    }
  }
  return unique(transposed);
};
