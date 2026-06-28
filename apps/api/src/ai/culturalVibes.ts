/**
 * Curated cultural / franchise → canonical genre-tag map.
 *
 * Maps iconic games, films, shows and aesthetics to the genre tag(s) that nail
 * their musical vibe, so «радио с вайбом GTA Vice City» searches «synthwave»
 * (we have ~40 such stations) instead of letting the generic DeepSeek vibe→tags
 * backstop mis-map it to bland "retro" / generic pop. Every tag here is a real,
 * well-covered catalog tag (each verified ≥11 stations at build time; the first
 * tag of every entry is ≥18).
 *
 * LEGAL / HONESTY: this surfaces our EXISTING licensed stations BY VIBE. We do
 * NOT host the franchise's tracks and never claim a station plays the actual
 * game/film soundtrack — only that it catches that vibe. The composer gets a
 * grounding note (brain.ts CULTURAL_GROUNDING_NOTE) enforcing that framing. Same
 * curated-grounded spirit as the artist index.
 *
 * Order matters — the first matching entry wins, so specific titles (vice city,
 * san andreas) precede the generic fallback (gta). resolveCulturalVibe lowercases
 * the message first, so patterns are written lowercase; Cyrillic word-ends use a
 * negative lookahead (JS \b is ASCII-only — see the brain.ts FACTUAL note).
 */
export type CulturalVibe = {
  /** Short stable label, for tests/logs. */
  label: string;
  /** Matched against the lowercased message. Keep specific to the franchise. */
  pattern: RegExp;
  /** 1–3 canonical English genre tags, most-defining first. */
  tags: string[];
};

export const CULTURAL_VIBES: CulturalVibe[] = [
  // GTA — the most-asked. Vice City = 80s Miami synth; San Andreas = West-coast
  // hip-hop / funk; everything else GTA → the series' rock+hip-hop+funk radio mix.
  { label: 'gta-vice-city', pattern: /вайс[\s-]?сити|vice[\s-]?city/i, tags: ['synthwave', 'new wave', '80s'] },
  { label: 'gta-san-andreas', pattern: /сан[\s-]?андреас|san[\s-]?andreas/i, tags: ['west coast', 'hip hop', 'funk'] },
  {
    label: 'gta-generic',
    pattern: /(?:^|[^a-zа-яё])гта(?![a-zа-яё])|(?:^|[^a-zа-яё])gta(?![a-zа-яё])|grand[\s-]?theft[\s-]?auto/i,
    tags: ['hip hop', 'classic rock', 'funk']
  },
  // Neon / synthwave cinema + games.
  { label: 'cyberpunk', pattern: /киберпанк|cyberpunk/i, tags: ['industrial', 'synthwave', 'electronic'] },
  { label: 'hotline-miami', pattern: /хотлайн[\s-]?майами|hotline[\s-]?miami/i, tags: ['synthwave', 'electronic'] },
  { label: 'blade-runner', pattern: /бегущий\s+по\s+лезвию|blade[\s-]?runner/i, tags: ['synthwave', 'ambient'] },
  { label: 'stranger-things', pattern: /очень\s+странные\s+дела|stranger[\s-]?things/i, tags: ['synthwave', '80s'] },
  // Fallout — 40s–50s Americana radio.
  { label: 'fallout', pattern: /фоллаут|фолыч|fallout/i, tags: ['oldies', 'swing'] },
  // Anime — Naruto / One Piece / a bare «аниме» music ask.
  {
    label: 'anime',
    pattern: /наруто|naruto|ван[\s-]?пис|one[\s-]?piece|аниме(?![а-яё])|(?:^|[^a-z])anime(?![a-z])/i,
    tags: ['anime', 'j-pop', 'japanese']
  },
  // The Witcher — celtic / folk fantasy.
  { label: 'witcher', pattern: /ведьмак|witcher/i, tags: ['celtic', 'folk', 'medieval'] },
  // Tarantino — surf rock + soul + funk needle-drops.
  { label: 'tarantino', pattern: /тарантино|tarantino|kill[\s-]?bill|убить[\s-]?билла|pulp[\s-]?fiction/i, tags: ['surf rock', 'soul', 'funk'] },
  // Peaky Blinders — bluesy / indie rock.
  { label: 'peaky-blinders', pattern: /острые[\s-]?козырьки|peaky[\s-]?blinders/i, tags: ['blues rock', 'indie rock'] },
  // City pop — the 80s Japanese groove. A genre alias (not a franchise) but it
  // belongs here for the same reason: the DeepSeek vibe-mapping mis-read «сити-поп»
  // as smooth jazz, so pin it to the real tags.
  { label: 'city-pop', pattern: /сити[\s-]?поп|city[\s-]?pop/i, tags: ['city pop', 'j-pop', 'japanese'] }
];

/**
 * Resolve a cultural/franchise reference in `message` to its canonical genre
 * tags, or null if none matches. Caller gates this on a real music intent so a
 * passing chat mention of a franchise doesn't trigger a search.
 */
export const resolveCulturalVibe = (message: string): string[] | null => {
  const haystack = String(message || '').toLowerCase();
  if (!haystack) return null;
  for (const vibe of CULTURAL_VIBES) {
    if (vibe.pattern.test(haystack)) return vibe.tags;
  }
  return null;
};
