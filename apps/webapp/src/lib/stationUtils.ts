import type { Station, StationLite } from '../types';
import { applyCuratedStationFixup } from './curatedStationFixups';

const COUNTRY_LABELS: Record<string, string> = {
  'The United Kingdom Of Great Britain And Northern Ireland': 'United Kingdom',
  'The United States Of America': 'USA',
  'The Russian Federation': 'Russia',
  'Islamic Republic Of Iran': 'Iran',
  'Syrian Arab Republic': 'Syria'
};

export const formatCountryLabel = (value?: string) => {
  const cleaned = value?.trim();
  if (!cleaned) return '';
  return COUNTRY_LABELS[cleaned] || cleaned;
};

const formatLocationPart = formatCountryLabel;

export const toLite = (station: Station | StationLite): StationLite =>
  applyCuratedStationFixup({
    stationuuid: station.stationuuid,
    name: station.name,
    url: ('url' in station && station.url) || station.url_resolved,
    url_resolved: station.url_resolved,
    homepage: 'homepage' in station ? station.homepage : '',
    favicon: station.favicon,
    country: station.country,
    state: station.state,
    tags: station.tags,
    geo_lat: station.geo_lat ?? null,
    geo_long: station.geo_long ?? null,
    lastcheckok: station.lastcheckok,
    lastcheckok_at: station.lastcheckok_at
  });

// P1 (+PR-4): catalog names arrive with junk padding ("___80 EXITOS", doubled
// spaces, a stray "CHRISTMAS CHOR_ by"). Tidy on OUTPUT only — never mutate the
// stored data. Collapses underscore/whitespace runs, drops a single underscore
// that hugs a space, and trims leading/trailing whitespace+underscores. An
// underscore BETWEEN word characters is preserved (e.g. "LO_FI").
// Radio Browser stores the ENCODER SETTINGS in the display name, so the catalog
// ships rows like «Deutschlandfunk | DLF | MP3 128k», «Wave FM - Wollongong -
// 96.5 FM (AAC)», «RadioBOB Rock Hits (64 kbps AAC)». Measured over
// artifacts/catalog-full.json (61 481 rows): 4.0% carry a codec token and 1.4% a
// bitrate. On a card that reads as a database dump rather than a product.
//
// ⚠ Scope is deliberately NARROW. Two much larger patterns are left ALONE:
//   - a frequency (9.8% of names) — «Radio 538», «Radio 357», «Radio 105»,
//     «Авторадио 90.3 FM»: the number is often the station's identity, and
//     there is no reliable way to tell «96.5 FM» the noise from «Radio 538» the
//     name. Stripping 9.8% of the catalogue to tidy some of it is a bad trade.
//   - anything after a dash (14.4%) — «Radio Nova - Dublin» is a real name.
// Only unambiguous ENCODER metadata is removed.
// ⚠ `opus` is deliberately ABSENT. It is a codec, but «LRT Opus» is a real
// Lithuanian channel — LRT runs Radijas, Klasika and Opus — and stripping it
// collapses three stations into one ambiguous «LRT». A catalogue scan found 38
// names containing «opus»: 37 encoder tags against that 1 identity, and getting
// the identity wrong costs more than leaving 37 tags in place. Same call as the
// frequencies below.
const CODEC = String.raw`aac\+?|aacp|he-aac|mp3|mp2|ogg|flac|wma`;
// Real encoder ladder. A whitelist, NOT \d{2,3}: «Radio 538 MP3» must keep 538
// while «Radio Beat 128 MP3» loses the 128. 16/24 are here for Opus-era low
// bitrates; a BARE «24» still cannot be stripped (see STRONG_TECH), so «Radio
// 24» is safe.
const BITRATE_VALUES = '16|24|32|40|48|56|64|80|96|112|128|160|192|224|256|320';
const BITRATE = String.raw`(?:${BITRATE_VALUES})\s?(?:k|kb|kbps|kbit|kbit/s|kbps/s)?`;
// Only two quality markers, both meaningless as a standalone word in a station
// name. «Low»/«High» are NOT here — «High Energy Radio» is a real station.
const QUALITY = String.raw`hq|lq`;
// Only the multi-word forms. A lone «mirror» or «relay» is a plausible station
// name — «Radio Mirror» exists, and an earlier draft of this turned it into
// «Radio».
const MIRROR = String.raw`link\s+alterno|alternativo`;
const TECH_ATOM = `(?:${CODEC}|${BITRATE}|${QUALITY}|${MIRROR})`;
// A run of technical atoms, optionally separated by spaces, commas or slashes.
const TECH_RUN = `${TECH_ATOM}(?:[\\s,/]+${TECH_ATOM})*`;

// ⚠ A trailing run is removed only when it carries STRONG evidence: a codec, a
// bitrate WITH its unit, a quality marker, or a mirror phrase. A bare number off
// the bitrate ladder is not enough by itself — «Radio 80» and «Radio 128» are
// station names, and an earlier draft ate both. Inside a bracket a bare number
// is unambiguous («Radio Caprice - Groove Metal (128)»), so brackets skip this.
const STRONG_TECH = new RegExp(
  String.raw`(?:${CODEC}|(?:${BITRATE_VALUES})\s?(?:k|kb|kbps|kbit|kbit/s|kbps/s)|${QUALITY}|${MIRROR})`,
  'i'
);

// A bracket is dropped only when its ENTIRE content is technical, so «(EU)»,
// «(Guadalajara)» and «(New Stream URL as of 2023)» survive untouched.
const TECH_BRACKET = new RegExp(String.raw`\s*[([]\s*${TECH_RUN}\s*[)\]]`, 'gi');
// …and a trailing run is dropped only at the very END, after a real separator,
// so nothing can be removed from the head of a name.
const TECH_TAIL = new RegExp(String.raw`[\s|\-–—,]+${TECH_RUN}\s*$`, 'i');

// Unchanged from before this pass, ON PURPOSE: a name with no encoder metadata
// must come out byte-identical to what it was, so this change can only ever
// affect the 4% it targets.
//
// ⚠ It deliberately does NOT trim trailing separators. An earlier draft did, and
// it mangled symmetric decoration: «-=PoWeR=-» → «-=PoWeR=»,
// «| COBrOx.RADiO.fm |» → «| COBrOx.RADiO.fm». Dangling separators are cleaned
// only at the point where something was actually cut away.
const tidyPadding = (name: string): string =>
  name
    .replace(/_{2,}/g, '_')
    .replace(/_(?=\s)|(?<=\s)_/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s_]+|[\s_]+$/g, '');

export const normalizeStationName = (name?: string | null): string => {
  if (!name) return '';
  const padded = tidyPadding(name);
  // Replaced with a space, not nothing: the pattern eats the whitespace in front
  // of the bracket, and «101.9 [128kbps MP3](Non-restricted)» would otherwise
  // close up into «101.9(Non-restricted)». tidyPadding collapses the leftover.
  let cleaned = padded.replace(TECH_BRACKET, ' ');
  // Repeat: «… 320k AAC» is two runs once the brackets are gone.
  for (let pass = 0; pass < 3; pass += 1) {
    const match = cleaned.match(TECH_TAIL);
    // Nothing to strip, or the tail is only a bare number / weak token.
    if (!match || !STRONG_TECH.test(match[0])) break;
    const next = cleaned.slice(0, match.index);
    if (next === cleaned) break;
    cleaned = next;
  }
  // Only NOW clean a separator, and only because something was cut here.
  if (cleaned !== padded) cleaned = cleaned.replace(/[\s|\-–—,]+$/, '');
  cleaned = tidyPadding(cleaned);
  // Never let tidying erase the station. «MP3» as a whole name stays «MP3».
  return cleaned || padded;
};

// ⚠ The default fallback is EMPTY, not «Unknown location». That English string
// was hard-coded here while almost no caller passed a localised one, so a
// Russian UI showed «Unknown location» under station cards — seen on live prod
// on the very first screen a new user gets.
//
// Empty is better than a translated placeholder too: a card that simply omits
// the line reads as a station without a stated location, while «Локация не
// указана» spends a line to announce an absence. Callers that need a word can
// still pass one (there is a locale key: explore.unknownLocation), and
// librarySearch's haystack already .filter(Boolean)s it out — which also drops a
// bogus «unknown location» token from the search index.
export const stationLocation = (station: Station | StationLite, fallback = '') => {
  const parts = [formatLocationPart(station.state), formatLocationPart(station.country)].filter(Boolean);
  return parts.length ? parts.join(', ') : fallback;
};

export const stationTags = (station: Station | StationLite, fallback = 'No tags') => {
  const tags = station.tags
    ?.split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 3);
  return tags?.length ? tags.join(' · ') : fallback;
};
