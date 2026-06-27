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
// (russian punk / russian rock / post-punk). Only consulted AFTER the artist
// tool found no station, so artists WITH a station (Цой → «101.ru Цой», Король и
// Шут → «Король и шут радио», via the L3 name-match) never reach this and are
// unaffected. Matched against the captured artist name (and the raw message as a
// fallback); patterns are Cyrillic-aware (JS \b is ASCII-only).

export type ArtistGenre = {
  /** Short stable label for tests/logs. */
  label: string;
  /** Matched against the lowercased artist/message. */
  pattern: RegExp;
  /** 1–2 canonical catalog genre tags, most-defining first. */
  tags: string[];
};

export const ARTIST_GENRES: ArtistGenre[] = [
  // Siberian / Russian punk
  { label: 'grob-letov', pattern: /летов|гражданск[а-яё]*\s*оборон|гр\.?\s?об(?![а-яё])/i, tags: ['russian punk', 'post-punk'] },
  { label: 'sektor-gaza', pattern: /сектор[а-яё]*\s*газа/i, tags: ['russian punk', 'russian rock'] },
  { label: 'korol-i-shut', pattern: /король\s*и\s*шут/i, tags: ['russian punk', 'russian rock'] },
  { label: 'naiv-tarakany', pattern: /наив|пурген|тараканы|дистемпер/i, tags: ['ska punk', 'russian punk'] },
  // Russian rock
  { label: 'kino-tsoi', pattern: /(?:^|[^а-яё])кино(?![а-яё])|цой/i, tags: ['russian rock', 'post-punk'] },
  { label: 'ddt', pattern: /ддт|шевчук/i, tags: ['russian rock'] },
  { label: 'akvarium-bg', pattern: /аквариум|гребенщик/i, tags: ['russian rock'] },
  { label: 'nautilus', pattern: /наутилус|бутусов/i, tags: ['russian rock'] },
  { label: 'alisa-kinchev', pattern: /алиса|кинчев/i, tags: ['russian rock'] },
  { label: 'chaif', pattern: /чайф/i, tags: ['russian rock'] },
  { label: 'splin', pattern: /сплин/i, tags: ['russian rock'] },
  { label: 'mashina-vremeni', pattern: /машина\s*времени|макаревич/i, tags: ['russian rock'] },
  { label: 'zemfira', pattern: /земфир/i, tags: ['russian rock'] },
  { label: 'mumiy-troll', pattern: /мумий\s*тролл/i, tags: ['russian rock'] }
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
