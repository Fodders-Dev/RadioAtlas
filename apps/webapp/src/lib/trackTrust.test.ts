import { describe, expect, it } from 'vitest';
import { normalizeTrustedTrackTitle } from './trackTrust';

const station = (overrides: { name?: string; homepage?: string; url?: string } = {}) => ({
  name: overrides.name ?? 'Радио Ваня',
  url_resolved: overrides.url ?? 'https://stream.radiovanya.ru:8443/live',
  url: overrides.url ?? 'https://stream.radiovanya.ru:8443/live',
  homepage: overrides.homepage ?? 'https://radiovanya.ru/'
});

describe('normalizeTrustedTrackTitle', () => {
  it('returns a clean track string when ICY ships real metadata', () => {
    expect(
      normalizeTrustedTrackTitle('Coldplay - Yellow', station())
    ).toBe('Coldplay - Yellow');
  });

  it('rejects http URL strings', () => {
    expect(
      normalizeTrustedTrackTitle('https://radiovanya.ru/', station())
    ).toBeNull();
  });

  it('rejects bare domain like "radiovanya.ru"', () => {
    expect(normalizeTrustedTrackTitle('radiovanya.ru', station())).toBeNull();
  });

  it('rejects bare domain with path like "radiovanya.ru/listen"', () => {
    expect(
      normalizeTrustedTrackTitle('radiovanya.ru/listen', station())
    ).toBeNull();
  });

  it('rejects www-prefixed bare domain', () => {
    expect(
      normalizeTrustedTrackTitle('www.radiovanya.ru', station())
    ).toBeNull();
  });

  it('rejects when ICY echoes the station homepage as a different URL form', () => {
    // Station homepage stored with protocol + trailing slash; ICY
    // returns just the host. Hostname comparison should still
    // recognise this as "the station's address, not a track".
    expect(
      normalizeTrustedTrackTitle(
        'radiovanya.ru',
        station({ homepage: 'https://radiovanya.ru/' })
      )
    ).toBeNull();
  });

  it('rejects when ICY echoes the stream URL host', () => {
    expect(
      normalizeTrustedTrackTitle(
        'stream.radiovanya.ru',
        station({ url: 'https://stream.radiovanya.ru:8443/live' })
      )
    ).toBeNull();
  });

  it('keeps track strings that contain dots but are not domains', () => {
    expect(
      normalizeTrustedTrackTitle('Mr. Saxobeat - Alexandra Stan', station())
    ).toBe('Mr. Saxobeat - Alexandra Stan');
  });

  it('keeps track strings with hyphens that look domain-ish', () => {
    // "radio-1" alone is not a domain (no TLD); should NOT match.
    expect(normalizeTrustedTrackTitle('radio-1', station())).toBe('radio-1');
  });

  it('rejects filler titles', () => {
    expect(normalizeTrustedTrackTitle('unknown', station())).toBeNull();
    expect(normalizeTrustedTrackTitle('LIVE RADIO', station())).toBeNull();
    expect(normalizeTrustedTrackTitle('Loading...', station())).toBeNull();
  });

  it('rejects values that match the station name verbatim', () => {
    expect(
      normalizeTrustedTrackTitle('Радио Ваня', station({ name: 'Радио Ваня' }))
    ).toBeNull();
  });

  it('rejects German rautemusik placeholder "Kein Titel Update"', () => {
    expect(normalizeTrustedTrackTitle('Kein Titel Update', station())).toBeNull();
    expect(normalizeTrustedTrackTitle('kein titel update', station())).toBeNull();
    expect(normalizeTrustedTrackTitle('  KEIN TITEL UPDATE  ', station())).toBeNull();
  });

  it('rejects multilingual placeholder strings', () => {
    expect(normalizeTrustedTrackTitle('Sin Título', station())).toBeNull();
    expect(normalizeTrustedTrackTitle('Aucun titre', station())).toBeNull();
    expect(normalizeTrustedTrackTitle('Без названия', station())).toBeNull();
    expect(normalizeTrustedTrackTitle('On Air', station())).toBeNull();
    expect(normalizeTrustedTrackTitle('Now Playing', station())).toBeNull();
    expect(normalizeTrustedTrackTitle('Currently Playing', station())).toBeNull();
  });
});

// Every string below was captured on 2026-08-03 by asking our own /metadata for
// each of the 79 stations on the shop window. 56 came back with a title, and
// roughly a third of those were not a track at all — station idents, slogans,
// and in several cases raw fragments our own parsing failed to reject.
//
// The survivors matter as much as the junk: they are the guard against a filter
// that "cleans up" by throwing away real music.
describe('normalizeTrustedTrackTitle — real shop-window titles', () => {
  const at = (name: string) => ({ name, url_resolved: '', url: '', homepage: '' });

  describe('titles that MUST survive', () => {
    const real: Array<[string, string]> = [
      ['1.FM - Bay Smooth Jazz Radio', 'Art Porter - We Should Stay In Love'],
      ['101 SMOOTH JAZZ', 'Norman Brown - That`s The Way Love Goes'],
      ['1LIVE', 'Major Lazer feat. Justin Bieber & MØ - Cold Water'],
      ['88.3JIA Cantopop', '曾比特 Mike Tsang + 毛不易 - 弥敦道 (Cover)'],
      ['Antenne Bayern - Event', 'Van Halen - Jump'],
      ['Abdulbasit Abdulsamad', "Abdulrahman Alsudaes عبدالرحمن السديس - Al-'Ankabut"],
      ['Café del Mar', 'Lamb - Trans Fatty Acid'],
      ['Classic FM', 'Ludovico Einaudi, Ludovico Einaudi - Le Onde'],
      ['RMF Classic', 'Howard Shore - Wladca pierscieni Druzyna pierscienia'],
      ['Your Classical - Relax', '"Mascarade Suite: Arietta" - Johan Halvorsen'],
      // ⚠ The one that nearly cost us a real song: an emoticon heart. Any rule
      // that rejects on a bare "<" would silently delete this track.
      ['LOS 40 Principales España', 'Ana Mena,Lola Índigo - Pa ti toa <3'],
      // A talk station's programme name is the honest answer to "what's on".
      ['Deutschlandfunk | DLF | MP3', 'Andruck, 03.08.'],
      // Station name appears INSIDE the title but the song is real — the ident
      // rules must not fire on a mere substring.
      ['Relax FM Chillout', 'IRA & Sarah Russell - Constant Invasions (Bryan Milton Remix)'],
      // ⚠⚠ A station named after a performer plays that performer. Both of these
      // contain the station's ENTIRE name and are entirely real songs — an
      // earlier draft of the ident rule deleted both. Found only by replaying
      // 6101 observed titles; the hand-picked cases above all missed it.
      ['The Beatles', 'The Beatles - Honey Dont (Remastered 2009)'],
      ['Elissa FM', 'Elissa - 7Ob Kol 7Ayati (Dj Havana Remix)'],
      // Station ident glued in front of a real track: keeping it beats deleting
      // the song underneath.
      ['RockFM', 'RockFM - SABATON - PRIMO VICTORIA'],
      // ⚠⚠ Russian artist-stations with ONE-WORD song titles — the audience's own
      // music, and the case a word-counting version of the ident rule deleted.
      ['Чайф', 'ЧайФ - Мимо'],
      ['Сергей Трофимов', 'Сергей Трофимов - Притча'],
      // Shared word ("al") between the reciter's name and the surah.
      ['Muhammad Siddiq al-Minshawi', 'Muhammad Siddiq Al-Minshawi - Al-Fath']
    ];
    it.each(real)('%s keeps «%s»', (name, title) => {
      expect(normalizeTrustedTrackTitle(title, at(name))).toBe(title.replace(/\s+/g, ' ').trim());
    });
  });

  describe('junk that must be rejected', () => {
    it('rejects raw ICY attribute soup (102.7 KIIS FM)', () => {
      expect(
        normalizeTrustedTrackTitle(
          'Ariana Grande - text="Hate That I Made You Love Me" song_spot=',
          at('102.7 KIIS FM')
        )
      ).toBeNull();
    });

    it('rejects an HTML source fragment (NewDanceRadio)', () => {
      expect(
        normalizeTrustedTrackTitle(
          'whois"> <meta content="text/html" charset="utf-8" http-equiv="',
          at('NewDanceRadio')
        )
      ).toBeNull();
    });

    it("rejects the station config's own template default (Clouds FM)", () => {
      expect(normalizeTrustedTrackTitle('Now Playing info goes here', at('Clouds FM'))).toBeNull();
    });

    it('rejects a URL embedded in a promo line (Dance Wave!)', () => {
      expect(
        normalizeTrustedTrackTitle('Tracklist: https://dancewave.online', at('Dance Wave!'))
      ).toBeNull();
    });

    it('rejects the station ident dressed up with a generic word (BBC World Service)', () => {
      expect(
        normalizeTrustedTrackTitle('BBC World Service Online', at('BBC World Service'))
      ).toBeNull();
    });

    it('rejects an ident the station name merely contains (Radio 105 Network)', () => {
      expect(normalizeTrustedTrackTitle('Radio 105', at('Radio 105 Network'))).toBeNull();
    });

    it("rejects a sub-brand whose halves both come from the station's name (RADIO BOB)", () => {
      expect(
        normalizeTrustedTrackTitle('RADIO BOB - Symphonic Metal', at('Radio Bob! Symphonic Metal'))
      ).toBeNull();
      expect(normalizeTrustedTrackTitle('90s90s - Techno', at('90s90s Techno HQ'))).toBeNull();
      expect(normalizeTrustedTrackTitle('1LIVE - Chillout', at('1LIVE Chillout'))).toBeNull();
    });

    it('rejects an operational note about the broadcast (Sunshine Live)', () => {
      expect(normalizeTrustedTrackTitle('SUNSHINE LIVE - Simulcast', at('Sunshine Live'))).toBeNull();
      expect(normalizeTrustedTrackTitle('Kontrafunk - relay', at('Kontrafunk'))).toBeNull();
    });

    it('rejects an ident left with a dangling separator (Iran International)', () => {
      expect(
        normalizeTrustedTrackTitle('Radio Iran International -', at('Iran International'))
      ).toBeNull();
    });

    it('rejects an ad marker repeated on both sides (REYFM)', () => {
      expect(normalizeTrustedTrackTitle('Ad-Trigger - Ad-Trigger', at('REYFM - #original'))).toBeNull();
    });

    it('rejects an underscore filename (Eritrean Music)', () => {
      expect(normalizeTrustedTrackTitle('TeweldeRedda_fikri_aleni', at('Eritrean Music'))).toBeNull();
      expect(normalizeTrustedTrackTitle('YusufSeid_Nafikeki_remix', at('Eritrean/Ethiopian music'))).toBeNull();
    });
  });

  describe('titles that are repaired rather than dropped', () => {
    it('trims a leading separator left by an empty artist slot (MANGORADIO)', () => {
      expect(
        normalizeTrustedTrackTitle('- Ein bisschen Verbraucherinformationen ...', at('MANGORADIO'))
      ).toBe('Ein bisschen Verbraucherinformationen ...');
    });

    // A whole Italian network ships a database row where the track should be.
    // Discarding it would leave ~25 working stations looking silent, when the
    // song and the performer are right there in the first two fields.
    it('unpacks a tilde record, title first (Virgin Radio)', () => {
      expect(
        normalizeTrustedTrackTitle(
          'Champagne Supernova~Oasis~~1995~~299~2026-07-14T06:53:48~2026-07-14T06:58:47',
          at("Virgin Radio Rock '90")
        )
      ).toBe('Champagne Supernova - Oasis');
    });

    it('unpacks a tilde record, artist first (Radio Montecarlo)', () => {
      expect(
        normalizeTrustedTrackTitle(
          'THOMPSON TWINS~HOLD ME NOW~INTO THE GAP~1983~GBARK8300013~252~2026-06-29T11:55:00',
          at('Radio Montecarlo')
        )
      ).toBe('THOMPSON TWINS - HOLD ME NOW');
    });

    it('keeps the album out of it when the record has three names (Café del Mar)', () => {
      expect(
        normalizeTrustedTrackTitle('Digby Jones~Horizon~Horizon _~2024', at('Cafè Del Mar Collection'))
      ).toBe('Digby Jones - Horizon');
    });

    it('still rejects a record whose only field is the station ident (RMC Italia)', () => {
      expect(
        normalizeTrustedTrackTitle(
          'Radio Monte Carlo Italia~~~~~12~2026-06-30T09:07:23~2026-06-30T09:07:35',
          at('RMC Italia')
        )
      ).toBeNull();
    });
  });
});
