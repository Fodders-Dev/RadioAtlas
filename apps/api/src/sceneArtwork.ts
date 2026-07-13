import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLOUDFLARE_SCENE_MODEL = '@cf/black-forest-labs/flux-2-klein-4b';
export const DEFAULT_SCENE_STYLE_VERSION = 'atlas-night-v1';
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

export type SceneArtworkStation = {
  stationuuid: string;
  name?: string | null;
  country?: string | null;
  countrycode?: string | null;
  state?: string | null;
  tags?: string | null;
};

export type SceneDescriptor = {
  sceneKey: string;
  country: string;
  countryIdentity: string;
  vibe: SceneVibe;
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
  ['dance', ['dance', 'edm', 'electronic', 'house', 'techno', 'trance', 'club', 'disco']],
  ['chill', ['chill', 'chillout', 'lounge', 'ambient', 'downtempo', 'lofi', 'easy listening', 'meditation']],
  ['news', ['news', 'talk', 'speech', 'information', 'politics', 'current affairs']],
  ['retro', ['oldies', 'retro', 'vintage', 'classic hits', '80s', '90s', '70s']],
  ['road', ['rock', 'country', 'indie', 'alternative', 'metal', 'punk', 'americana']],
  ['pop', ['pop', 'j-pop', 'k-pop', 'top 40', 'hits', 'chart']]
];

const VIBE_PROMPTS: Record<SceneVibe, string> = {
  chill: 'calm blue-hour atmosphere, soft reflections, spacious composition and gentle light',
  dance: 'energetic neon nightlife, rhythmic city lights, saturated cyan and magenta accents',
  jazz: 'elegant late-night mood, warm amber windows, deep shadows and sophisticated atmosphere',
  news: 'modern metropolitan skyline, crisp architectural lines, confident restrained lighting',
  pop: 'bright contemporary city atmosphere, vivid color accents, polished optimistic energy',
  retro: 'timeless analog-film atmosphere, subtle grain, warm practical lights and nostalgic color',
  road: 'cinematic open road or urban transit at dusk, motion, horizon lights and a sense of travel',
  world: 'cinematic landscape and architecture, atmospheric local character and natural evening light'
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

export const selectSceneVibe = (tags: string | null | undefined): SceneVibe => {
  const normalized = normalizeLookupText(tags || '').replace(/[;,|/]+/g, ' ');
  if (!normalized) return 'world';
  const padded = ` ${normalized} `;
  for (const [vibe, keywords] of VIBE_KEYWORDS) {
    if (keywords.some((keyword) => padded.includes(` ${keyword} `))) return vibe;
  }
  return 'world';
};

export const isValidSceneKey = (value: string): boolean => SCENE_KEY_PATTERN.test(value);

export const buildSceneDescriptor = (
  station: SceneArtworkStation,
  styleVersion = DEFAULT_SCENE_STYLE_VERSION
): SceneDescriptor => {
  const countryCode = normalizeText(station.countrycode).toLowerCase();
  const country = normalizeText(station.country).slice(0, MAX_COUNTRY_LABEL_LENGTH) || 'the world';
  const countryIdentity = /^[a-z]{2}$/.test(countryCode)
    ? `cc:${countryCode}`
    : `country:${normalizeLookupText(country) || 'world'}`;
  const vibe = selectSceneVibe(station.tags);
  const normalizedStyle = slugify(
    normalizeText(styleVersion).slice(0, MAX_STYLE_VERSION_LENGTH),
    DEFAULT_SCENE_STYLE_VERSION,
    32
  );
  const digestSource = `${countryIdentity}\n${vibe}\n${normalizedStyle}`;
  const digest = createHash('sha256').update(digestSource).digest('hex');
  const countrySlug = /^[a-z]{2}$/.test(countryCode)
    ? countryCode
    : slugify(country, 'world', 28);
  const sceneKey = `${countrySlug}-${vibe}-${normalizedStyle}-${digest.slice(0, 12)}`;
  const prompt = [
    `Wide cinematic editorial background inspired by ${country}.`,
    VIBE_PROMPTS[vibe],
    'Premium realistic photography, deep navy evening palette, luminous cyan accent, high detail.',
    'Horizontal 4:3 composition with the visual focus on the right and clean darker negative space on the left for an app interface.',
    'Atmospheric decorative artwork, not a claim of an exact real place.',
    'No text, letters, captions, logos, brands, flags, watermarks, people or faces.'
  ].join(' ');
  return {
    sceneKey,
    country,
    countryIdentity,
    vibe,
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
