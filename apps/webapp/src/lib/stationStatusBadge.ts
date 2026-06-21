import type { StationLite } from '../types';
import { isStationMetadataUnavailable, isStationSuppressedByHealth } from './stationHealth';
import type { StationHealthProfile } from './stationHealth';
import { isStationHardHiddenByPlayability, isStationHardHiddenByUpstream } from './stationPlayability';
import type { StationPlayabilityProfile } from './stationPlayability';

// Per-station status badge: instead of HIDING a problematic station, the listing
// shows a small corner icon — a warning triangle for «нет названий треков», a
// no-entry circle for «не работает». Both are derived from the EXISTING health /
// playability signals (reused, not re-thresholded). Phase F will make the
// no-metadata state authoritative via the harvested supports_metadata flag.

export type StationBadgeState = 'none' | 'no-metadata' | 'broken';

export type StationBadgeProfiles = {
  healthProfile?: StationHealthProfile | null;
  playabilityProfile?: StationPlayabilityProfile | null;
};

// The station won't play: Radio Browser just confirmed it dead, OR ≥2 recent hard
// playback failures, OR health-suppressed. This is the SAME predicate set the
// rankers use to hide a station — we surface it as a badge instead of dropping it.
export const isStationBroken = (
  station: StationLite,
  { healthProfile, playabilityProfile }: StationBadgeProfiles,
  now = Date.now()
): boolean =>
  isStationHardHiddenByUpstream(station, now) ||
  isStationHardHiddenByPlayability(playabilityProfile, station, now) ||
  isStationSuppressedByHealth(healthProfile, station, now);

// Priority: broken > no-metadata > none.
export const getStationBadgeState = (
  station: StationLite,
  profiles: StationBadgeProfiles,
  now = Date.now()
): StationBadgeState => {
  if (isStationBroken(station, profiles, now)) return 'broken';
  if (isStationMetadataUnavailable(profiles.healthProfile, station, now)) return 'no-metadata';
  return 'none';
};
