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
