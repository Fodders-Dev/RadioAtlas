// "Close in spirit" genre fallback for find_stations_by_artist.
//
// When someone asks for a specific artist we have NO dedicated/name-matched
// station for («радио где играет Егор Летов»), the brain otherwise lets the vibe
// backstop map the artist to a genre — and for Russian punk/rock legends that
// goes badly: the catalog's bare «punk» search is polluted (cyberPUNK,
// darkSYNTH, ska, SomaFM Metal Detector) and a Russian artist gets FOREIGN recs.
// This curated map sends those artists straight to clean, ON-GENRE, *Russian*
// catalog tags (e.g. «Летов» → «russian punk», not «punk»), so the cards Лира
// offers as "близкое по духу" are actually close — while the artist tool's L4
// service links still let the listener hear the real artist.
//
// Every tag is a real, well-covered catalog tag verified at build time
// (russian punk / russian rock / post-punk, plus a short INTERNATIONAL section
// below for marquee electronic icons the generic mapping mis-reads). Only
// consulted AFTER the artist tool found no station, so artists WITH a station
// (Цой → «101.ru Цой», Король и Шут → «Король и шут радио», via the L3
// name-match) never reach this and are unaffected. Also consulted by the
// reference-anchor path in brain.ts («в стиле X», «типа X») to ground the named
// act's genre. Matched against the captured artist name (and the raw message as a
// fallback); patterns are Cyrillic-aware (JS \b is ASCII-only).

export type ArtistGenre = {
  /** Short stable label for tests/logs. */
  label: string;
  /** Matched against the lowercased artist/message. */
  pattern: RegExp;
  /** 1–2 canonical catalog genre tags, most-defining first. */
  tags: string[];
  /**
   * Safe to resolve from a bare reference ANCHOR («в стиле X», «типа X»)? Only
   * entries whose name is an UNAMBIGUOUS music reference (a distinctive proper
   * noun or a multi-word act). Loose single-stem patterns that are also ordinary
   * Russian words — «кино» (=movie), «алиса» (=the Yandex speaker), «аквариум»
   * (=fish tank), «наив»/«сплин»/«чайф» — are LEFT OFF: under «в стиле/типа X»
   * they would mis-fire on everyday chat («что-то типа кино») and emit bogus
   * cards/links. The explicit-artist path («радио с X», «где играет X») already
   * disambiguates by framing, so it still uses the FULL map (resolveArtistGenres).
   */
  anchorSafe?: boolean;
};

export const ARTIST_GENRES: ArtistGenre[] = [
  // Siberian / Russian punk
  { label: 'grob-letov', pattern: /летов|гражданск[а-яё]*\s*оборон|гр\.?\s?об(?![а-яё])/i, tags: ['russian punk', 'post-punk'], anchorSafe: true },
  { label: 'sektor-gaza', pattern: /сектор[а-яё]*\s*газа/i, tags: ['russian punk', 'russian rock'], anchorSafe: true },
  { label: 'korol-i-shut', pattern: /король\s*и\s*шут/i, tags: ['russian punk', 'russian rock'], anchorSafe: true },
  // «наив» also matches «наивный/наивного» and «тараканы» is a common noun → NOT anchorSafe.
  { label: 'naiv-tarakany', pattern: /наив|пурген|тараканы|дистемпер/i, tags: ['ska punk', 'russian punk'] },
  // Russian rock — «кино» (=movie) and «аквариум» (=fish tank) are common nouns,
  // «алиса» is the Yandex speaker, «сплин/чайф/ддт» are everyday words → NOT anchorSafe
  // (they stay reachable via the disambiguated «радио с X»/«где играет X» path).
  { label: 'kino-tsoi', pattern: /(?:^|[^а-яё])кино(?![а-яё])|цой/i, tags: ['russian rock', 'post-punk'] },
  { label: 'ddt', pattern: /ддт|шевчук/i, tags: ['russian rock'] },
  { label: 'akvarium-bg', pattern: /аквариум|гребенщик/i, tags: ['russian rock'] },
  { label: 'nautilus', pattern: /наутилус|бутусов/i, tags: ['russian rock'] },
  { label: 'alisa-kinchev', pattern: /алиса|кинчев/i, tags: ['russian rock'] },
  { label: 'chaif', pattern: /чайф/i, tags: ['russian rock'] },
  { label: 'splin', pattern: /сплин/i, tags: ['russian rock'] },
  { label: 'mashina-vremeni', pattern: /машина\s*времени|макаревич/i, tags: ['russian rock'], anchorSafe: true },
  { label: 'zemfira', pattern: /земфир/i, tags: ['russian rock'], anchorSafe: true },
  { label: 'mumiy-troll', pattern: /мумий\s*тролл/i, tags: ['russian rock'], anchorSafe: true },
  // International marquee acts the generic planner/vibe-mapping demonstrably
  // fumbles — it reads their DREAMY/atmospheric vibe and searches «ambient», so a
  // «в стиле Robert Miles» ask lands on SomaFM SLEEP stations instead of their real
  // genre (trance). These are 90s/electronic icons we have NO dedicated station
  // for; pin each to its defining, well-covered catalog tag so a reference-anchor
  // ask («типа children robert miles», «в духе Aphex Twin») gets ON-genre cards.
  // Latin names are distinctive enough; the catalog tag is verified well-covered
  // (trance 431, idm 32, downtempo 110, trip hop, future garage, progressive house).
  { label: 'robert-miles', pattern: /robert\s*miles|роберт[а-яё]*\s*майлз/i, tags: ['trance', 'eurodance'], anchorSafe: true },
  { label: 'aphex-twin', pattern: /aphex\s*twin|эйфекс\s*твин/i, tags: ['idm', 'electronic'], anchorSafe: true },
  { label: 'boards-of-canada', pattern: /boards\s*of\s*canada|бордс\s*оф\s*канада/i, tags: ['idm', 'downtempo'], anchorSafe: true },
  { label: 'burial', pattern: /(?:^|[^a-zа-яё])burial(?![a-z])|бери[ае]л/i, tags: ['future garage', 'dubstep'], anchorSafe: true },
  { label: 'massive-attack-portishead', pattern: /massive\s*attack|массив\s*атак|portishead|портисхед/i, tags: ['trip hop', 'downtempo'], anchorSafe: true },
  { label: 'deadmau5', pattern: /deadmau5|deadmaus|дедмаус/i, tags: ['progressive house', 'electro house'], anchorSafe: true }
];

/**
 * Resolve a famous artist (in `text`) to clean "close in spirit" genre tags, or
 * null. Caller uses this ONLY when find_stations_by_artist found no station.
 */
export const resolveArtistGenres = (text?: string | null): string[] | null => {
  const haystack = String(text || '').toLowerCase();
  if (!haystack) return null;
  for (const entry of ARTIST_GENRES) {
    if (entry.pattern.test(haystack)) return entry.tags;
  }
  return null;
};

/**
 * Like resolveArtistGenres but ONLY the unambiguous, anchor-safe entries — for the
 * reference-anchor path («в стиле X», «типа X»), where a loose common-noun stem
 * (кино/алиса/аквариум) would otherwise hijack ordinary chat into a music search.
 */
export const resolveAnchorGenres = (text?: string | null): string[] | null => {
  const haystack = String(text || '').toLowerCase();
  if (!haystack) return null;
  for (const entry of ARTIST_GENRES) {
    if (entry.anchorSafe && entry.pattern.test(haystack)) return entry.tags;
  }
  return null;
};
