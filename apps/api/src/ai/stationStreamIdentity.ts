import type { VerifiedStationRef } from './types.js';

// Fragments are client-only. Keep query parameters and protocol: they can
// distinguish channels; stripping them could merge genuinely different audio.
export const stationStreamIdentity = (station: Pick<VerifiedStationRef, 'url_resolved'>): string => {
  try {
    const url = new URL(station.url_resolved);
    url.hash = '';
    return url.href;
  } catch { return station.url_resolved.trim(); }
};
