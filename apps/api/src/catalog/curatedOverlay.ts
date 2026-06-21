// Curated station overlay — owner-maintained rows that supersede broken or
// missing Radio Browser entries. Re-applied on EVERY catalog load (all ingress
// paths in index.ts) so it survives the 30-min live Radio-Browser refetch, the
// snapshot fallback, and the daily artifact cron alike.
//
// First network: Radio Vanya (radiovanya.ru). Radio Browser shipped two of its
// sub-streams pointed at dead pcradio mounts (HTTP 502) yet still flagged
// lastcheckok=1, so the upstream-health demotion net never caught them and they
// played fine "before" then silently died. Their real CDN mounts on
// icecast-radiovanya.cdnvideo.ru are live (200 audio/aacp) AND already wired for
// live track titles via metadataService RADIO_VANYA_HOSTS — so fixing the
// url_resolved fixes playback AND now-playing titles at once.
//
// The type-only import is erased at compile time, so this module has NO runtime
// dependency on the server entry (no boot side-effects, no import cycle).
import type { Station } from '../index.js';

const CDN_HOST = 'icecast-radiovanya.cdnvideo.ru';
const HOMEPAGE = 'https://radiovanya.ru/';
// Mounts curl-verified 200 audio/aacp on 2026-06-21. Re-verify if Radio Vanya
// rotates their CDN; client-side stationHealth still demotes a dead mount on
// real playback failures, so a future rot is not invisible (see fork note in PR).
const VERIFIED_AT = Date.UTC(2026, 5, 21);
// Moscow — Radio Vanya is a federal Russian network; gives the curated rows a
// sensible globe position when an upstream row didn't carry geo.
const MOSCOW_LAT = 55.7558;
const MOSCOW_LONG = 37.6173;

type CuratedStream = {
  /** radiovanya.ru slug (used to derive Latin search aliases). */
  slug: string;
  /** Exact, case-sensitive CDN mount URL (mount paths ARE case sensitive). */
  url: string;
  /** Display name, keeps the «Радио Ваня» prefix so the brand query matches all. */
  name: string;
  /** Sub-stream label, e.g. «Весёлый Дэнс». */
  shortName: string;
  /** Extra search phrases (Cyrillic/Latin variants) for findability. */
  aliases?: string[];
  /** Dead Radio-Browser UUIDs this stream replaces in-place (favorites survive). */
  supersedeUuids?: string[];
  /** Stable curated id used only when no existing row is matched/superseded. */
  fallbackUuid: string;
};

// Source of truth: https://radiovanya.ru/api/v1/streams/ (20 official streams).
const CURATED: CuratedStream[] = [
  { slug: 'rv', url: 'https://icecast-radiovanya.cdnvideo.ru/radiovanya', name: 'Радио Ваня — Радио Ваня', shortName: 'Радио Ваня', fallbackUuid: 'curated-radiovanya-main' },
  { slug: 'rv_spb', url: 'https://icecast-radiovanya.cdnvideo.ru/rv_spb', name: 'Радио Ваня — Радио Ваня СПб', shortName: 'Радио Ваня СПб', aliases: ['спб', 'санкт-петербург', 'питер'], fallbackUuid: 'curated-radiovanya-spb' },
  { slug: 'rv_hit', url: 'https://icecast-radiovanya.cdnvideo.ru/rv_hit', name: 'Радио Ваня — Новьё', shortName: 'Новьё', aliases: ['новье', 'хиты', 'new', 'свежее'], fallbackUuid: 'curated-radiovanya-hit' },
  { slug: 'rv_fabrikanty', url: 'https://icecast-radiovanya.cdnvideo.ru/rv_fabrikanty', name: 'Радио Ваня — Фабрика Звёзд', shortName: 'Фабрика Звёзд', aliases: ['фабрика звезд', 'фабриканты'], fallbackUuid: 'curated-radiovanya-fabrikanty' },
  { slug: 'rv_90', url: 'https://icecast-radiovanya.cdnvideo.ru/rv_90', name: 'Радио Ваня — Не лихие 90-е', shortName: 'Не лихие 90-е', aliases: ['90-е', '90е', 'девяностые', '90s', 'не лихие 90'], supersedeUuids: ['3e1e6384-ba86-4dd7-82f0-6ad163c6fc48'], fallbackUuid: 'curated-radiovanya-90' },
  { slug: 'rv_happy_dance', url: 'https://icecast-radiovanya.cdnvideo.ru/rv_Happy_Dance', name: 'Радио Ваня — Весёлый Дэнс', shortName: 'Весёлый Дэнс', aliases: ['весёлый dance', 'весёлый данс', 'веселый дэнс', 'танцы', 'happy dance'], supersedeUuids: ['e9e50308-e8c8-4605-8888-38638f941f34'], fallbackUuid: 'curated-radiovanya-happy-dance' },
  { slug: 'rv_retro', url: 'https://icecast-radiovanya.cdnvideo.ru/rv_retro', name: 'Радио Ваня — Школьная Дискотека', shortName: 'Школьная Дискотека', aliases: ['ретро', 'retro', 'дискотека', '80-е'], fallbackUuid: 'curated-radiovanya-retro' },
  { slug: 'rv_techno_dance', url: 'https://icecast-radiovanya.cdnvideo.ru/rv_techno_dance', name: 'Радио Ваня — Техно Дэнс', shortName: 'Техно Дэнс', aliases: ['техно данс', 'techno', 'танцы'], fallbackUuid: 'curated-radiovanya-techno' },
  { slug: 'rv_medlyaki', url: 'https://icecast-radiovanya.cdnvideo.ru/rv_medlyaki', name: 'Радио Ваня — Медляки', shortName: 'Медляки', aliases: ['медленные', 'lyrics', 'романтика'], fallbackUuid: 'curated-radiovanya-medlyaki' },
  { slug: 'rv_latina_dance', url: 'https://icecast-radiovanya.cdnvideo.ru/rv_latina_dance', name: 'Радио Ваня — Латина Дэнс', shortName: 'Латина Дэнс', aliases: ['латина данс', 'latina', 'латино', 'танцы'], fallbackUuid: 'curated-radiovanya-latina' },
  { slug: 'rv_ruki_vverh', url: 'https://icecast-radiovanya.cdnvideo.ru/rv_ruki_vverh', name: 'Радио Ваня — Руки Вверх!', shortName: 'Руки Вверх!', aliases: ['руки вверх', 'ruki vverh'], fallbackUuid: 'curated-radiovanya-ruki-vverh' },
  { slug: 'rv_gubin', url: 'https://icecast-radiovanya.cdnvideo.ru/rv_gubin', name: 'Радио Ваня — Андрей Губин', shortName: 'Андрей Губин', aliases: ['губин', 'gubin'], fallbackUuid: 'curated-radiovanya-gubin' },
  { slug: 'rv_diskoteka_avaria', url: 'https://icecast-radiovanya.cdnvideo.ru/rv_diskoteka_avaria', name: 'Радио Ваня — Дискотека Авария', shortName: 'Дискотека Авария', aliases: ['дискотека авария', 'avaria'], fallbackUuid: 'curated-radiovanya-avaria' },
  { slug: 'rv_vintage', url: 'https://icecast-radiovanya.cdnvideo.ru/rv_vintage', name: 'Радио Ваня — Винтаж', shortName: 'Винтаж', aliases: ['винтаж', 'vintage'], fallbackUuid: 'curated-radiovanya-vintage' },
  { slug: 'rv_nysha', url: 'https://icecast-radiovanya.cdnvideo.ru/rv_nysha', name: 'Радио Ваня — NYUSHA', shortName: 'NYUSHA', aliases: ['нюша', 'nyusha'], fallbackUuid: 'curated-radiovanya-nyusha' },
  { slug: 'rv_mari_kraimbrery', url: 'https://icecast-radiovanya.cdnvideo.ru/rv_mari_kraimbrery', name: 'Радио Ваня — Мари Краймбрери', shortName: 'Мари Краймбрери', aliases: ['мари краймбрери', 'mari kraimbrery'], fallbackUuid: 'curated-radiovanya-mari' },
  { slug: 'rv_ivanushki', url: 'https://icecast-radiovanya.cdnvideo.ru/rv_ivanushki', name: 'Радио Ваня — Иванушки International', shortName: 'Иванушки International', aliases: ['иванушки', 'ivanushki'], fallbackUuid: 'curated-radiovanya-ivanushki' },
  { slug: 'rv_bilan', url: 'https://icecast-radiovanya.cdnvideo.ru/rv_bilan', name: 'Радио Ваня — Дима Билан', shortName: 'Дима Билан', aliases: ['дима билан', 'bilan'], fallbackUuid: 'curated-radiovanya-bilan' },
  { slug: 'rv_artik_asti', url: 'https://icecast-radiovanya.cdnvideo.ru/rv_artik_asti', name: 'Радио Ваня — Artik & Asti', shortName: 'Artik & Asti', aliases: ['артик и асти', 'artik asti', 'artik & asti'], fallbackUuid: 'curated-radiovanya-artik-asti' },
  { slug: 'rv_gosti', url: 'https://icecast-radiovanya.cdnvideo.ru/rv_gosti', name: 'Радио Ваня — Гости из будущего', shortName: 'Гости из будущего', aliases: ['гости из будущего', 'gosti'], fallbackUuid: 'curated-radiovanya-gosti' }
];

// Health fields normalizeStation attaches but the local Station type doesn't
// declare; carried structurally so curated rows can set them without a cast.
type HealthFields = { lastcheckok?: 0 | 1; lastcheckok_at?: number | null };
type CatalogRow = Station & HealthFields;

/** Lowercased CDN mount path of a row, or null if it isn't a cdnvideo URL. */
const cdnMountOf = (rawUrl: string): string | null => {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname.toLowerCase() !== CDN_HOST) return null;
    const mount = parsed.pathname.replace(/^\/+/, '').toLowerCase();
    return mount || null;
  } catch {
    return null;
  }
};

const buildTags = (stream: CuratedStream): string => {
  const short = stream.shortName.toLowerCase();
  const slugWords = stream.slug.replace(/^rv_?/, '').replace(/_/g, ' ').trim().toLowerCase();
  const phrases = [
    'радио ваня',
    'radio vanya',
    'vanya',
    short,
    `радио ваня ${short}`,
    slugWords,
    slugWords ? `радио ваня ${slugWords}` : '',
    ...(stream.aliases ?? []),
    'russian',
    'россия'
  ]
    .map((phrase) => phrase.trim().toLowerCase())
    .filter(Boolean);
  // Comma-joined so each phrase stays a contiguous substring in the haystack —
  // lets multi-word queries («радио ваня весёлый дэнс») match despite the search
  // gate being a single .includes() (no tokenization yet).
  return Array.from(new Set(phrases)).join(', ');
};

const buildRow = (stream: CuratedStream, uuid: string, base?: CatalogRow): CatalogRow => ({
  ...(base ?? {}),
  stationuuid: uuid,
  name: stream.name,
  url: stream.url,
  url_resolved: stream.url,
  homepage: HOMEPAGE,
  favicon: base?.favicon || '',
  tags: buildTags(stream),
  country: base?.country || 'The Russian Federation',
  countrycode: base?.countrycode || 'RU',
  state: base?.state || '',
  language: base?.language || 'russian',
  codec: 'AAC',
  bitrate: typeof base?.bitrate === 'number' && base.bitrate > 0 ? base.bitrate : 64,
  geo_lat: typeof base?.geo_lat === 'number' ? base.geo_lat : MOSCOW_LAT,
  geo_long: typeof base?.geo_long === 'number' ? base.geo_long : MOSCOW_LONG,
  lastcheckok: 1,
  lastcheckok_at: VERIFIED_AT
});

/**
 * Apply the curated overlay to a station array. Pure: returns a new array,
 * never mutates the input. For each curated stream it claims the UUID of any
 * existing row that resolves to the same CDN mount (preserving favorites and
 * upstream ranking signal by spreading that row as the base), else the UUID of
 * an explicitly-superseded dead row (fix-in-place), else a stable fresh id.
 * Removed rows: the matched/superseded ones only — unrelated stations (other
 * hosts, regional FM signals) are untouched.
 */
export const applyCuratedOverlay = (stations: Station[]): Station[] => {
  const rows = stations as CatalogRow[];
  const byUuid = new Map<string, CatalogRow>();
  const byMount = new Map<string, CatalogRow>();
  for (const row of rows) {
    if (row.stationuuid && !byUuid.has(row.stationuuid)) byUuid.set(row.stationuuid, row);
    const mount = cdnMountOf(row.url_resolved || row.url || '');
    if (mount && !byMount.has(mount)) byMount.set(mount, row);
  }

  const removeUuids = new Set<string>();
  const curatedRows: CatalogRow[] = [];

  for (const stream of CURATED) {
    const mount = cdnMountOf(stream.url);
    const mountMatch = mount ? byMount.get(mount) : undefined;
    let base: CatalogRow | undefined;
    let uuid = stream.fallbackUuid;
    if (mountMatch) {
      base = mountMatch;
      uuid = mountMatch.stationuuid;
      removeUuids.add(mountMatch.stationuuid);
    }
    for (const dead of stream.supersedeUuids ?? []) {
      const deadRow = byUuid.get(dead);
      if (!deadRow) continue;
      removeUuids.add(dead);
      if (!mountMatch) {
        base = deadRow;
        uuid = dead;
      }
    }
    curatedRows.push(buildRow(stream, uuid, base));
  }

  const kept = rows.filter((row) => !removeUuids.has(row.stationuuid));
  return [...kept, ...curatedRows];
};
