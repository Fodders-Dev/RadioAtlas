import { describe, expect, it } from 'vitest';
import { buildMusicServiceLinks, cleanTrackQuery, MUSIC_SERVICES } from './musicServiceLinks';

describe('cleanTrackQuery', () => {
  it('strips the station advertising that ICY metadata carries', () => {
    // Real example off the owner's screen: WALM HD appends its own domain, and
    // searching for that finds nothing on any service.
    expect(cleanTrackQuery('I Feel the Love Between Us by Sara Groves - walmradio.com')).toBe(
      'I Feel the Love Between Us by Sara Groves'
    );
    expect(cleanTrackQuery('Кино — Группа крови (radiorecord.ru)')).toBe('Кино — Группа крови');
    expect(cleanTrackQuery('Artist - Title | radio.example')).toBe('Artist - Title');
  });

  it('refuses placeholders instead of searching for them', () => {
    for (const junk of ['', '   ', 'Unknown', 'unknown artist', 'N/A', 'нет данных', 'Реклама']) {
      expect(cleanTrackQuery(junk), junk).toBe('');
    }
  });

  it('refuses a bare one-word label that is not a track', () => {
    expect(cleanTrackQuery('Nashe')).toBe('');
    // …but keeps anything with a real artist/title shape.
    expect(cleanTrackQuery('Nirvana - Lithium')).toBe('Nirvana - Lithium');
    expect(cleanTrackQuery('Sara Groves')).toBe('Sara Groves');
  });

  it('keeps normal titles untouched', () => {
    expect(cleanTrackQuery('  Жасмин  -   Головоломка ')).toBe('Жасмин - Головоломка');
  });
});

describe('buildMusicServiceLinks', () => {
  it('offers every service for a real track', () => {
    const links = buildMusicServiceLinks('Кино - Группа крови');
    expect(links).toHaveLength(MUSIC_SERVICES.length);
    expect(links.map((link) => link.service)).toEqual([...MUSIC_SERVICES]);
  });

  it('url-encodes the query, Cyrillic included', () => {
    const links = buildMusicServiceLinks('Кино - Группа крови');
    for (const link of links) {
      expect(link.url, link.service).toMatch(/^https:\/\//);
      // The raw Cyrillic must never appear unencoded in the URL.
      expect(link.url, link.service).not.toMatch(/[А-Яа-яЁё]/);
      expect(decodeURIComponent(link.url)).toContain('Кино - Группа крови');
    }
  });

  it('points at SEARCH pages, never at a guessed track id', () => {
    // The honesty property: we hand over the query, we do not claim to know
    // which release it is.
    const links = buildMusicServiceLinks('Nirvana - Lithium');
    const byService = Object.fromEntries(links.map((link) => [link.service, link.url]));
    expect(byService.yandex).toContain('music.yandex.ru/search?text=');
    expect(byService.zvuk).toContain('zvuk.com/search?query=');
    expect(byService.vk).toContain('vk.com/audio?q=');
    expect(byService.spotify).toContain('open.spotify.com/search/');
    expect(byService.soundcloud).toContain('soundcloud.com/search?q=');
    expect(byService.youtube).toContain('youtube.com/results?search_query=');
  });

  it('offers nothing when there is nothing worth searching', () => {
    for (const junk of [null, undefined, '', 'Unknown', 'Реклама']) {
      expect(buildMusicServiceLinks(junk)).toEqual([]);
    }
  });
});
