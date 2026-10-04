import { getApiBase } from './apiBase';

const SESSION_STORAGE_KEY = 'radio:session:v1';
export const MUSIC_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export type MusicImageCandidate = { artist: string; title: string; uncertain: boolean };
export type MusicImageFailure = 'file' | 'tooLarge' | 'unavailable' | 'timeout' | 'rateLimited' | 'response';

export class MusicImageError extends Error {
  readonly code: MusicImageFailure;
  constructor(code: MusicImageFailure) {
    super(code);
    this.name = 'MusicImageError';
    this.code = code;
  }
}

const readToken = (): string => {
  try { return localStorage.getItem(SESSION_STORAGE_KEY) || ''; } catch { return ''; }
};

const apiUrl = (path: string) => {
  const base = getApiBase().replace(/\/+$/, '');
  if (!base) throw new MusicImageError('unavailable');
  return `${base}${path}`;
};

export const getMusicImageCapability = async (signal?: AbortSignal): Promise<boolean> => {
  try {
    const response = await fetch(apiUrl('/ai/music-image'), {
      headers: readToken() ? { Authorization: `Bearer ${readToken()}` } : undefined,
      signal
    });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return Boolean(body && typeof body === 'object' && (body as { enabled?: unknown }).enabled === true);
  } catch {
    return false;
  }
};

const cleanText = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/[\r\n\u2028\u2029\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : '';

export const parseMusicImageCandidates = (value: unknown): MusicImageCandidate[] => {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { candidates?: unknown }).candidates)) {
    throw new MusicImageError('response');
  }
  const seen = new Set<string>();
  return ((value as { candidates: unknown[] }).candidates).flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const item = candidate as Record<string, unknown>;
    const artist = cleanText(item.artist);
    const title = cleanText(item.title);
    if (artist.length > 120 || !title || title.length > 180 || typeof item.uncertain !== 'boolean') return [];
    if (/https?:\/\//i.test(`${artist} ${title}`)) return [];
    const key = `${artist}\u0000${title}`.toLocaleLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ artist, title, uncertain: item.uncertain }];
  }).slice(0, 5);
};

export const recognizeMusicImage = async (file: File, signal?: AbortSignal): Promise<MusicImageCandidate[]> => {
  if (!MIME_TYPES.has(file.type)) throw new MusicImageError('file');
  if (file.size > MUSIC_IMAGE_MAX_BYTES) throw new MusicImageError('tooLarge');
  if (file.size <= 0) throw new MusicImageError('file');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new AbortController();
  const abortFromCaller = () => timeout.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener('abort', abortFromCaller, { once: true });
  timer = setTimeout(() => timeout.abort('deadline'), 28_000);
  try {
    const response = await fetch(apiUrl('/ai/music-image'), {
      method: 'POST',
      headers: {
        'Content-Type': file.type,
        ...(readToken() ? { Authorization: `Bearer ${readToken()}` } : {})
      },
      body: file,
      signal: timeout.signal
    });
    if (!response.ok) {
      if (response.status === 413) throw new MusicImageError('tooLarge');
      if (response.status === 415 || response.status === 400) throw new MusicImageError('file');
      if (response.status === 429) throw new MusicImageError('rateLimited');
      if (response.status === 504) throw new MusicImageError('timeout');
      if (response.status === 503 || response.status === 404) throw new MusicImageError('unavailable');
      throw new MusicImageError('response');
    }
    return parseMusicImageCandidates(await response.json());
  } catch (error) {
    if (error instanceof MusicImageError) throw error;
    if (timeout.signal.aborted && !signal?.aborted) throw new MusicImageError('timeout');
    if (signal?.aborted) throw error;
    throw new MusicImageError('unavailable');
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
};

const safeTrackLabel = (artist: string, title: string) =>
  cleanText(`${artist} — ${title}`).slice(0, 180) || 'Unknown';

export const frameMusicImageQuestion = (
  track: string | Pick<MusicImageCandidate, 'artist' | 'title'>,
  question: string,
  locale: 'ru' | 'en' | string
): string => {
  const label = typeof track === 'string' ? cleanText(track).slice(0, 180) : safeTrackLabel(track.artist, track.title);
  const singleLine = cleanText(label).slice(0, 180);
  return locale === 'ru'
    ? `О песне с картинки «${singleLine}»:\n${question}`
    : `About song from image “${singleLine}”:\n${question}`;
};
