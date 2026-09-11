// Coarse genre families for the calm Globe's dot colours (A4 «Журнал»).
//
// The webapp's `stationGenre.ts` already turns a station's raw tags into one
// of ~87 fine genres for the player line. The map needs something coarser — a
// legend a listener can read at a glance — and it needs it for every point in
// one payload, because the globe must not fetch thousands of station records
// one by one. So the family is decided here, once per point, from the SAME raw
// tags, and shipped as a single short field.
//
// The rule for a station with several tags is deliberately simple and stable:
// scan the tags in the broadcaster's own order and take the first one we
// recognise. Nothing unrecognised is ever mapped — an unknown tag yields no
// family, and the dot stays neutral. The alias lists below are drawn from the
// real tag distribution (the catalogue really carries «80's», «80er», «hip
// hop rap»), not invented.

export const GENRE_FAMILIES = [
  'pop',
  'rock',
  'electronic',
  'jazz',
  'classical',
  'chill',
  'hiphop',
  'world',
  'talk'
] as const;

export type GenreFamily = (typeof GENRE_FAMILIES)[number];

const FAMILY_TAGS: Record<GenreFamily, string[]> = {
  pop: [
    'pop', 'pop music', 'popmusic', 'поп музыка', 'поп', 'dance', 'dance music', 'dance hits', 'club',
    'club dance', 'clubhits', 'club hits', 'eurodance', 'italodance', 'italo disco', 'hits',
    'greatest hits', 'hit music', 'todays hits', 'adult hits', 'pop hits', 'top 40', 'top40',
    'top 40 pop', 'charts', 'chart', 'oldies', 'classic hits', 'golden oldies', 'nostalgia', 'retro',
    'ретро', '60s', "60's", '1960s', '60er', 'sixties', '70s', "70's", '1970s', '70er', 'seventies',
    '80s', "80's", '1980s', '80er', 'eighties', '90s', "90's", '1990s', '90er', 'nineties', '00s',
    '2000s', "2000's", '2000er', 'schlager', 'volkstumliche musik', 'k pop', 'kpop', 'korean', 'j pop',
    'jpop', 'anime', 'video game music', 'chiptune', 'bollywood', 'hindi', 'desi', 'punjabi',
    'easy listening', 'easylistening', 'soft', 'soft rock', 'adult standards', 'adult contemporary',
    'ac', 'hot adult contemporary', 'soft adult contemporary', 'christmas', 'christmas music', 'xmas',
    'holiday'
  ],
  rock: [
    'rock', 'rock music', 'рок', 'classic rock', 'classicrock', 'album rock', 'hard rock', 'hardrock',
    'metal', 'heavy metal', 'death metal', 'black metal', 'symphonic metal', 'nu metal', 'metalcore',
    'punk', 'punk rock', 'pop punk', 'alternative', 'alternative rock', 'alt rock', 'grunge', 'indie',
    'indie rock', 'indie pop'
  ],
  electronic: [
    'electronic', 'electronica', 'electronic music', 'synthpop', 'synthwave', 'idm', 'house',
    'house music', 'progressive house', 'vocal house', 'deep house', 'deephouse', 'tech house', 'techno',
    'minimal techno', 'trance', 'progressive trance', 'psytrance', 'drum and bass', 'drum n bass', 'dnb',
    'drum bass', 'jungle', 'liquid', 'dubstep', 'bass', 'edm', 'electronic dance music', 'rave'
  ],
  jazz: [
    'jazz', 'jazz music', 'джаз', 'smooth jazz', 'smoothjazz', 'blues', 'rhythm and blues', 'soul',
    'northern soul', 'funk', 'disco', 'rnb', 'r n b', 'r b', 'rhythm blues', 'urban'
  ],
  classical: [
    'classical', 'classical music', 'classic', 'baroque', 'symphony', 'классика', 'opera',
    'instrumental', 'piano', 'soundtrack', 'soundtracks', 'film music', 'movie soundtracks'
  ],
  chill: [
    'ambient', 'ambient music', 'space', 'drone', 'chillout', 'chill', 'chill out', 'chillhop',
    'downtempo', 'trip hop', 'triphop', 'lounge', 'bar lounge', 'lo fi', 'lofi', 'lo fi hip hop',
    'new age', 'newage', 'meditation', 'relax', 'relaxation', 'sleep', 'nature sounds', 'yoga'
  ],
  hiphop: [
    'hip hop', 'hiphop', 'hip hop rap', 'old school hip hop', 'rap', 'rap music', 'reggae', 'roots',
    'dub', 'ska', 'dancehall'
  ],
  world: [
    'country', 'country music', 'americana', 'folk', 'folk music', 'volksmusik', 'народная', 'bluegrass',
    'world', 'world music', 'international', 'ethnic', 'latin', 'latin music', 'latino', 'musica latina',
    'salsa', 'merengue', 'cumbia', 'banda', 'ranchera', 'mariachi', 'regional', 'bachata', 'reggaeton',
    'chanson', 'шансон', 'shanson', 'arabic', 'arabic music', 'tarab', 'african', 'african music',
    'afrobeat', 'afrobeats', 'balkan', 'turbo folk', 'narodna'
  ],
  talk: [
    'news', 'news talk', 'local news', 'information', 'news radio', 'новости', 'talk', 'talk radio',
    'talk speech', 'speech', 'разговорное', 'sports', 'sport', 'sports talk', 'football', 'culture',
    'cultura', 'культура', 'comedy', 'humor', 'education', 'educational', 'science', 'audiobook',
    'audiobooks', 'аудиокниги', 'children', 'kids', 'children s music', 'детское', 'gospel',
    'gospel music', 'christian', 'christian music', 'contemporary christian', 'praise worship',
    'worship', 'religious', 'catholic', 'bible', 'islam', 'islamic', 'religion', 'spiritual', 'quran',
    'koran', 'holy quran', 'quran radio', 'nasheed'
  ]
};

const TAG_TO_FAMILY = new Map<string, GenreFamily>();
for (const family of GENRE_FAMILIES) {
  for (const tag of FAMILY_TAGS[family]) TAG_TO_FAMILY.set(tag, family);
}

/** Lowercase and collapse punctuation — «Hip-Hop», «hip hop» and «HIP  HOP» are one tag. */
export const normalizeGenreTag = (tag: string): string =>
  tag
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The family of the first recognised tag, in the broadcaster's order, or null
 * when no tag is recognised. A leading article and a trailing «music»/«radio»
 * are decoration («jazz radio» is jazz), nothing else is guessed.
 */
export const stationGenreFamily = (tags: string | null | undefined): GenreFamily | null => {
  if (typeof tags !== 'string' || !tags.trim()) return null;
  for (const chunk of tags.split(',')) {
    const normalized = normalizeGenreTag(chunk);
    if (!normalized) continue;
    const hit = TAG_TO_FAMILY.get(normalized);
    if (hit) return hit;
    const stripped = normalized.replace(/^the /, '').replace(/ (music|radio|fm|station)$/, '');
    if (stripped !== normalized) {
      const strippedHit = TAG_TO_FAMILY.get(stripped);
      if (strippedHit) return strippedHit;
    }
  }
  return null;
};
