// Deterministic, network-free external-music search links. Used for ANY music
// that is not a radio station (a specific track / album / artist — pop,
// underground, film & game OSTs). Each link points to the service's SEARCH
// page for the query, NEVER a guessed resource id, so it is structurally
// immune to hallucination.

import type { MusicService, ServiceLink } from './types.js';

const SERVICE_LABELS: Record<MusicService, string> = {
  yandex: 'Яндекс Музыка',
  zvuk: 'Звук',
  vk: 'VK Музыка',
  spotify: 'Spotify',
  soundcloud: 'SoundCloud',
  youtube: 'YouTube'
};

// Each builder receives the ALREADY url-encoded query. Spotify takes the query
// in the path; the rest as a query-string parameter.
const SERVICE_URL_BUILDERS: Record<MusicService, (encoded: string) => string> = {
  yandex: (q) => `https://music.yandex.ru/search?text=${q}`,
  zvuk: (q) => `https://zvuk.com/search?query=${q}`,
  vk: (q) => `https://vk.com/audio?q=${q}`,
  spotify: (q) => `https://open.spotify.com/search/${q}`,
  soundcloud: (q) => `https://soundcloud.com/search?q=${q}`,
  youtube: (q) => `https://www.youtube.com/results?search_query=${q}`
};

export const ALL_MUSIC_SERVICES: MusicService[] = [
  'yandex',
  'zvuk',
  'vk',
  'spotify',
  'soundcloud',
  'youtube'
];

export const isMusicService = (value: string): value is MusicService =>
  (ALL_MUSIC_SERVICES as string[]).includes(value);

// Parse the env list (AI_MUSIC_SERVICES) → ordered, de-duped, valid services.
// Empty / invalid → all six.
export const parseMusicServices = (raw: string | undefined): MusicService[] => {
  const parsed = String(raw || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is MusicService => isMusicService(item));
  const deduped = Array.from(new Set(parsed));
  return deduped.length ? deduped : [...ALL_MUSIC_SERVICES];
};

export const buildServiceSearchLinks = (
  query: string,
  services: MusicService[] = ALL_MUSIC_SERVICES
): ServiceLink[] => {
  const trimmed = String(query || '').trim();
  if (!trimmed) return [];
  const encoded = encodeURIComponent(trimmed);
  return services.map((service) => ({
    service,
    label: SERVICE_LABELS[service],
    url: SERVICE_URL_BUILDERS[service](encoded),
    query: trimmed
  }));
};
