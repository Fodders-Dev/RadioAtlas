import type { PlaybackFailure, NowPlayingStatus } from '../domain/contracts';
import type { StationLite } from '../types';
import type { TrackHistoryItem } from '../state/radio/types';

export type NowPlayingTrustKind = 'with-metadata' | 'without-metadata' | 'questionable-stream';

export type NowPlayingTrust = {
  kind: NowPlayingTrustKind;
  track: string | null;
};

const TECHNICAL_PAYLOAD = /^\{.*"(status|message|result|errorCode|error)".*\}\s*\d*$/i;
const URL_LIKE = /^https?:\/\/\S+$/i;
// Bare-domain ICY metadata is common: stations send "radiovanya.ru"
// or "www.radio.example/listen" as the StreamTitle when no real
// track is playing. We treat that the same as a URL — it's the
// station's address, not a track. Optional `www.`, optional path.
const BARE_DOMAIN_LIKE =
  /^(?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?:\/\S*)?$/i;
const HTML_LIKE = /^<[^>]+>$/;
// An HTML tag ANYWHERE, not just a string that is entirely one tag: NewDanceRadio
// ships `whois"> <meta content="text/html" …` as its StreamTitle, and HTML_LIKE
// above never fired on it.
// ⚠ Requires a letter after the `<`, because "Pa ti toa <3" is a real song on
// LOS 40 — a bare `<` check would silently delete it.
const HTML_FRAGMENT = /<\/?[a-z][a-z0-9]*[\s/>]/i;
// Stream-manifest / ICY attribute soup in place of a track: 102.7 KIIS FM sends
// `Ariana Grande - text="Hate That I Made You Love Me" song_spot=`. Same rule the
// server-side harvester already uses (looksLikeManifestAttr in harvestPipeline).
const MANIFEST_ATTR = /[A-Z][A-Z0-9_-]{2,}=|="/;
// A tilde-delimited database row shipped instead of a track title. A whole
// Italian network does this — RMC, Virgin Radio, R101, Radio 105, Radio Subasio,
// Radio Montecarlo — in the shape
//   name~name~album~year~isrc~duration~startedAt~endsAt
// e.g. `Champagne Supernova~Oasis~~1995~~299~2026-07-14T06:53:48~…`.
//
// The first two fields are the song and the performer, and they are REAL — so
// these are parsed rather than discarded. Which of the two comes first differs
// by network (Virgin sends title first, Montecarlo artist first) and nothing in
// the payload says which, so the two names are joined in the order the station
// sent them: the player renders one line anyway, and preserving the given order
// can never state the relationship backwards.
const TILDE_RECORD = /~[^~]*~[^~]*~/;
const HAS_LETTER = /[\p{L}]/u;
// Trailing fields are year / duration / ISRC / start + end timestamps. Numbers
// drop out for having no letters, but an ISO timestamp carries a "T" and an ISRC
// is letters and digits — both would otherwise be mistaken for a name whenever
// the leading fields are empty.
const ISO_TIMESTAMP_FIELD = /^\d{4}-\d{2}-\d{2}[T ]/;
const ISRC_FIELD = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;

const parseTildeRecord = (value: string): string | null => {
  const fields = value
    .split('~')
    .map((field) => field.trim())
    .filter(
      (field) =>
        field &&
        HAS_LETTER.test(field) &&
        !ISO_TIMESTAMP_FIELD.test(field) &&
        !ISRC_FIELD.test(field)
    );
  // A real row carries BOTH names. When only one survives, the network is
  // filling its idle slot with the station's own name — «Radio Monte Carlo
  // Italia~~~~~12~…» — which the ident rules cannot catch, because the catalogue
  // knows that station only by its acronym, «RMC Italia».
  if (fields.length < 2) return null;
  return fields.slice(0, 2).join(' - ');
};
// A URL anywhere (not only as the whole value, which URL_LIKE already covers):
// Dance Wave! alternates real tracks with `Tracklist: https://dancewave.online`.
const URL_INSIDE = /https?:\/\//i;
// A filename, not a title: no spaces at all and underscores doing the work —
// `TeweldeRedda_fikri_aleni`. Every real title in the sample contains a space.
const FILENAME_LIKE = /^\S*_\S*_\S*$/;
// Separators left behind by an empty artist or title slot: MANGORADIO sends
// `- Ein bisschen Verbraucherinformationen ...` and Iran International sends
// `Radio Iran International -`. Deliberately excludes `.` so a trailing ellipsis
// and Deutschlandfunk's `Andruck, 03.08.` survive intact.
const DANGLING_SEPARATOR = /^[\s\-–—|/:,]+|[\s\-–—|/:,]+$/g;
// Decoration a broadcaster hangs on its own name. Stripped from BOTH the
// candidate title and the station name before they are compared, so «BBC World
// Service Online» is recognised as the ident of «BBC World Service» and
// «Radio 105» as that of «Radio 105 Network».
const IDENT_DECORATION =
  /\b(?:online|live|radio|radyo|fm|am|hd|sd|network|official|stream|streaming|webradio|web|channel|station|the)\b/g;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const FILLER_TITLES = new Set([
  '-',
  '--',
  '...',
  'loading',
  'loading...',
  'unknown',
  'unknown title',
  'unknown artist',
  'unknown song',
  'n/a',
  'none',
  'null',
  'undefined',
  'live',
  'live radio',
  'live stream',
  'live broadcast',
  'on air',
  'now playing',
  'currently playing',
  'stream',
  'radio',
  'no title',
  'no artist',
  'no track',
  'no track info',
  'no metadata',
  'metadata unavailable',
  'track metadata is not here yet',
  'трек ещё не пришёл',
  'трек еще не пришел',
  'нет трека',
  'нет данных',
  'загрузка',
  'без названия',
  // German — rautemusik.fm and other DE stations send this as
  // their idle "no current track" placeholder.
  'kein titel update',
  'kein titel',
  'kein song',
  'keine angabe',
  'unbekannt',
  // Spanish / Portuguese
  'sin titulo',
  'sin título',
  'sem titulo',
  'sem título',
  'desconocido',
  'desconhecido',
  // French
  'aucun titre',
  'titre inconnu',
  // Italian
  'titolo sconosciuto',
  // Polish
  'brak tytułu',
  'brak tytulu',
  // Template defaults the broadcaster never filled in — Clouds FM literally
  // streams «Now Playing info goes here» as its StreamTitle.
  'now playing info goes here',
  'now playing info',
  'song title',
  'song title here',
  'track title',
  'artist - title',
  'artist title',
  'your track here',
  'title goes here'
]);
const QUESTIONABLE_FAILURES = new Set(['mixed-content', 'api-unavailable', 'unsupported-transport']);
const TRACK_HISTORY_DEDUPE_WINDOW_MS = 1000 * 60 * 60 * 6;

const normalizeComparable = (value?: string | null) =>
  value?.trim().replace(/\s+/g, ' ').toLowerCase() || '';

/**
 * Pull the hostname out of a free-form value that might be a URL,
 * a bare domain, or already a hostname. Returns lowercased host
 * with leading "www." stripped, or empty string if the value
 * doesn't look like a host at all.
 */
const extractHostname = (value?: string | null): string => {
  if (!value) return '';
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/**
 * Reduce a name to the words that actually identify it: lowercase, decoration
 * words removed, everything non-alphanumeric collapsed to single spaces. Used
 * only to compare a candidate title against the station's own name.
 */
const reduceIdent = (value?: string | null): string =>
  (value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(IDENT_DECORATION, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Is this candidate just the station announcing itself?
 *
 * Compares the two names with their decoration stripped, so «BBC World Service
 * Online» matches «BBC World Service» and «Radio 105» matches «Radio 105
 * Network». Containment counts in BOTH directions because broadcasters shorten
 * as often as they embellish.
 *
 * ⚠⚠ Containment alone is NOT enough, and getting this wrong deletes music.
 * Checked against 6101 titles the harvester actually observed: a station named
 * after a performer plays that performer, so «The Beatles - Honey Dont» on the
 * station «The Beatles» and «Elissa - 7Ob Kol 7Ayati» on «Elissa FM» both
 * contain the station's whole name and are both entirely real songs. So a
 * containing candidate is an ident only when it adds essentially NOTHING beyond
 * the station's own words — «VRT Studio Brussel» on «Studio Brussel», «Radio
 * Okapi - MONUSCO» on «Radio Okapi».
 *
 * The asymmetry is deliberate. Showing a programme name we failed to recognise
 * is a blemish; dropping a correct track leaves a working station looking mute.
 * When the two rules disagree, keep the title.
 */
const IDENT_MAX_EXTRA_WORDS = 1;
const matchesStationName = (value: string, stationReduced: string): boolean => {
  if (value === stationReduced) return true;
  if (!value.includes(stationReduced) && !stationReduced.includes(value)) return false;
  const stationWords = new Set(stationReduced.split(' '));
  return value.split(' ').filter((word) => !stationWords.has(word)).length <= IDENT_MAX_EXTRA_WORDS;
};

// Words that describe the BROADCAST rather than the music. Alone on the right of
// the separator they mark the whole value as an operational note — «Sunshine
// Live - Simulcast», «Kontrafunk - relay».
const BROADCAST_OPS = new Set([
  'simulcast', 'relay', 'livestream', 'live', 'stream', 'streaming', 'national',
  'online', 'onair', 'air', 'dab', 'test', 'nonstop'
]);

const isStationIdent = (candidate: string, stationName?: string | null): boolean => {
  const a = reduceIdent(candidate);
  if (!a) return true; // nothing but decoration — never a song
  const s = reduceIdent(stationName);
  if (!s) return false;

  const separatorAt = candidate.indexOf(' - ');
  if (separatorAt > 0) {
    const left = reduceIdent(candidate.slice(0, separatorAt));
    const right = reduceIdent(candidate.slice(separatorAt + 3));
    if (left && right) {
      // ⚠⚠ The station's name on the left proves nothing on its own: a station
      // named after a performer plays that performer, and «ЧайФ - Мимо» on the
      // station «Чайф» is a real song with a one-word title. What separates a
      // sub-brand from a song is the RIGHT half — «RADIO BOB - Symphonic Metal»
      // on «Radio Bob! Symphonic Metal» takes both halves out of the station's
      // own name, and «Sunshine Live - Simulcast» describes the broadcast.
      if (!matchesStationName(left, s)) return false;
      if (s.includes(right)) return true;
      return right.split(' ').every((word) => BROADCAST_OPS.has(word));
    }
  }

  return matchesStationName(a, s);
};

export const normalizeTrustedTrackTitle = (
  value?: string | null,
  station?: Pick<StationLite, 'name' | 'url_resolved' | 'url' | 'homepage'> | null
) => {
  if (typeof value !== 'string') return null;
  const collapsed = value.replace(/\0/g, '').replace(/\s+/g, ' ').trim();
  // Unpack a delimited record BEFORE anything judges it, so the song inside is
  // what the rest of the rules see.
  const unpacked = TILDE_RECORD.test(collapsed) ? parseTildeRecord(collapsed) : collapsed;
  if (!unpacked) return null;
  const cleaned = unpacked
    .replace(/\s+-\s+-\s+/g, ' - ')
    .trim()
    // Repair before judging: an empty artist slot leaves a leading "- ", and an
    // empty title slot a trailing " -". Both are cosmetic damage around a value
    // that may still be worth showing — or, once bare, worth recognising as the
    // station's ident.
    .replace(DANGLING_SEPARATOR, '');
  if (!cleaned || cleaned.length < 2 || cleaned.length > 180) return null;
  if (cleaned.includes('\uFFFD') || CONTROL_CHARS.test(cleaned)) return null;
  if (
    TECHNICAL_PAYLOAD.test(cleaned) ||
    URL_LIKE.test(cleaned) ||
    URL_INSIDE.test(cleaned) ||
    BARE_DOMAIN_LIKE.test(cleaned) ||
    HTML_LIKE.test(cleaned) ||
    HTML_FRAGMENT.test(cleaned) ||
    MANIFEST_ATTR.test(cleaned) ||
    // A record that survived unpacking still has its delimiters — parsing failed,
    // so there is nothing trustworthy to show.
    TILDE_RECORD.test(cleaned) ||
    FILENAME_LIKE.test(cleaned)
  ) {
    return null;
  }
  if (/^(error|failed|exception|timeout|forbidden|unauthorized)\b/i.test(cleaned)) return null;
  if (/^(.)\1{5,}$/.test(cleaned)) return null;
  if (!/[a-zа-яё0-9]/i.test(cleaned)) return null;

  const comparable = normalizeComparable(cleaned);
  if (FILLER_TITLES.has(comparable)) return null;

  // «Ad-Trigger - Ad-Trigger»: the same token on both sides of the separator is
  // an ad marker or a jingle ident, never an artist and their song. (The server
  // harvester rejects this shape too.)
  const separatorAt = cleaned.indexOf(' - ');
  if (separatorAt > 0) {
    const left = normalizeComparable(cleaned.slice(0, separatorAt));
    const right = normalizeComparable(cleaned.slice(separatorAt + 3));
    if (left && left === right) return null;
  }

  if (station) {
    if (isStationIdent(cleaned, station.name)) return null;
    const stationName = normalizeComparable(station.name);
    const stationUrl = normalizeComparable(station.url_resolved || station.url);
    const stationHomepage = normalizeComparable(station.homepage);
    if (comparable === stationName || comparable === stationUrl || comparable === stationHomepage) {
      return null;
    }
    // Hostname-aware comparison: when the station's homepage is
    // "https://radiovanya.ru/" and the ICY title is the bare
    // domain "radiovanya.ru", the literal-string check above
    // misses it. Compare normalised hostnames so any URL form of
    // the station's address (with/without protocol, www, path,
    // trailing slash) gets recognised as "not a track".
    const valueHost = extractHostname(cleaned);
    if (valueHost) {
      const homepageHost = extractHostname(station.homepage);
      const streamHost = extractHostname(station.url_resolved || station.url);
      if (valueHost === homepageHost || valueHost === streamHost) {
        return null;
      }
    }
  }

  return cleaned;
};

export const resolveNowPlayingTrust = ({
  station,
  track,
  metadataStatus,
  playerStatus,
  failure
}: {
  station: StationLite | null;
  track?: string | null;
  metadataStatus: NowPlayingStatus;
  playerStatus: string;
  failure?: PlaybackFailure | null;
}): NowPlayingTrust => {
  const normalizedTrack = normalizeTrustedTrackTitle(track, station);
  if (normalizedTrack) {
    return {
      kind: 'with-metadata',
      track: normalizedTrack
    };
  }

  if (
    playerStatus === 'error' ||
    (failure && QUESTIONABLE_FAILURES.has(failure.kind)) ||
    metadataStatus === 'idle'
  ) {
    return {
      kind: 'questionable-stream',
      track: null
    };
  }

  return {
    kind: 'without-metadata',
    track: null
  };
};

export const upsertTrustedTrackHistory = (
  history: TrackHistoryItem[],
  entry: TrackHistoryItem,
  /**
   * ⚠ Optional, and omitting it means NO CAP — which is the point.
   *
   * A find is something a person pressed «Сохранить находку» for, so the app is
   * not allowed to throw one away to make room. The old caller passed
   * MAX_TRACK_HISTORY = 200 and the oldest find silently vanished on the 201st.
   * Measured 2026-09-03: ten thousand finds merge in 6ms and cost 2.2MB of a
   * ~5MB storage budget, so the cap was protecting nothing.
   */
  limit: number | undefined,
  now = entry.timestamp
) => {
  const trustedTrack = normalizeTrustedTrackTitle(entry.track, {
    name: entry.stationName,
    url_resolved: '',
    homepage: ''
  });
  if (!trustedTrack) return history;

  const normalizedStation = entry.stationId;
  const normalizedTrack = normalizeComparable(trustedTrack);
  const recentDuplicate = history.find(
    (item) =>
      item.stationId === normalizedStation &&
      normalizeComparable(item.track) === normalizedTrack &&
      Math.abs(now - item.timestamp) <= TRACK_HISTORY_DEDUPE_WINDOW_MS
  );
  if (recentDuplicate) return history;

  const nextEntry: TrackHistoryItem = {
    ...entry,
    track: trustedTrack
  };
  const next = [
    nextEntry,
    ...history.filter(
      (item) =>
        item.stationId !== normalizedStation ||
        normalizeComparable(item.track) !== normalizedTrack
    )
  ];
  return limit === undefined ? next : next.slice(0, limit);
};
