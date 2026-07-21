import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLOUDFLARE_SCENE_MODEL = '@cf/black-forest-labs/flux-2-klein-4b';
// v3 (music identity): the station, its curated genres and a bounded snapshot of
// harvested programming now lead the prompt; country is only secondary art
// direction. The bump is the cache-migration lever — old country+vibe images
// remain on disk but can no longer be selected for a v3 station scene.
// deploy/server/configure-scene-artwork.sh pins the production value and must be
// bumped in lockstep with this constant.
export const DEFAULT_SCENE_STYLE_VERSION = 'atlas-music-v3';
export const DEFAULT_SCENE_DAILY_CAP = 60;
export const SCENE_VIBES = [
  'chill',
  'dance',
  'jazz',
  'news',
  'pop',
  'retro',
  'road',
  'world'
] as const;

export type SceneVibe = (typeof SCENE_VIBES)[number];

export const SCENE_MUSIC_PROFILES = [
  'citypop',
  'gaming',
  'electronic',
  'hiphop',
  'heavy',
  'rock',
  'jazz',
  'classical',
  'latin',
  'folk',
  'chill',
  'retro',
  'pop',
  'spoken',
  'world'
] as const;

export type SceneMusicProfile = (typeof SCENE_MUSIC_PROFILES)[number];

// Light/landscape bands derived from latitude. Deliberately coarse: the band is
// a pure function of the station's country (see COUNTRY_LIGHT), so adding it to
// the scene key costs ZERO extra cardinality for every station that carries a
// country code — it only makes the key readable for operators.
export const SCENE_LIGHTS = [
  'polar',
  'boreal',
  'temperate',
  'subtrop',
  'tropic',
  'global'
] as const;

export type SceneLight = (typeof SCENE_LIGHTS)[number];

export type SceneArtworkStation = {
  stationuuid: string;
  name?: string | null;
  country?: string | null;
  countrycode?: string | null;
  state?: string | null;
  tags?: string | null;
  // Trusted, server-side observations only. They enrich the generation prompt
  // but deliberately do not enter the cache key: a new song must not mint a
  // paid background every few minutes.
  recentTracks?: readonly string[] | null;
  topArtists?: readonly string[] | null;
  // Only consulted when the station carries no usable ISO country code. Per
  // station coordinates are populated on ~21% of the catalog, so making them the
  // primary light source would split a country's scenes by data-coverage
  // accident rather than by anything a listener can perceive — and it would
  // multiply the generation budget for exactly the largest countries.
  geo_lat?: number | null;
  geo_long?: number | null;
};

export type SceneDescriptor = {
  sceneKey: string;
  country: string;
  countryIdentity: string;
  vibe: SceneVibe;
  musicProfile: SceneMusicProfile;
  genreLabels: readonly string[];
  stationCue: string | null;
  trackCues: readonly string[];
  light: SceneLight;
  styleVersion: string;
  prompt: string;
  seed: number;
};

export type SceneArtworkStatus = 'ready' | 'queued' | 'disabled' | 'unavailable';

export type SceneArtworkMetadata = {
  status: SceneArtworkStatus;
  sceneKey: string;
  url?: string;
};

export type SceneArtworkFormat = 'png' | 'jpeg';
export type SceneArtworkExtension = 'png' | 'jpg';
export type SceneArtworkMimeType = 'image/png' | 'image/jpeg';

export type SceneArtworkImage = {
  data: Buffer;
  format: SceneArtworkFormat;
  extension: SceneArtworkExtension;
  mimeType: SceneArtworkMimeType;
};

export type SceneArtworkClock = () => Date | number;

export type SceneArtworkConfig = {
  enabled: boolean;
  accountId?: string | null;
  apiToken?: string | null;
  cacheDir: string | URL;
  styleVersion?: string;
  dailyCap?: number;
  maxConcurrency?: number;
  maxQueueSize?: number;
  width?: number;
  height?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: SceneArtworkClock;
  log?: (message: string, error?: unknown) => void;
};

export type SceneArtworkService = {
  readonly enabled: boolean;
  resolve: (
    station: SceneArtworkStation,
    options?: { generate?: boolean }
  ) => Promise<SceneArtworkMetadata>;
  readImage: (
    sceneKey: string,
    extension?: SceneArtworkExtension
  ) => Promise<SceneArtworkImage | null>;
  // Compatibility for the first PNG-only service contract. New code should
  // use readImage so JPEG output is not silently discarded.
  readPng: (sceneKey: string) => Promise<Buffer | null>;
  whenIdle: () => Promise<void>;
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IHDR = Buffer.from('IHDR', 'ascii');
const PNG_IEND = Buffer.from('IEND', 'ascii');
const JPEG_SOI = Buffer.from([0xff, 0xd8]);
const JPEG_EOI = Buffer.from([0xff, 0xd9]);
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_STYLE_VERSION_LENGTH = 48;
const MAX_COUNTRY_LABEL_LENGTH = 80;
const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 768;
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_CONCURRENCY = 2;
const DEFAULT_MAX_QUEUE_SIZE = 24;
const QUOTA_FILE = '.daily-usage.json';
const SCENE_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;

const VIBE_KEYWORDS: ReadonlyArray<readonly [SceneVibe, readonly string[]]> = [
  ['jazz', ['jazz', 'blues', 'soul', 'funk', 'swing', 'bebop']],
  [
    'dance',
    ['dance', 'edm', 'electronic', 'house', 'techno', 'trance', 'club', 'disco', 'rave', 'groove']
  ],
  [
    'chill',
    [
      'chill',
      'chillout',
      'lounge',
      'ambient',
      'downtempo',
      'lofi',
      'easy listening',
      'meditation',
      'relax',
      'smooth'
    ]
  ],
  [
    'news',
    ['news', 'talk', 'speech', 'information', 'politics', 'current affairs', 'nachrichten', 'info']
  ],
  [
    'retro',
    [
      'oldies',
      'retro',
      'vintage',
      'classic hits',
      'nostalgia',
      '60s',
      '70s',
      '80s',
      '90s',
      '1960s',
      '1970s',
      '1980s',
      '1990s',
      'gold'
    ]
  ],
  [
    'road',
    ['rock', 'country', 'indie', 'alternative', 'metal', 'punk', 'americana', 'drive', 'highway']
  ],
  // 'j-pop'/'k-pop' are normalized to spaces before matching, so they are spelled
  // the way the normalizer emits them.
  ['pop', ['pop', 'j pop', 'k pop', 'top 40', 'hits', 'chart']]
];

// Vibe supplies SUBJECT and ENERGY only. Time of day, weather and palette are a
// separate, location-derived axis (LIGHT_PROMPTS) — that separation is the fix
// for "everything renders as neon night": previously five of these eight strings
// baked dusk/night/neon in independently of the global palette clause.
const VIBE_PROMPTS: Record<SceneVibe, string> = {
  chill: 'calm spacious composition, soft reflective surfaces, unhurried open air and room to breathe',
  dance: 'high-energy graphic geometry, bold repeating shapes, a strong sense of rhythm and movement',
  jazz: 'intimate refined interior mood, rich fabrics and polished wood, understated elegant detail',
  news: 'modern civic and metropolitan architecture, crisp structural lines, composed and confident',
  pop: 'playful contemporary street scene, clean bold colour blocking, buoyant optimistic energy',
  retro: 'analog-film texture with fine grain, nostalgic mid-century shapes, signage-free period props',
  road: 'open road and wide horizon, motion and distance, a sense of travelling somewhere',
  world: 'characterful local landscape and vernacular architecture at a human scale'
};

type MusicSignal = {
  profile: SceneMusicProfile;
  label: string;
  aliases: readonly string[];
};

// Closed vocabulary: catalog tags, station titles and harvested stream titles
// may be attacker-controlled, so only these recognized music concepts can
// influence the structural art direction or the cache identity.
const MUSIC_SIGNALS: readonly MusicSignal[] = [
  { profile: 'citypop', label: 'city pop', aliases: ['city pop', 'citypop'] },
  { profile: 'citypop', label: 'future funk', aliases: ['future funk', 'futurefunk'] },
  { profile: 'citypop', label: 'anime', aliases: ['anime', 'anisong'] },
  { profile: 'citypop', label: 'J-pop', aliases: ['j pop', 'jpop', 'japanese pop'] },
  { profile: 'citypop', label: 'vaporwave', aliases: ['vaporwave', 'vapourwave'] },
  { profile: 'gaming', label: 'video-game music', aliases: ['video game', 'game music', 'vgm', 'gaming'] },
  { profile: 'gaming', label: 'chiptune', aliases: ['chiptune', '8 bit', '16 bit'] },
  { profile: 'gaming', label: 'soundtrack', aliases: ['soundtrack', 'original score', 'ost', 'metal slug'] },
  { profile: 'electronic', label: 'house', aliases: ['house', 'deep house', 'tech house'] },
  { profile: 'electronic', label: 'techno', aliases: ['techno', 'minimal techno'] },
  { profile: 'electronic', label: 'electronic', aliases: ['electronic', 'electronica', 'edm', 'dance'] },
  { profile: 'electronic', label: 'trance', aliases: ['trance', 'psytrance'] },
  { profile: 'electronic', label: 'drum and bass', aliases: ['drum and bass', 'dnb', 'jungle'] },
  { profile: 'hiphop', label: 'hip-hop', aliases: ['hip hop', 'hiphop', 'rap', 'trap'] },
  { profile: 'heavy', label: 'metal', aliases: ['heavy metal', 'death metal', 'metalcore', 'metal'] },
  { profile: 'heavy', label: 'punk', aliases: ['punk', 'hardcore'] },
  { profile: 'heavy', label: 'hard rock', aliases: ['hard rock', 'grunge'] },
  { profile: 'jazz', label: 'jazz', aliases: ['jazz', 'bebop', 'swing'] },
  { profile: 'jazz', label: 'soul', aliases: ['soul', 'rhythm and blues', 'rnb'] },
  { profile: 'jazz', label: 'funk', aliases: ['funk', 'groove'] },
  { profile: 'jazz', label: 'blues', aliases: ['blues'] },
  { profile: 'classical', label: 'classical', aliases: ['classical', 'baroque', 'symphony', 'orchestra'] },
  { profile: 'classical', label: 'opera', aliases: ['opera', 'operatic'] },
  { profile: 'latin', label: 'Latin', aliases: ['latin', 'latino', 'reggaeton'] },
  { profile: 'latin', label: 'salsa', aliases: ['salsa', 'bachata', 'merengue', 'cumbia'] },
  { profile: 'folk', label: 'country', aliases: ['country', 'americana', 'bluegrass'] },
  { profile: 'folk', label: 'folk', aliases: ['folk', 'acoustic', 'singer songwriter'] },
  { profile: 'chill', label: 'lo-fi', aliases: ['lo fi', 'lofi'] },
  { profile: 'chill', label: 'ambient', aliases: ['ambient', 'downtempo', 'chillout', 'chill'] },
  { profile: 'retro', label: 'disco', aliases: ['disco'] },
  { profile: 'retro', label: 'oldies', aliases: ['oldies', 'retro', 'vintage', 'classic hits'] },
  { profile: 'retro', label: '80s/90s', aliases: ['80s', '90s', '1980s', '1990s'] },
  { profile: 'pop', label: 'pop', aliases: ['pop', 'top 40', 'chart', 'hits'] },
  { profile: 'spoken', label: 'spoken radio', aliases: ['news', 'talk', 'speech', 'podcast'] },
  { profile: 'rock', label: 'rock', aliases: ['rock', 'indie', 'alternative'] }
] as const;

const MUSIC_PROFILE_PROMPTS: Record<SceneMusicProfile, string> = {
  citypop: 'retro-futurist Japanese city-pop and anime soundtrack atmosphere, a rain-polished urban arcade, cassette-era chrome, playful geometric light and saturated violet-cyan glow',
  gaming: 'kinetic video-game soundtrack atmosphere, stylized arcade architecture, bold modular forms, energetic screen-like colour and tactile controller-era detail',
  electronic: 'immersive electronic-music environment, rhythmic light architecture, precise repeating geometry, glossy industrial surfaces and a strong pulse',
  hiphop: 'confident contemporary street-culture atmosphere, monumental graphic forms, textured concrete, warm cinematic contrast and editorial swagger',
  heavy: 'raw high-energy rock atmosphere, dramatic industrial structure, weathered metal, strong directional contrast and a sense of live-stage impact',
  rock: 'open-road rock atmosphere, broad horizon, worn leather and amplifier texture, honest natural contrast and a sense of forward motion',
  jazz: 'intimate jazz-listening atmosphere, rich fabrics, polished wood, sculptural brass detail and understated late-session elegance',
  classical: 'spacious acoustic performance atmosphere, refined architectural rhythm, natural materials, graceful symmetry and restrained grandeur',
  latin: 'vivid Latin dance atmosphere, sun-warmed colour, layered street texture, flowing movement and joyful rhythmic detail',
  folk: 'earthy travelling-music atmosphere, tactile timber and canvas, open landscape, human-scale detail and a strong sense of place',
  chill: 'calm headphone-listening atmosphere, soft reflective surfaces, diffused light, uncluttered space and slow visual rhythm',
  retro: 'nostalgic analog-music atmosphere, period hi-fi shapes, fine film grain, warm material texture and playful vintage colour',
  pop: 'bright contemporary pop atmosphere, clean bold colour blocking, polished editorial surfaces and buoyant optimistic energy',
  spoken: 'composed modern broadcast atmosphere, crisp civic structure, studio-grade visual order and confident editorial clarity',
  world: 'characterful global music atmosphere, tactile local materials, vernacular forms and an inviting human-scale sense of discovery'
};

const MUSIC_PROFILE_VIBES: Record<Exclude<SceneMusicProfile, 'world'>, SceneVibe> = {
  citypop: 'pop',
  gaming: 'dance',
  electronic: 'dance',
  hiphop: 'pop',
  heavy: 'road',
  rock: 'road',
  jazz: 'jazz',
  classical: 'chill',
  latin: 'dance',
  folk: 'road',
  chill: 'chill',
  retro: 'retro',
  pop: 'pop',
  spoken: 'news'
};

// Light + palette per band. THREE variants each; which one a scene gets is chosen
// by bytes of the scene digest, so it is fully deterministic and adds no keys —
// two countries in the same band still read differently. No entry mentions night
// or neon anywhere.
const LIGHT_PROMPTS: Record<SceneLight, { light: readonly string[]; palette: readonly string[] }> = {
  polar: {
    light: [
      'pale low-angle daylight with very long soft shadows',
      'bright crisp overcast noon under a clean high sky',
      'wide luminous daytime haze over open ground'
    ],
    palette: [
      'cool silver-blue with pale gold highlights',
      'muted slate and snow white with a soft rose accent',
      'clear ice-blue with warm low sunlight'
    ]
  },
  boreal: {
    light: [
      'soft northern morning light under thin high cloud',
      'clear crisp afternoon sun with long shadows',
      'even bright overcast daylight'
    ],
    palette: [
      'deep pine green and weathered grey with warm amber highlights',
      'cool blue-grey with muted ochre',
      'fresh green, birch white and pale sky blue'
    ]
  },
  temperate: {
    light: [
      'warm golden late-afternoon sun',
      'clear high-noon daylight with crisp contrast',
      'soft morning haze with gentle warm light'
    ],
    palette: [
      'warm terracotta, olive green and honey gold',
      'clean daylight blues with sandstone warmth',
      'soft sage, cream and dusty rose'
    ]
  },
  subtrop: {
    light: [
      'strong bright midday sun with sharp defined shadows',
      'warm amber late-afternoon glow across dry air',
      'hazy warm morning light with soft dust in the air'
    ],
    palette: [
      'sun-bleached ochre and dry gold under a deep blue sky',
      'warm coral, pale sand and turquoise',
      'burnt sienna, cream and vivid azure'
    ]
  },
  tropic: {
    light: [
      'brilliant equatorial midday sun',
      'warm golden-hour daylight through humid air',
      'bright clear light just after rain, surfaces still wet and reflective'
    ],
    palette: [
      'vivid green, saturated turquoise and hot coral',
      'rich emerald, mango yellow and deep sea blue',
      'lush foliage green with warm terracotta and bright white'
    ]
  },
  global: {
    light: [
      'clear natural daylight',
      'soft diffused daylight under high cloud',
      'warm open afternoon light'
    ],
    palette: [
      'balanced natural colour with warm highlights',
      'clean daylight tones with gentle contrast',
      'warm neutral palette lifted by a single vivid accent'
    ]
  }
};

// Representative light band per ISO country code, grouped by band so the table
// stays auditable. Static and deterministic on purpose: derived from the
// population-weighted latitude of each country, NOT from catalog data (which
// would drift between artifact refreshes and break key stability).
const LIGHT_BAND_COUNTRIES: Record<Exclude<SceneLight, 'global'>, readonly string[]> = {
  polar: ['is', 'no', 'fi', 'gl', 'fo', 'sj', 'ax', 'aq', 'tf'],
  boreal: [
    'se', 'ee', 'lv', 'lt', 'ru', 'by', 'dk', 'gb', 'ie', 'im', 'gg', 'je',
    'nl', 'be', 'de', 'pl', 'cz', 'ca', 'kz', 'fk', 'pm'
  ],
  temperate: [
    'fr', 'ch', 'at', 'sk', 'hu', 'si', 'hr', 'ba', 'rs', 'me', 'mk', 'ro',
    'md', 'ua', 'bg', 'it', 'es', 'pt', 'ad', 'sm', 'va', 'mc', 'lu', 'li',
    'gr', 'al', 'xk', 'tr', 'ge', 'am', 'az', 'mn', 'kg', 'uz', 'tj', 'tm',
    'cn', 'jp', 'kr', 'kp', 'us', 'nz', 'ar', 'uy', 'cl', 'cy', 'mt', 'gi', 'ir'
  ],
  subtrop: [
    'mx', 'ma', 'dz', 'tn', 'ly', 'eg', 'il', 'jo', 'lb', 'sy', 'iq', 'af',
    'pk', 'np', 'bt', 'sa', 'kw', 'bh', 'qa', 'ae', 'om', 'tw', 'hk', 'mo',
    'au', 'za', 'na', 'bw', 'zw', 'ls', 'sz', 'py', 'bm', 'ps', 'ye', 'in',
    'bd', 'bs'
  ],
  tropic: [
    'br', 'ph', 'id', 'co', 'pe', 've', 'ec', 'do', 'gh', 'th', 'lk', 'my',
    'ke', 'ng', 'bo', 'gt', 'sg', 'sv', 'cr', 'hn', 'jm', 'pr', 'vn', 're',
    'et', 'ht', 'sn', 'tt', 'pa', 'ni', 'cu', 'cw', 'tz', 'bb', 'lc', 'cv',
    'um', 'mg', 'mu', 'ao', 'cd', 'as', 'ml', 'sr', 'vc', 'rw', 'pf', 'kh',
    'gy', 'ky', 'ci', 'mw', 'gf', 'vi', 'nc', 'bf', 'mz', 'tg', 'mq', 'dm',
    'gd', 'aw', 'zm', 'gp', 'io', 'mm', 'ai', 'pg', 'vu', 'ag', 'gu', 'mv',
    'km', 'cx', 'sc', 'bi', 'sd', 'ne', 'yt', 'bz', 'sl', 'la', 'cf', 'vg',
    'to', 'mh', 'so', 'st', 'pw', 'td', 'ss', 'ms', 'cg', 'gn', 'gq', 'wf',
    'gw', 'nu', 'sh', 'ki', 'ga', 'lr', 'sx', 'sb', 'mr', 'dj', 'tl', 'gm',
    'cc', 'tv', 'tc', 'fm', 'ck', 'nr', 'mf', 'ug', 'bj', 'cm', 'er', 'bn',
    'fj', 'bq', 'mp', 'ws', 'tk', 'bl'
  ]
};

const COUNTRY_LIGHT: ReadonlyMap<string, SceneLight> = new Map(
  (Object.entries(LIGHT_BAND_COUNTRIES) as Array<[SceneLight, readonly string[]]>).flatMap(
    ([light, codes]) => codes.map((code) => [code, light] as const)
  )
);

// Absolute-latitude cut points, used only when no country code is available.
const lightFromLatitude = (latitude: number): SceneLight => {
  const absolute = Math.abs(latitude);
  if (absolute >= 60) return 'polar';
  if (absolute >= 50) return 'boreal';
  if (absolute >= 35) return 'temperate';
  if (absolute >= 23) return 'subtrop';
  return 'tropic';
};

const selectSceneLight = (
  countryCode: string,
  latitude: number | null | undefined
): SceneLight => {
  const fromCountry = COUNTRY_LIGHT.get(countryCode);
  if (fromCountry) return fromCountry;
  const value = typeof latitude === 'number' ? latitude : Number.NaN;
  // 0/0 is the Radio Browser "unknown coordinates" sentinel, not the Gulf of Guinea.
  if (Number.isFinite(value) && value !== 0 && Math.abs(value) <= 90) {
    return lightFromLatitude(value);
  }
  return 'global';
};

const normalizeText = (value: string | null | undefined) =>
  (value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');

const normalizeLookupText = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const slugify = (value: string, fallback: string, maxLength: number) => {
  const slug = normalizeLookupText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || fallback;
};

const boundedInteger = (value: number | undefined, fallback: number, min: number, max: number) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value as number)));
};

const asCachePath = (cacheDir: string | URL) =>
  resolve(cacheDir instanceof URL ? fileURLToPath(cacheDir) : cacheDir);

const isMissingFile = (error: unknown) =>
  Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');

const utcDay = (clock: SceneArtworkClock) => {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
};

// Whole-word matching over a CLOSED keyword list. The caller's text is never
// carried anywhere else: the only thing that escapes this function is one of the
// eight SCENE_VIBES enum values, which is what makes it safe to feed an
// attacker-controlled station name in.
const matchVibe = (value: string | null | undefined): SceneVibe | null => {
  const normalized = normalizeLookupText(value || '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!normalized) return null;
  const padded = ` ${normalized} `;
  for (const [vibe, keywords] of VIBE_KEYWORDS) {
    if (keywords.some((keyword) => padded.includes(` ${keyword} `))) return vibe;
  }
  return null;
};

// Tags stay the primary signal. The station NAME is a fallback, not an override:
// tags are curated metadata, a name is marketing copy, so a name only speaks when
// tags say nothing usable. «DFM DANCE GOLD 1990s» with empty tags now reaches
// 'dance' instead of collapsing into the catch-all 'world' bucket.
export const selectSceneVibe = (
  tags: string | null | undefined,
  name?: string | null
): SceneVibe => matchVibe(tags) || matchVibe(name) || 'world';

const normalizedSignalText = (values: readonly (string | null | undefined)[]) =>
  normalizeLookupText(values.filter(Boolean).join(' '))
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const matchedMusicSignals = (
  values: readonly (string | null | undefined)[]
): readonly MusicSignal[] => {
  const normalized = normalizedSignalText(values);
  if (!normalized) return [];
  const padded = ` ${normalized} `;
  return MUSIC_SIGNALS.filter((signal) =>
    signal.aliases.some((alias) => padded.includes(` ${normalizeLookupText(alias)} `))
  );
};

const selectMusicProfile = (station: SceneArtworkStation): SceneMusicProfile => {
  const tagSignals = matchedMusicSignals([station.tags]);
  const nameSignals = matchedMusicSignals([station.name]);
  const programmingSignals = matchedMusicSignals([
    ...(station.recentTracks || []),
    ...(station.topArtists || [])
  ]);
  const tagProfile = tagSignals[0]?.profile;
  // Generic pop/spoken metadata is allowed to yield to a much more descriptive
  // broadcast observation. Specific curated tags always remain authoritative.
  if (tagProfile && tagProfile !== 'pop' && tagProfile !== 'spoken') return tagProfile;
  return programmingSignals[0]?.profile || tagProfile || nameSignals[0]?.profile || 'world';
};

const selectCachedMusicProfile = (station: SceneArtworkStation): SceneMusicProfile =>
  matchedMusicSignals([station.tags])[0]?.profile ||
  matchedMusicSignals([station.name])[0]?.profile ||
  'world';

const collectCuratedGenreLabels = (station: SceneArtworkStation): readonly string[] => {
  const labels: string[] = [];
  for (const signal of [
    ...matchedMusicSignals([station.tags]),
    ...matchedMusicSignals([station.name])
  ]) {
    if (!labels.includes(signal.label)) labels.push(signal.label);
    if (labels.length >= 6) break;
  }
  return labels;
};

const collectGenreLabels = (station: SceneArtworkStation): readonly string[] => {
  const labels: string[] = [];
  for (const signal of [
    ...matchedMusicSignals([station.tags]),
    ...matchedMusicSignals([station.name]),
    ...matchedMusicSignals([...(station.recentTracks || []), ...(station.topArtists || [])])
  ]) {
    if (!labels.includes(signal.label)) labels.push(signal.label);
    if (labels.length >= 6) break;
  }
  return labels;
};

const PROMPT_CONTROL_PATTERN = /\b(?:ignore (?:all |the )?(?:previous|prior)|system prompt|instructions?|assistant|developer message|render (?:the )?(?:words?|text)|write (?:the )?(?:words?|text))\b/i;

// Free-form labels are used only as bounded, quoted musical references. URLs,
// control-like phrases and unusual punctuation are removed before a cue can
// reach the provider. Structural direction always comes from the closed maps.
const safePromptCue = (value: string | null | undefined, maxLength: number): string | null => {
  const normalized = normalizeText(value)
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[^\p{L}\p{N}\s&'’().,+:/_-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
  if (!normalized || PROMPT_CONTROL_PATTERN.test(normalized)) return null;
  return normalized;
};

const collectTrackCues = (station: SceneArtworkStation): readonly string[] => {
  const cues: string[] = [];
  for (const value of [...(station.recentTracks || []), ...(station.topArtists || [])]) {
    const cue = safePromptCue(value, 90);
    if (!cue || cues.some((existing) => normalizeLookupText(existing) === normalizeLookupText(cue))) {
      continue;
    }
    cues.push(cue);
    if (cues.length >= 5) break;
  }
  return cues;
};

export const isValidSceneKey = (value: string): boolean => SCENE_KEY_PATTERN.test(value);

// Deterministic variant choice from a slice of the scene digest. No Math.random,
// no clock: the same scene key always yields the same sentence, forever. Because
// the digest is itself derived from the key components, this widens the visual
// spread WITHOUT adding a single new cache key.
const pickVariant = <T>(options: readonly T[], digest: string, offset: number): T => {
  const byte = Number.parseInt(digest.slice(offset, offset + 2), 16);
  const index = Number.isFinite(byte) ? byte % options.length : 0;
  return options[index] as T;
};

// The label that goes INTO THE PROMPT must be decided by the scene key, never by
// the station's free-text `country` field. Two stations can share a key while
// spelling their country differently («Deutschland» vs «Germany»); if the free
// text reached the prompt, the cached image would be whichever of them happened
// to generate first — the picture would be a function of traffic order rather
// than of the station. Intl gives one canonical English name per ISO code, with
// no table to maintain and no locale drift (the locale is pinned to 'en').
const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });

const canonicalCountryLabel = (countryCode: string, freeText: string): string => {
  if (/^[a-z]{2}$/.test(countryCode)) {
    try {
      const resolved = REGION_NAMES.of(countryCode.toUpperCase());
      // Intl echoes the input back for codes it does not know.
      if (resolved && resolved.toLowerCase() !== countryCode) {
        return resolved.slice(0, MAX_COUNTRY_LABEL_LENGTH);
      }
    } catch {
      // Unknown/ill-formed code — fall through to the free text, which in that
      // case is itself part of the key via countrySlug.
    }
  }
  return freeText;
};

export const buildSceneDescriptor = (
  station: SceneArtworkStation,
  styleVersion = DEFAULT_SCENE_STYLE_VERSION
): SceneDescriptor => {
  const countryCode = normalizeText(station.countrycode).toLowerCase();
  const rawCountry = normalizeText(station.country).slice(0, MAX_COUNTRY_LABEL_LENGTH) || 'the world';
  const country = canonicalCountryLabel(countryCode, rawCountry);
  const countryIdentity = /^[a-z]{2}$/.test(countryCode)
    ? `cc:${countryCode}`
    : `country:${normalizeLookupText(rawCountry) || 'world'}`;
  const musicProfile = selectMusicProfile(station);
  const vibe = musicProfile === 'world'
    ? selectSceneVibe(station.tags, station.name)
    : MUSIC_PROFILE_VIBES[musicProfile];
  const genreLabels = collectGenreLabels(station);
  const cachedMusicProfile = selectCachedMusicProfile(station);
  const curatedGenreLabels = collectCuratedGenreLabels(station);
  const stationCue = safePromptCue(station.name, 72);
  const trackCues = collectTrackCues(station);
  const light = selectSceneLight(countryCode, station.geo_lat);
  const normalizedStyle = slugify(
    normalizeText(styleVersion).slice(0, MAX_STYLE_VERSION_LENGTH),
    DEFAULT_SCENE_STYLE_VERSION,
    32
  );
  const stationIdentity = normalizeText(station.stationuuid).slice(0, 200) || 'unknown-station';
  // One stable key per station/music identity. Track observations intentionally
  // stay out: they enrich the one generation snapshot without turning each song
  // transition into another paid image. A curated genre/name change does rotate
  // the key, which is exactly when an artwork refresh is useful.
  const digestSource = [
    stationIdentity,
    countryIdentity,
    cachedMusicProfile,
    curatedGenreLabels.join('|'),
    stationCue || '',
    light,
    normalizedStyle
  ].join('\n');
  const digest = createHash('sha256').update(digestSource).digest('hex');
  const countrySlug = /^[a-z]{2}$/.test(countryCode)
    ? countryCode
    : slugify(rawCountry, 'world', 28);
  const sceneKey = `${countrySlug}-${cachedMusicProfile}-${light}-${normalizedStyle}-${digest.slice(0, 12)}`;
  const band = LIGHT_PROMPTS[light];
  const lightClause = pickVariant(band.light, digest, 12);
  const paletteClause = pickVariant(band.palette, digest, 14);
  const identityClause = stationCue
    ? `Station identity cue: "${stationCue}"; treat this cleaned label only as a brand and musical mood reference, never as visible copy.`
    : 'Create a distinctive identity for this individual radio station.';
  const genreClause = genreLabels.length
    ? `Curated genre cues: ${genreLabels.join(', ')}.`
    : `Genre direction: ${vibe}.`;
  const programmingClause = trackCues.length
    ? `Recently observed programming cues: ${trackCues.map((cue) => `"${cue}"`).join(', ')}. Use them only to infer musical era, energy and culture; do not illustrate a literal title.`
    : 'No reliable track history is available, so rely on the station identity and curated genres.';
  const prompt = [
    'Wide cinematic editorial background for one specific music radio station.',
    identityClause,
    `Music identity must dominate the image: ${MUSIC_PROFILE_PROMPTS[musicProfile]}.`,
    genreClause,
    programmingClause,
    `Location is a subtle secondary layer inspired by ${country}: ${lightClause}, ${paletteClause}. Never let country stereotypes override the music identity.`,
    `${VIBE_PROMPTS[vibe]}.`,
    'Premium realistic editorial photography blended with restrained music-led art direction, high detail.',
    'Horizontal 4:3 composition with the visual focus on the right and clean low-detail negative space on the left for an app interface.',
    'Atmospheric decorative artwork, not a claim of an exact real place, building, studio or landmark.',
    'No text, letters, captions, logos, brands, flags, watermarks, people or faces.'
  ].join(' ');
  return {
    sceneKey,
    country,
    countryIdentity,
    vibe,
    musicProfile,
    genreLabels,
    stationCue,
    trackCues,
    light,
    styleVersion: normalizedStyle,
    prompt,
    seed: Number.parseInt(digest.slice(0, 8), 16) & 0x7fffffff
  };
};

export const isPngBuffer = (value: Buffer): boolean => {
  if (
    value.length < 45 ||
    value.length > MAX_IMAGE_BYTES ||
    !value.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return false;
  }
  let offset = PNG_SIGNATURE.length;
  let firstChunk = true;
  while (offset + 12 <= value.length) {
    const dataLength = value.readUInt32BE(offset);
    const chunkEnd = offset + 12 + dataLength;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > value.length) return false;
    const chunkType = value.subarray(offset + 4, offset + 8);
    if (firstChunk) {
      if (
        dataLength !== 13 ||
        !chunkType.equals(PNG_IHDR) ||
        value.readUInt32BE(offset + 8) === 0 ||
        value.readUInt32BE(offset + 12) === 0
      ) {
        return false;
      }
      firstChunk = false;
    }
    if (chunkType.equals(PNG_IEND)) {
      return dataLength === 0 && chunkEnd === value.length;
    }
    offset = chunkEnd;
  }
  return false;
};

const isJpegStartOfFrame = (marker: number) =>
  (marker >= 0xc0 && marker <= 0xc3) ||
  (marker >= 0xc5 && marker <= 0xc7) ||
  (marker >= 0xc9 && marker <= 0xcb) ||
  (marker >= 0xcd && marker <= 0xcf);

export const isJpegBuffer = (value: Buffer): boolean => {
  if (
    value.length < 32 ||
    value.length > MAX_IMAGE_BYTES ||
    !value.subarray(0, 2).equals(JPEG_SOI) ||
    !value.subarray(-2).equals(JPEG_EOI)
  ) {
    return false;
  }

  let offset = 2;
  let hasFrame = false;
  while (offset < value.length - 2) {
    if (value[offset] !== 0xff) return false;
    while (offset < value.length - 2 && value[offset] === 0xff) offset += 1;
    const marker = value[offset];
    if (marker === undefined || marker === 0x00 || marker === 0xd8) return false;
    offset += 1;
    if (marker === 0xd9) return hasFrame && offset === value.length;
    // TEM and restart markers carry no length. They normally occur inside scan
    // data, but accepting them here is harmless and keeps the marker parser
    // compatible with uncommon valid encoders.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > value.length - 2) return false;
    const segmentLength = value.readUInt16BE(offset);
    if (segmentLength < 2) return false;
    const segmentEnd = offset + segmentLength;
    if (segmentEnd > value.length - 2) return false;
    if (isJpegStartOfFrame(marker)) {
      const componentCount = value[offset + 7];
      if (
        segmentLength < 8 ||
        componentCount === undefined ||
        componentCount === 0 ||
        segmentLength !== 8 + componentCount * 3 ||
        value.readUInt16BE(offset + 3) === 0 ||
        value.readUInt16BE(offset + 5) === 0
      ) {
        return false;
      }
      hasFrame = true;
    }
    // After SOS, compressed bytes use byte stuffing and restart markers rather
    // than the regular segment grammar. A parsed positive-size SOF plus a
    // bounded SOS segment and terminal EOI are sufficient format validation;
    // the browser remains the decoder.
    if (marker === 0xda) {
      const componentCount = value[offset + 2];
      return Boolean(
        hasFrame &&
          componentCount &&
          segmentLength === 6 + componentCount * 2 &&
          segmentEnd < value.length - 2
      );
    }
    offset = segmentEnd;
  }
  return false;
};

export const detectSceneArtworkImage = (data: Buffer): SceneArtworkImage | null => {
  if (isPngBuffer(data)) {
    return { data, format: 'png', extension: 'png', mimeType: 'image/png' };
  }
  if (isJpegBuffer(data)) {
    return { data, format: 'jpeg', extension: 'jpg', mimeType: 'image/jpeg' };
  }
  return null;
};

const findImageBase64 = (body: unknown): string | null => {
  if (typeof body === 'string') return body;
  if (!body || typeof body !== 'object') return null;
  const value = body as Record<string, unknown>;
  if (typeof value.image === 'string') return value.image;
  if (typeof value.result === 'string') return value.result;
  if (value.result && typeof value.result === 'object') {
    const result = value.result as Record<string, unknown>;
    if (typeof result.image === 'string') return result.image;
  }
  return null;
};

const decodeCloudflareBase64 = (body: unknown): Buffer => {
  const raw = findImageBase64(body)?.trim() || '';
  const base64 = raw.replace(/^data:image\/(?:png|jpe?g);base64,/i, '').replace(/\s+/g, '');
  const remainder = base64.length % 4;
  if (
    !base64 ||
    remainder === 1 ||
    (base64.includes('=') && remainder !== 0) ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
  ) {
    throw new Error('Cloudflare image response is not valid base64');
  }
  const padded = base64.padEnd(base64.length + ((4 - remainder) % 4), '=');
  const data = Buffer.from(padded, 'base64');
  if (data.toString('base64').replace(/=+$/g, '') !== base64.replace(/=+$/g, '')) {
    throw new Error('Cloudflare image response is not valid base64');
  }
  return data;
};

export const decodeCloudflareImage = (body: unknown): SceneArtworkImage => {
  const data = decodeCloudflareBase64(body);
  const image = detectSceneArtworkImage(data);
  if (!image) throw new Error('Cloudflare image response is not a valid PNG or JPEG');
  return image;
};

// Compatibility helper retained for callers/tests that specifically require a
// PNG. The provider path itself uses decodeCloudflareImage and accepts JPEG.
export const decodeCloudflarePng = (body: unknown): Buffer => {
  const data = decodeCloudflareBase64(body);
  if (!isPngBuffer(data)) throw new Error('Cloudflare image response is not a valid PNG');
  return data;
};

type QueueTask = {
  descriptor: SceneDescriptor;
  complete: () => void;
};

type PersistedQuota = {
  utcDate: string;
  count: number;
};

export const createSceneArtworkService = (config: SceneArtworkConfig): SceneArtworkService => {
  const accountId = normalizeText(config.accountId);
  const apiToken = normalizeText(config.apiToken);
  const enabled = Boolean(config.enabled && accountId && apiToken);
  const cacheDir = asCachePath(config.cacheDir);
  const quotaPath = resolve(cacheDir, QUOTA_FILE);
  const styleVersion = config.styleVersion || DEFAULT_SCENE_STYLE_VERSION;
  const dailyCap = boundedInteger(config.dailyCap, DEFAULT_SCENE_DAILY_CAP, 0, 10_000);
  const maxConcurrency = boundedInteger(
    config.maxConcurrency,
    DEFAULT_MAX_CONCURRENCY,
    1,
    8
  );
  const maxQueueSize = boundedInteger(config.maxQueueSize, DEFAULT_MAX_QUEUE_SIZE, 0, 500);
  const width = boundedInteger(config.width, DEFAULT_WIDTH, 256, 1920);
  const height = boundedInteger(config.height, DEFAULT_HEIGHT, 256, 1920);
  const timeoutMs = boundedInteger(config.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 120_000);
  const fetchImpl = config.fetch || globalThis.fetch.bind(globalThis);
  const clock = config.now || (() => Date.now());
  const log = config.log || (() => {});

  const pending: QueueTask[] = [];
  const jobs = new Map<string, Promise<void>>();
  const idleWaiters = new Set<() => void>();
  let active = 0;
  let scheduleTail: Promise<void> = Promise.resolve();

  const withScheduleLock = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = scheduleTail;
    let release = () => {};
    scheduleTail = new Promise<void>((resolveLock) => {
      release = resolveLock;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };

  const imagePath = (sceneKey: string, extension: SceneArtworkExtension) =>
    resolve(cacheDir, `${sceneKey}.${extension}`);

  const readImage = async (
    sceneKey: string,
    extension?: SceneArtworkExtension
  ): Promise<SceneArtworkImage | null> => {
    if (!isValidSceneKey(sceneKey)) return null;
    const extensions: readonly SceneArtworkExtension[] = extension ? [extension] : ['jpg', 'png'];
    for (const candidateExtension of extensions) {
      const target = imagePath(sceneKey, candidateExtension);
      try {
        const data = await readFile(target);
        const image = detectSceneArtworkImage(data);
        if (image?.extension === candidateExtension) return image;
        // Extension/content mismatch or corrupt bytes: do not serve with a
        // misleading MIME, and remove the poisoned cache entry fail-soft.
        await unlink(target).catch(() => {});
      } catch (error) {
        if (!isMissingFile(error)) log('scene artwork cache read failed', error);
      }
    }
    return null;
  };

  const readPng = async (sceneKey: string): Promise<Buffer | null> =>
    (await readImage(sceneKey, 'png'))?.data || null;

  const atomicWrite = async (target: string, contents: Buffer | string) => {
    await mkdir(cacheDir, { recursive: true });
    const temporary = resolve(cacheDir, `.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, contents);
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
  };

  const readQuota = async (date: string): Promise<PersistedQuota | null> => {
    try {
      const raw = await readFile(quotaPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedQuota>;
      if (
        typeof parsed.utcDate !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(parsed.utcDate) ||
        !Number.isInteger(parsed.count) ||
        (parsed.count as number) < 0
      ) {
        return null;
      }
      if (parsed.utcDate !== date) return { utcDate: date, count: 0 };
      return { utcDate: parsed.utcDate, count: parsed.count as number };
    } catch (error) {
      if (isMissingFile(error)) return { utcDate: date, count: 0 };
      log('scene artwork daily quota read failed', error);
      return null;
    }
  };

  const reserveDailyAttempt = async (): Promise<boolean> => {
    if (dailyCap <= 0) return false;
    const date = utcDay(clock);
    const quota = await readQuota(date);
    // A corrupt/unreadable quota file fails closed: never risk a paid burst.
    if (!quota || quota.count >= dailyCap) return false;
    await atomicWrite(
      quotaPath,
      JSON.stringify({ utcDate: date, count: quota.count + 1 } satisfies PersistedQuota)
    );
    return true;
  };

  const requestCloudflare = async (descriptor: SceneDescriptor): Promise<SceneArtworkImage> => {
    const form = new FormData();
    form.append('prompt', descriptor.prompt);
    form.append('width', String(width));
    form.append('height', String(height));
    form.append('seed', String(descriptor.seed));
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${CLOUDFLARE_SCENE_MODEL}`;
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}` },
      body: form,
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      throw new Error(`Cloudflare scene generation failed (${response.status})`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new Error('Cloudflare scene response is not JSON', { cause: error });
    }
    return decodeCloudflareImage(body);
  };

  const generate = async (descriptor: SceneDescriptor) => {
    if (await readImage(descriptor.sceneKey)) return;
    const image = await requestCloudflare(descriptor);
    await atomicWrite(imagePath(descriptor.sceneKey, image.extension), image.data);
  };

  const notifyIdle = () => {
    if (jobs.size > 0 || pending.length > 0 || active > 0) return;
    for (const resolveIdle of idleWaiters) resolveIdle();
    idleWaiters.clear();
  };

  const pump = () => {
    while (active < maxConcurrency && pending.length > 0) {
      const task = pending.shift();
      if (!task) break;
      active += 1;
      void generate(task.descriptor)
        .catch((error) => log(`scene artwork generation failed for ${task.descriptor.sceneKey}`, error))
        .finally(() => {
          active -= 1;
          jobs.delete(task.descriptor.sceneKey);
          task.complete();
          pump();
          notifyIdle();
        });
    }
  };

  const enqueue = async (descriptor: SceneDescriptor): Promise<'ready' | 'queued' | 'unavailable'> =>
    withScheduleLock(async () => {
      if (await readImage(descriptor.sceneKey)) return 'ready';
      if (jobs.has(descriptor.sceneKey)) return 'queued';
      if (active >= maxConcurrency && pending.length >= maxQueueSize) return 'unavailable';
      try {
        if (!(await reserveDailyAttempt())) return 'unavailable';
      } catch (error) {
        log('scene artwork daily quota persist failed', error);
        return 'unavailable';
      }

      let complete = () => {};
      const completion = new Promise<void>((resolveCompletion) => {
        complete = resolveCompletion;
      });
      jobs.set(descriptor.sceneKey, completion);
      pending.push({ descriptor, complete });
      pump();
      return 'queued';
    });

  const metadata = (
    status: SceneArtworkStatus,
    sceneKey: string,
    image?: Pick<SceneArtworkImage, 'extension'>
  ): SceneArtworkMetadata =>
    status === 'ready' && image
      ? { status, sceneKey, url: `/artwork/scenes/${sceneKey}.${image.extension}` }
      : { status, sceneKey };

  const resolveScene = async (
    station: SceneArtworkStation,
    options: { generate?: boolean } = {}
  ): Promise<SceneArtworkMetadata> => {
    const descriptor = buildSceneDescriptor(station, styleVersion);
    const cached = await readImage(descriptor.sceneKey);
    if (cached) return metadata('ready', descriptor.sceneKey, cached);
    if (!enabled) return metadata('disabled', descriptor.sceneKey);
    if (!options.generate) return metadata('unavailable', descriptor.sceneKey);
    const queued = await enqueue(descriptor);
    if (queued === 'ready') {
      const raceWinner = await readImage(descriptor.sceneKey);
      return raceWinner
        ? metadata('ready', descriptor.sceneKey, raceWinner)
        : metadata('unavailable', descriptor.sceneKey);
    }
    return metadata(queued, descriptor.sceneKey);
  };

  const whenIdle = (): Promise<void> => {
    if (jobs.size === 0 && pending.length === 0 && active === 0) return Promise.resolve();
    return new Promise((resolveIdle) => idleWaiters.add(resolveIdle));
  };

  return { enabled, resolve: resolveScene, readImage, readPng, whenIdle };
};
