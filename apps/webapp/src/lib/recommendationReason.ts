import type { StationLite } from '../types';
import type { BehaviorProfile } from './homeProfile';

export type RecommendationReasonKind =
  | 'frequent'
  | 'favorite-tag'
  | 'favorite-country'
  | 'promoted'
  | 'verified';

export type RecommendationReason = {
  kind: RecommendationReasonKind;
  label: string;
  // The tag / country / station name that drove the reason —
  // available when the UI wants to surface "Похожее на X".
  detail?: string;
};

type ReasonInput = {
  station: StationLite;
  behaviorProfile: BehaviorProfile | null | undefined;
  // Translation hook so callers can localise the chip without
  // every consumer re-implementing the same conditional.
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const FREQUENT_PLAYS_THRESHOLD = 3;

const normalize = (value?: string | null) =>
  value
    ?.trim()
    .replace(/\s+/g, ' ')
    .toLowerCase() || '';

const stationFirstTag = (station: StationLite): string => {
  const raw = (station.tags || '').split(',')[0]?.trim() || '';
  return raw;
};

const topEntry = (scores: Record<string, number> | undefined) => {
  if (!scores) return null;
  let bestLabel = '';
  let bestScore = 0;
  Object.entries(scores).forEach(([label, score]) => {
    if (score > bestScore) {
      bestScore = score;
      bestLabel = label;
    }
  });
  if (!bestLabel || bestScore <= 0) return null;
  return { label: bestLabel, score: bestScore };
};

/**
 * Pick a single human-readable reason for why this station might
 * appear in a recommendation rail. Priority order is meaningful:
 * the most personal signal wins so the badge stays informative
 * rather than redundant with what the user already infers from
 * the row (e.g. "verified" loses to "favorite-tag").
 *
 *   1. frequent         — user has already played this station
 *                         several times. The strongest "you know
 *                         and like this" signal.
 *   2. favorite-tag     — station's primary tag matches the
 *                         user's top tag in the behavior profile.
 *   3. favorite-country — station's country matches the user's
 *                         top country.
 *   4. promoted         — only used when no personal signal
 *                         applies (so we don't bury organic
 *                         recommendations under sponsorship).
 *   5. verified         — last-resort catalog signal.
 */
export const getRecommendationReason = (
  input: ReasonInput
): RecommendationReason | null => {
  const { station, behaviorProfile, t } = input;

  if (behaviorProfile) {
    const stationPlays = behaviorProfile.stationScores?.[station.stationuuid] ?? 0;
    if (stationPlays >= FREQUENT_PLAYS_THRESHOLD) {
      return {
        kind: 'frequent',
        label: t('reasons.frequent') || 'Часто слушаешь'
      };
    }

    const topTag = topEntry(behaviorProfile.tagScores);
    if (topTag) {
      const stationTag = normalize(stationFirstTag(station));
      const allTags = (station.tags || '')
        .split(',')
        .map((tag) => normalize(tag))
        .filter(Boolean);
      const matchesTag =
        normalize(topTag.label) === stationTag ||
        allTags.includes(normalize(topTag.label));
      if (matchesTag) {
        return {
          kind: 'favorite-tag',
          label:
            t('reasons.favoriteTag', { tag: topTag.label }) ||
            `Любимый жанр · ${topTag.label}`,
          detail: topTag.label
        };
      }
    }

    const topCountry = topEntry(behaviorProfile.countryScores);
    if (topCountry && station.country) {
      if (normalize(topCountry.label) === normalize(station.country)) {
        return {
          kind: 'favorite-country',
          label:
            t('reasons.favoriteCountry', { country: topCountry.label }) ||
            `Часто слушаешь · ${topCountry.label}`,
          detail: topCountry.label
        };
      }
    }
  }

  if (station.promoted) {
    return {
      kind: 'promoted',
      label: t('reasons.promoted') || 'Промо'
    };
  }

  if (station.isVerified) {
    return {
      kind: 'verified',
      label: t('reasons.verified') || 'Проверено'
    };
  }

  return null;
};
