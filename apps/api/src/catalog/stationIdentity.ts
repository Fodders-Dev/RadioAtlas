// Station identity — "are these two catalogue rows the same station?"
//
// Radio Browser has no unique key per broadcaster, so one station routinely
// appears several times: a second mount, a second bitrate, a re-submission by
// another user, or one stream re-listed under every country on earth. Our
// shelves keyed on `stationuuid`, so each row counted as a separate station and
// a ten-slot rail could spend several slots on one broadcaster. Measured over
// artifacts/catalog-full.json (61 560 rows) the catalogue holds 46 048 distinct
// stations — a quarter of it is repeats.
//
// NAME NORMALIZATION is a port of apps/webapp/src/lib/stationUtils.ts.
// Duplicated rather than shared because this repo has no cross-app package
// (workspaces are apps/* only). catalog.stationIdentity.test.ts replays the
// webapp's own cases so the two copies cannot drift apart silently.

const CODEC = String.raw`aac\+?|aacp|he-aac|mp3|mp2|ogg|flac|wma`;
const BITRATE_VALUES = '16|24|32|40|48|56|64|80|96|112|128|160|192|224|256|320';
const BITRATE = String.raw`(?:${BITRATE_VALUES})\s?(?:k|kb|kbps|kbit|kbit/s|kbps/s)?`;
const QUALITY = String.raw`hq|lq`;
const MIRROR = String.raw`link\s+alterno|alternativo`;
const TECH_ATOM = `(?:${CODEC}|${BITRATE}|${QUALITY}|${MIRROR})`;
const TECH_RUN = `${TECH_ATOM}(?:[\\s,/]+${TECH_ATOM})*`;
const STRONG_TECH = new RegExp(
  String.raw`(?:${CODEC}|(?:${BITRATE_VALUES})\s?(?:k|kb|kbps|kbit|kbit/s|kbps/s)|${QUALITY}|${MIRROR})`,
  'i'
);
const TECH_BRACKET = new RegExp(String.raw`\s*[([]\s*${TECH_RUN}\s*[)\]]`, 'gi');
const TECH_TAIL = new RegExp(String.raw`[\s|\-–—,]+${TECH_RUN}\s*$`, 'i');

const tidyPadding = (name: string): string =>
  name
    .replace(/_{2,}/g, '_')
    .replace(/_(?=\s)|(?<=\s)_/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s_]+|[\s_]+$/g, '');

/**
 * Strip encoder metadata from a catalogue name, keeping the identity. This is
 * what makes «101 FM - Logan - 101.1 FM (AAC+)» and «… (MP3)» one station.
 */
export const normalizeStationName = (name?: string | null): string => {
  if (!name) return '';
  const padded = tidyPadding(name);
  let cleaned = padded.replace(TECH_BRACKET, ' ');
  for (let pass = 0; pass < 3; pass += 1) {
    const match = cleaned.match(TECH_TAIL);
    if (!match || !STRONG_TECH.test(match[0])) break;
    const next = cleaned.slice(0, match.index);
    if (next === cleaned) break;
    cleaned = next;
  }
  if (cleaned !== padded) cleaned = cleaned.replace(/[\s|\-–—,]+$/, '');
  cleaned = tidyPadding(cleaned);
  return cleaned || padded;
};

type IdentityStation = {
  stationuuid: string;
  name: string;
  url?: string;
  url_resolved?: string;
  countrycode?: string;
};

// ⚠ The QUERY STRING IS PART OF THE STREAM'S IDENTITY and must not be dropped.
// An earlier draft normalized it away, on the reasoning that `?rj-tok=…` and
// `?ref=…` are just tracking noise. Replayed over the catalogue that merged 68
// unrelated Australian stations into one, because the busiest endpoints are
// PROXIES where the query names the station being fetched:
// `worldradio.online/proxy/?q=<real url>`, `securestreams7.autopo.st/?uri=<real
// url>`, `samcloud.spacial.com/api/listen?sid=98569`,
// `tx.sharp-stream.com/icecast.php?i=midwestfmie2.aac`. Keeping the query costs
// us a handful of true merges where the query really was tracking noise; that is
// the harmless direction to be wrong in — a duplicate survives, rather than a
// real station disappearing from the shop window.
//
// Scheme, `www.`, host case and a trailing slash are safe to ignore: http/https
// of one mount is one stream.
const streamIdentity = (station: IdentityStation): string => {
  const raw = (station.url_resolved || station.url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw.includes('://') ? raw : `http://${raw}`);
    const host = parsed.host.toLowerCase().replace(/^www\./, '');
    if (!host) return '';
    const path = parsed.pathname.replace(/\/+$/, '').toLowerCase();
    return `stream:${host}${path}${parsed.search.toLowerCase()}`;
  } catch {
    return '';
  }
};

// Cyrillic ё folds onto е exactly as it does in the search index, so «Ёлка
// Радио» and «Елка Радио» are one station.
const broadcasterIdentity = (station: IdentityStation): string => {
  const name = normalizeStationName(station.name).toLowerCase().replace(/ё/g, 'е').trim();
  if (!name) return '';
  return `name:${name}|${(station.countrycode || '').toLowerCase().trim()}`;
};

const collapse = <T extends IdentityStation>(
  stations: T[],
  identityOf: (station: T) => string,
  isBetter: (candidate: T, incumbent: T) => boolean
): T[] => {
  const winners = new Map<string, T>();
  // One slot per distinct identity, in first-seen order; keyless rows get their
  // own slot. The survivor takes the slot of the FIRST row of its group, so a
  // caller that ranked its input keeps that ranking.
  const slots: Array<string | T> = [];
  for (const station of stations) {
    const key = identityOf(station);
    if (!key) {
      // No usable identity (blank name, unparseable URL) — never merge on an
      // absence of evidence; the row stands on its own.
      slots.push(station);
      continue;
    }
    const incumbent = winners.get(key);
    if (!incumbent) {
      winners.set(key, station);
      slots.push(key);
    } else if (isBetter(station, incumbent)) {
      winners.set(key, station);
    }
  }
  return slots.map((slot) => (typeof slot === 'string' ? winners.get(slot)! : slot));
};

/**
 * One row per broadcaster, best row surviving.
 *
 * TWO PASSES, NOT one union-find over both rules. Identity is transitive, so a
 * single mislabelled row bridges two real stations: Radio Browser lists a row
 * NAMED «RAI Radio 1» whose URL is actually Tutta Italiana's, and union-find
 * duly welded RAI's nine channels into one station — likewise TalkSPORT 1/2 and
 * all of Jazz Radio's sub-channels. Collapsing streams FIRST and letting only
 * each group's survivor carry a name into the second pass contains that row
 * inside its own stream group: measured over the full artifact, RAI keeps 16
 * stations instead of 1, TalkSPORT 4, Jazz Radio 46 — while the duplicates the
 * shop window actually showed still collapse (234 rows of one Quran recitation
 * to 1, «Iran International»/«iraninternational» to 1, «987»x3 to 1).
 *
 * `score` decides which row survives: pass the same quality score the search
 * ranker uses, so the survivor is the one that PLAYS (upstream reachability
 * dominates it), then the one with the better bitrate/codec and more votes.
 * Ties break on stationuuid so the choice is deterministic across processes.
 */
export const dedupeByBroadcaster = <T extends IdentityStation>(
  stations: T[],
  score: (station: T) => number
): T[] => {
  const isBetter = (candidate: T, incumbent: T) => {
    const candidateScore = score(candidate);
    const incumbentScore = score(incumbent);
    if (candidateScore !== incumbentScore) return candidateScore > incumbentScore;
    return candidate.stationuuid < incumbent.stationuuid;
  };
  return collapse(collapse(stations, streamIdentity, isBetter), broadcasterIdentity, isBetter);
};

export const __testing = { streamIdentity, broadcasterIdentity };
