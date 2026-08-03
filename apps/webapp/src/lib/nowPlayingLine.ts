import type { Station, StationLite } from '../types';
import { stationGenreSlug, type GenreSlug } from './stationGenre';

/**
 * What the player's largest line should say.
 *
 * About 40% of stations never send a track title — measured over the 10230
 * stations the harvester has probed, 4129 have been checked and never once
 * emitted one. That is not a fault to apologise for, it is how a large part of
 * internet radio works. Yet the biggest line on the most-used screen used to
 * read «Название трека пока недоступно» for all of them, and the word «пока»
 * promised something that was never coming.
 *
 * So: a ladder where every rung is TRUE, and none of them is an absence.
 *
 *   1. the live track            — what is playing, when the station says
 *   2. the last one we heard     — dimmed and labelled by the caller
 *   3. the genre                 — what KIND of thing you are hearing
 *   4. «Прямой эфир»             — the last honest thing left, and still true
 *
 * Returns a description rather than a string so the caller owns translation and
 * styling; rung 2 in particular has to be rendered dimmed and must never be
 * copied or searched as if it were live.
 */
export type NowPlayingLine =
  | { kind: 'track'; text: string }
  | { kind: 'lastHeard'; text: string }
  | { kind: 'genre'; slug: GenreSlug }
  | { kind: 'live' };

export const resolveNowPlayingLine = ({
  station,
  track,
  lastHeard
}: {
  station: Station | StationLite | null | undefined;
  /** Already through normalizeTrustedTrackTitle — junk must not reach here. */
  track?: string | null;
  lastHeard?: string | null;
}): NowPlayingLine => {
  const live = track?.trim();
  if (live) return { kind: 'track', text: live };
  const heard = lastHeard?.trim();
  if (heard) return { kind: 'lastHeard', text: heard };
  const slug = stationGenreSlug(station);
  if (slug) return { kind: 'genre', slug };
  return { kind: 'live' };
};

/**
 * Should we tell the listener this station will not be naming its tracks?
 *
 * Only worth saying when it is true, so this is deliberately conservative.
 *
 * ⚠ The authoritative answer lives server-side — `station_meta_state.supports_
 * metadata`, which knows this for 10230 stations — but nothing exposes it: it is
 * read only in-process (apps/api/src/intel/stationIntelDb.ts:146-148) and
 * `toStationLite` is a whitelist that omits it. The client-side equivalent is
 * built, persisted and tested (`isStationMetadataUnavailable` in
 * lib/stationHealth.ts) but DEAD — nothing ever records the signal that feeds
 * it, so it answers `false` for every station in production. Reviving it writes
 * to the ranking-visible health profile, so it belongs in its own change.
 *
 * This therefore reports only what THIS session watched happen, and keeps no
 * record of it.
 *
 * ⚠⚠ `isPlaying` is not decoration. Two different branches of the metadata layer
 * produce an identical snapshot — `status: 'unavailable'`, `source: 'none'` —
 * one meaning "probed, nothing came" and the other "this station had no
 * probeable URL to try" (lib/nowPlaying.ts:1184 vs :1290). They cannot be told
 * apart from the snapshot. Requiring audio to be actually playing makes the
 * distinction irrelevant: whatever the internal reason, the listener is hearing
 * this station and we cannot name what they hear.
 */
export const SILENCE_VERDICT_AFTER_MS = 75_000;

export const stationLooksSilent = ({
  isPlaying,
  metadataStatus,
  listeningSinceMs,
  everHadTrack,
  now
}: {
  /** Audio is actually playing — not buffering, not stopped, not errored. */
  isPlaying: boolean;
  /** The now-playing fetch state; 'loading' means we simply do not know yet. */
  metadataStatus: string;
  /** Epoch ms when playback of the current station began, or null. */
  listeningSinceMs: number | null;
  /** Whether any trusted title has been seen for this station this session. */
  everHadTrack: boolean;
  now: number;
}): boolean => {
  // A single title, ever, settles it: this station does name its tracks and the
  // silence is just a gap.
  if (everHadTrack) return false;
  if (!isPlaying) return false;
  if (metadataStatus !== 'unavailable') return false;
  if (!listeningSinceMs) return false;
  // Long on purpose. A station between records, or one playing something
  // genuinely long, must never be accused — being wrong here tells someone to
  // stop expecting something they are in fact about to get.
  return now - listeningSinceMs >= SILENCE_VERDICT_AFTER_MS;
};
