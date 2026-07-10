import { describe, expect, it } from 'vitest';
import { prewarmOriginFromCandidateUrl } from './streamPrewarm';

const PAGE = 'https://radioatlas.ru';

describe('prewarmOriginFromCandidateUrl', () => {
  it('returns null for a same-origin proxy candidate (already warm)', () => {
    expect(
      prewarmOriginFromCandidateUrl('https://radioatlas.ru/api/stream?url=http%3A%2F%2Ffoo.mp3', PAGE)
    ).toBeNull();
  });

  it('returns the foreign origin for a direct stream (preconnect helps)', () => {
    expect(prewarmOriginFromCandidateUrl('https://miku.fm/listen/miku/mp3-320', PAGE)).toBe('https://miku.fm');
    expect(
      prewarmOriginFromCandidateUrl('https://spritelayerradio.com/listen/namkocom_radio/namkocom.mp3', PAGE)
    ).toBe('https://spritelayerradio.com');
  });

  it('returns null for empty, relative, or malformed input', () => {
    expect(prewarmOriginFromCandidateUrl('', PAGE)).toBeNull();
    expect(prewarmOriginFromCandidateUrl(null, PAGE)).toBeNull();
    expect(prewarmOriginFromCandidateUrl(undefined, PAGE)).toBeNull();
    // Relative → resolves to the page origin → null (nothing foreign to warm).
    expect(prewarmOriginFromCandidateUrl('/api/stream?url=x', PAGE)).toBeNull();
    expect(prewarmOriginFromCandidateUrl('http://[', PAGE)).toBeNull();
  });
});
