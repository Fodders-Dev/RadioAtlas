import { afterEach, describe, expect, it, vi } from 'vitest';
import { frameMusicImageQuestion, getMusicImageCapability, MusicImageError, parseMusicImageCandidates, parseMusicImageCapability, recognizeMusicImage } from './musicImage';

vi.mock('./apiBase', () => ({ getApiBase: () => '/api' }));

describe('music image client', () => {
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it('frames a bounded, single-line song subject in both locales', () => {
    expect(frameMusicImageQuestion({ artist: 'Мо\nно', title: 'Песня' }, 'Расскажи', 'ru'))
      .toBe('О песне с картинки «Мо но — Песня»:\nРасскажи');
    expect(frameMusicImageQuestion('A'.repeat(300), 'Similar?', 'en'))
      .toBe(`About song from image “${'A'.repeat(180)}”:\nSimilar?`);
  });

  it('only accepts a strict, bounded candidate allowlist', () => {
    expect(parseMusicImageCandidates({ candidates: [
      { artist: ' A\nB ', title: ' Song ', uncertain: true, command: 'play' },
      { artist: 'No flag', title: 'Ignored', uncertain: 'false' },
      { artist: '', title: 'Track 0', uncertain: true },
      ...Array.from({ length: 6 }, (_, index) => ({ artist: 'Artist', title: `Track ${index + 1}`, uncertain: false }))
    ] })).toEqual([
      { artist: 'A B', title: 'Song', uncertain: true },
      { artist: '', title: 'Track 0', uncertain: true },
      { artist: 'Artist', title: 'Track 1', uncertain: false },
      { artist: 'Artist', title: 'Track 2', uncertain: false },
      { artist: 'Artist', title: 'Track 3', uncertain: false }
    ]);
    expect(() => parseMusicImageCandidates({ nope: [] })).toThrow(MusicImageError);
  });

  it('GETs capability without a provider call and reads the existing session token', async () => {
    localStorage.setItem('radio:session:v1', 'session-token');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ enabled: true, provider: 'gpt-6-luna' }), { status: 200 }));
    expect(await getMusicImageCapability()).toEqual({ enabled: true, provider: 'gpt-6-luna' });
    expect(fetchMock).toHaveBeenCalledWith('/api/ai/music-image', expect.objectContaining({ headers: { Authorization: 'Bearer session-token' } }));
  });

  it('fails closed for disabled, missing, or unknown provider capability data', () => {
    expect(parseMusicImageCapability({ enabled: false })).toBeNull();
    expect(parseMusicImageCapability({ enabled: true })).toBeNull();
    expect(parseMusicImageCapability({ enabled: true, provider: 'other' })).toBeNull();
    expect(parseMusicImageCapability({ enabled: true, provider: 'deepseek', endpoint: 'https://secret.invalid' }))
      .toEqual({ enabled: true, provider: 'deepseek' });
  });

  it('POSTs raw image bytes with the real MIME type and rejects unsupported/oversized files locally', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ candidates: [] }), { status: 200 }));
    await recognizeMusicImage(new File(['image bytes'], 'private-name.png', { type: 'image/png' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/ai/music-image', expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'image/png' }, body: expect.any(File) }));
    await expect(recognizeMusicImage(new File(['x'], 'x.gif', { type: 'image/gif' }))).rejects.toMatchObject({ code: 'file' });
    const large = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'x.png', { type: 'image/png' });
    await expect(recognizeMusicImage(large)).rejects.toMatchObject({ code: 'tooLarge' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
