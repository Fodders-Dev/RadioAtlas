import type { VerifiedStationRef } from './types.js';

const MAX_EVIDENCE_TAGS = 80;
const MAX_EVIDENCE_TAG_LENGTH = 80;
const tagEvidence = new WeakMap<VerifiedStationRef, readonly string[]>();

// Preserve the catalogue labels while bounding how much raw metadata can follow
// one station through the in-process agent. Case-insensitive duplicates and the
// provider's empty-value sentinel do not carry additional evidence.
export const parseCatalogueTagEvidence = (rawTags: string | null | undefined): readonly string[] => {
  const unique = new Map<string, string>();
  for (const rawTag of String(rawTags || '').split(',')) {
    const label = rawTag.trim().slice(0, MAX_EVIDENCE_TAG_LENGTH);
    const key = label.toLocaleLowerCase('en');
    if (!label || key === 'no tags' || unique.has(key)) continue;
    unique.set(key, label);
    if (unique.size >= MAX_EVIDENCE_TAGS) break;
  }
  return [...unique.values()];
};

export const registerCatalogueTagEvidence = (
  station: VerifiedStationRef,
  tags: readonly string[]
): void => {
  tagEvidence.set(station, tags);
};

// Test/tool mocks that were not built by catalogToolProvider retain the tags
// already present on their public reference as the best available evidence.
export const catalogueTagEvidence = (station: VerifiedStationRef): readonly string[] =>
  tagEvidence.get(station) ?? station.tags;
