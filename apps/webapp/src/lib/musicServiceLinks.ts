/**
 * "I like this track — open it in my music service" without a round trip.
 *
 * The assistant already produced these links, but reaching them meant opening
 * the chat and asking, which is a lot of steps for something you want the moment
 * you hear the song. They are pure SEARCH urls — no ids, no lookups, no network
 * — so the player can build them itself and the button is instant.
 *
 * Mirrors apps/api/src/ai/musicLinks.ts deliberately: same services, same order,
 * same url shapes. A search page (never a guessed track id) is also what makes
 * this structurally honest — we are handing over the query, not claiming to know
 * which release it is.
 */

export type MusicServiceId = 'yandex' | 'zvuk' | 'vk' | 'spotify' | 'soundcloud' | 'youtube';

export type MusicServiceLink = {
  service: MusicServiceId;
  label: string;
  url: string;
};

const SERVICE_LABELS: Record<MusicServiceId, string> = {
  yandex: 'Яндекс Музыка',
  zvuk: 'Звук',
  vk: 'VK Музыка',
  spotify: 'Spotify',
  soundcloud: 'SoundCloud',
  youtube: 'YouTube'
};

const SERVICE_URL: Record<MusicServiceId, (encoded: string) => string> = {
  yandex: (q) => `https://music.yandex.ru/search?text=${q}`,
  zvuk: (q) => `https://zvuk.com/search?query=${q}`,
  vk: (q) => `https://vk.com/audio?q=${q}`,
  spotify: (q) => `https://open.spotify.com/search/${q}`,
  soundcloud: (q) => `https://soundcloud.com/search?q=${q}`,
  youtube: (q) => `https://www.youtube.com/results?search_query=${q}`
};

export const MUSIC_SERVICES: readonly MusicServiceId[] = [
  'yandex',
  'zvuk',
  'vk',
  'spotify',
  'soundcloud',
  'youtube'
];

/**
 * ICY metadata is a free-text field, and stations put their own advertising in
 * it. Searching for «… - walmradio.com» or «Unknown» finds nothing, so strip the
 * station's own noise before it becomes a query.
 */
export const cleanTrackQuery = (raw: string | null | undefined): string => {
  let text = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';

  // Trailing station self-promotion: "Artist - Title - walmradio.com",
  // "Title | radio.example", "Title (radiorecord.ru)".
  text = text
    .replace(/[\s|\-–—(\[]+(?:www\.)?[a-z0-9-]+\.(?:com|ru|net|org|fm|io|tv|online|radio)\b[)\]]?\s*$/i, '')
    .replace(/\s*[|/]\s*(?:radio|радио)\b[^|/]*$/i, '')
    .trim();

  // Placeholders that stations emit when they have no metadata at all.
  if (/^(?:unknown(?:\s+artist)?|n\/?a|no\s+data|нет\s+данных|реклама|advert(?:ising)?)$/i.test(text)) {
    return '';
  }
  // A bare station name is not a track; require something that looks like a
  // title — at least two words, or an artist/title separator.
  if (!/[-–—]/.test(text) && text.split(' ').length < 2) return '';

  return text.slice(0, 180);
};

/** Search links for a track title. Empty when there is nothing worth searching. */
export const buildMusicServiceLinks = (track: string | null | undefined): MusicServiceLink[] => {
  const query = cleanTrackQuery(track);
  if (!query) return [];
  const encoded = encodeURIComponent(query);
  return MUSIC_SERVICES.map((service) => ({
    service,
    label: SERVICE_LABELS[service],
    url: SERVICE_URL[service](encoded)
  }));
};
