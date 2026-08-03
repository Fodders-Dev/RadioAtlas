import type { Station, StationLite } from '../types';

/**
 * What kind of music is this, in one word a listener would recognise?
 *
 * Used when a station gives us no track title — about 40% of them never do
 * (measured over the 10230 stations the harvester has probed: 4129 have been
 * checked and never once emitted a title). The player's largest line then has
 * nothing to announce, and a genre is the next most useful truth about what you
 * are hearing.
 *
 * ⚠ Raw Radio Browser tags cannot be shown as-is. Measured across the whole
 * 61560-station catalogue: only 65.5% have any tag at all, and among those the
 * first tag is an emoji or pure symbols 813 times, one or two characters 170
 * times, a URL 7 times — plus a long tail of things that describe the business
 * rather than the music («full service», «iheart», «commercial», «discography»).
 * There are 4855 distinct first tags and even the top 400 cover only half the
 * catalogue, so a deny-list would never converge.
 *
 * So the CURATED MAP BELOW IS THE FILTER. A tag we do not recognise yields
 * nothing and the caller falls back to «Прямой эфир» — which is still true.
 * Nothing unrecognised is ever printed at a listener.
 *
 * Returns a slug; the caller translates it via `genre.<slug>` so the label is in
 * the listener's language rather than the broadcaster's.
 */

// Canonical slugs. Every one of these MUST have a `genre.<slug>` entry in both
// locale files — a slug without a translation would render as a raw key.
export const GENRE_SLUGS = [
  'pop', 'rock', 'classicRock', 'hardRock', 'metal', 'punk', 'alternative', 'indie',
  'classical', 'opera', 'instrumental', 'piano', 'soundtrack',
  'jazz', 'smoothJazz', 'blues', 'soul', 'funk', 'disco', 'rnb',
  'electronic', 'house', 'deepHouse', 'techHouse', 'techno', 'trance', 'drumAndBass', 'dubstep', 'edm',
  'ambient', 'chillout', 'downtempo', 'lounge', 'lofi', 'newAge', 'meditation',
  'hipHop', 'rap', 'reggae', 'ska', 'dancehall',
  'dance', 'eurodance', 'hits', 'top40', 'charts', 'oldies', 'retro',
  'sixties', 'seventies', 'eighties', 'nineties', 'twoThousands',
  'country', 'folk', 'bluegrass', 'world', 'latin', 'salsa', 'cumbia', 'bachata', 'reggaeton',
  'chanson', 'shanson', 'schlager', 'kpop', 'jpop', 'anime', 'bollywood', 'arabic', 'african', 'balkan',
  'gospel', 'christian', 'religious', 'quran',
  'news', 'talk', 'sports', 'culture', 'comedy', 'education', 'audiobook', 'children',
  'easyListening', 'adultContemporary', 'christmas'
] as const;

export type GenreSlug = (typeof GENRE_SLUGS)[number];

// Raw tag → slug. Keys are matched after lowercasing and collapsing punctuation
// to single spaces, so «Hip-Hop», «hip hop» and «HIP  HOP» all land on one entry.
// Aliases are drawn from the real tag distribution, not invented: the catalogue
// really does carry «80s», «80's», «1980s» and «80er» as separate tags.
const TAG_TO_GENRE: Record<string, GenreSlug> = {
  pop: 'pop', 'pop music': 'pop', 'popmusic': 'pop', 'поп музыка': 'pop', 'поп': 'pop',
  rock: 'rock', 'rock music': 'rock', 'рок': 'rock',
  'classic rock': 'classicRock', 'classicrock': 'classicRock', 'album rock': 'classicRock',
  'hard rock': 'hardRock', 'hardrock': 'hardRock',
  metal: 'metal', 'heavy metal': 'metal', 'death metal': 'metal', 'black metal': 'metal',
  'symphonic metal': 'metal', 'nu metal': 'metal', 'metalcore': 'metal',
  punk: 'punk', 'punk rock': 'punk', 'pop punk': 'punk',
  alternative: 'alternative', 'alternative rock': 'alternative', 'alt rock': 'alternative',
  grunge: 'alternative',
  indie: 'indie', 'indie rock': 'indie', 'indie pop': 'indie',
  classical: 'classical', 'classical music': 'classical', 'classic': 'classical',
  baroque: 'classical', symphony: 'classical', 'классика': 'classical',
  opera: 'opera',
  instrumental: 'instrumental',
  piano: 'piano',
  soundtrack: 'soundtrack', soundtracks: 'soundtrack', 'film music': 'soundtrack',
  'movie soundtracks': 'soundtrack',
  jazz: 'jazz', 'jazz music': 'jazz', 'джаз': 'jazz',
  'smooth jazz': 'smoothJazz', smoothjazz: 'smoothJazz',
  blues: 'blues', 'rhythm and blues': 'rnb',
  soul: 'soul', 'northern soul': 'soul',
  funk: 'funk',
  disco: 'disco',
  rnb: 'rnb', 'r n b': 'rnb', 'r b': 'rnb', 'rhythm blues': 'rnb', urban: 'rnb',
  electronic: 'electronic', electronica: 'electronic', 'electronic music': 'electronic',
  synthpop: 'electronic', synthwave: 'electronic', idm: 'electronic',
  house: 'house', 'house music': 'house', 'progressive house': 'house', 'vocal house': 'house',
  'deep house': 'deepHouse', deephouse: 'deepHouse',
  'tech house': 'techHouse',
  techno: 'techno', 'minimal techno': 'techno',
  trance: 'trance', 'progressive trance': 'trance', psytrance: 'trance',
  'drum and bass': 'drumAndBass', 'drum n bass': 'drumAndBass', dnb: 'drumAndBass',
  'drum bass': 'drumAndBass', jungle: 'drumAndBass', liquid: 'drumAndBass',
  dubstep: 'dubstep', bass: 'dubstep',
  edm: 'edm', 'electronic dance music': 'edm', rave: 'edm',
  ambient: 'ambient', 'ambient music': 'ambient', space: 'ambient', drone: 'ambient',
  chillout: 'chillout', chill: 'chillout', 'chill out': 'chillout', chillhop: 'chillout',
  downtempo: 'downtempo', 'trip hop': 'downtempo', triphop: 'downtempo',
  lounge: 'lounge', 'bar lounge': 'lounge',
  'lo fi': 'lofi', lofi: 'lofi', 'lo fi hip hop': 'lofi',
  'new age': 'newAge', newage: 'newAge',
  meditation: 'meditation', relax: 'meditation', relaxation: 'meditation', sleep: 'meditation',
  'nature sounds': 'meditation', yoga: 'meditation',
  'hip hop': 'hipHop', hiphop: 'hipHop', 'hip hop rap': 'hipHop', 'old school hip hop': 'hipHop',
  rap: 'rap', 'rap music': 'rap',
  reggae: 'reggae', roots: 'reggae', dub: 'reggae',
  ska: 'ska',
  dancehall: 'dancehall',
  dance: 'dance', 'dance music': 'dance', 'dance hits': 'dance', club: 'dance',
  'club dance': 'dance', clubhits: 'dance', 'club hits': 'dance',
  eurodance: 'eurodance', italodance: 'eurodance', 'italo disco': 'eurodance',
  hits: 'hits', 'greatest hits': 'hits', 'hit music': 'hits', 'todays hits': 'hits',
  'adult hits': 'hits', 'pop hits': 'hits',
  'top 40': 'top40', top40: 'top40', 'top 40 pop': 'top40',
  charts: 'charts', chart: 'charts',
  oldies: 'oldies', 'classic hits': 'oldies', 'golden oldies': 'oldies', nostalgia: 'oldies',
  retro: 'retro', 'ретро': 'retro',
  '60s': 'sixties', "60's": 'sixties', '1960s': 'sixties', '60er': 'sixties', sixties: 'sixties',
  '70s': 'seventies', "70's": 'seventies', '1970s': 'seventies', '70er': 'seventies', seventies: 'seventies',
  '80s': 'eighties', "80's": 'eighties', '1980s': 'eighties', '80er': 'eighties', eighties: 'eighties',
  '90s': 'nineties', "90's": 'nineties', '1990s': 'nineties', '90er': 'nineties', nineties: 'nineties',
  '00s': 'twoThousands', '2000s': 'twoThousands', "2000's": 'twoThousands', '2000er': 'twoThousands',
  country: 'country', 'country music': 'country', americana: 'country',
  folk: 'folk', 'folk music': 'folk', 'volksmusik': 'folk', 'народная': 'folk',
  bluegrass: 'bluegrass',
  world: 'world', 'world music': 'world', international: 'world', ethnic: 'world',
  latin: 'latin', 'latin music': 'latin', latino: 'latin', 'musica latina': 'latin',
  salsa: 'salsa', merengue: 'salsa',
  cumbia: 'cumbia', banda: 'cumbia', ranchera: 'cumbia', mariachi: 'cumbia', regional: 'cumbia',
  bachata: 'bachata',
  reggaeton: 'reggaeton',
  chanson: 'chanson',
  'шансон': 'shanson', shanson: 'shanson',
  schlager: 'schlager', 'volkstumliche musik': 'schlager',
  'k pop': 'kpop', kpop: 'kpop', korean: 'kpop',
  'j pop': 'jpop', jpop: 'jpop',
  anime: 'anime', 'video game music': 'anime', chiptune: 'anime',
  bollywood: 'bollywood', hindi: 'bollywood', desi: 'bollywood', punjabi: 'bollywood',
  arabic: 'arabic', 'arabic music': 'arabic', tarab: 'arabic',
  african: 'african', 'african music': 'african', afrobeat: 'african', afrobeats: 'african',
  balkan: 'balkan', 'turbo folk': 'balkan', 'narodna': 'balkan',
  gospel: 'gospel', 'gospel music': 'gospel',
  christian: 'christian', 'christian music': 'christian', 'contemporary christian': 'christian',
  'praise worship': 'christian', worship: 'christian',
  religious: 'religious', catholic: 'religious', bible: 'religious', islam: 'religious',
  islamic: 'religious', 'religion': 'religious', spiritual: 'religious',
  quran: 'quran', koran: 'quran', 'holy quran': 'quran', 'quran radio': 'quran', nasheed: 'quran',
  news: 'news', 'news talk': 'news', 'local news': 'news', information: 'news',
  'news radio': 'news', 'новости': 'news',
  talk: 'talk', 'talk radio': 'talk', 'talk speech': 'talk', speech: 'talk', 'разговорное': 'talk',
  sports: 'sports', sport: 'sports', 'sports talk': 'sports', football: 'sports',
  culture: 'culture', cultura: 'culture', 'культура': 'culture',
  comedy: 'comedy', humor: 'comedy',
  education: 'education', educational: 'education', science: 'education',
  audiobook: 'audiobook', audiobooks: 'audiobook', 'аудиокниги': 'audiobook',
  children: 'children', kids: 'children', 'children s music': 'children', 'детское': 'children',
  'easy listening': 'easyListening', easylistening: 'easyListening', soft: 'easyListening',
  'soft rock': 'easyListening', 'adult standards': 'easyListening',
  'adult contemporary': 'adultContemporary', ac: 'adultContemporary',
  'hot adult contemporary': 'adultContemporary', 'soft adult contemporary': 'adultContemporary',
  christmas: 'christmas', 'christmas music': 'christmas', xmas: 'christmas', holiday: 'christmas'
};

/** Lowercase, strip punctuation and diacritic-free compare — «Hip-Hop» → «hip hop». */
const normalizeTag = (tag: string): string =>
  tag
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * ⚠ Where the catalogue's tag is not merely useless but WRONG, and printing it
 * would be worse than printing nothing.
 *
 * Radio Browser tags Quran recitation stations «classical» — «إذاعة القرآن
 * الكريم», «#radio quran» and others all carry it. Labelling recitation of
 * scripture as a music genre is not a small inaccuracy, so the station's own
 * name overrides the tag here. Deliberately narrow: only cases where a music
 * label would misrepresent what is being broadcast.
 */
const NAME_OVERRIDES: Array<{ pattern: RegExp; slug: GenreSlug }> = [
  { pattern: /(?:^|\W)(?:qur['’]?an|quraan|koran|коран)(?:\W|$)|قرآن|قران/iu, slug: 'quran' }
];

/**
 * The first tag we recognise, or null. Scans ALL tags rather than only the
 * first: broadcasters often lead with a business word («commercial», «local
 * radio») and put the music second.
 */
export const stationGenreSlug = (station: Station | StationLite | null | undefined): GenreSlug | null => {
  const name = station?.name;
  if (typeof name === 'string' && name.trim()) {
    const override = NAME_OVERRIDES.find((entry) => entry.pattern.test(name));
    if (override) return override.slug;
  }
  const raw = station?.tags;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  for (const chunk of raw.split(',')) {
    const normalized = normalizeTag(chunk);
    if (!normalized) continue;
    const hit = TAG_TO_GENRE[normalized];
    if (hit) return hit;
    // A leading article or a trailing «music»/«radio» is decoration, not a
    // different genre — «the blues», «jazz radio» and «blues music» are all one.
    const stripped = normalized.replace(/^the /, '').replace(/ (music|radio|fm|station)$/, '');
    if (stripped !== normalized && TAG_TO_GENRE[stripped]) return TAG_TO_GENRE[stripped];
  }
  return null;
};
