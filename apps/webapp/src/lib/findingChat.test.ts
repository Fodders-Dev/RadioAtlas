import { describe, expect, it } from 'vitest';
import { frameSavedFindingQuestion, savedFindingChatContext } from './findingChat';

describe('saved finding chat context', () => {
  const find = (track: string) => ({
    id: 'find-1',
    stationId: 'station-1',
    stationName: 'Example FM',
    track,
    timestamp: 1
  });

  it('keeps a trusted saved title without consulting the catalogue', () => {
    expect(savedFindingChatContext(find('Numb')).trustedTrack).toBe('Numb');
  });

  it('requires clarification for placeholder or station-ident metadata', () => {
    expect(savedFindingChatContext(find('LIVE RADIO')).trustedTrack).toBeNull();
    expect(savedFindingChatContext(find('Example FM')).trustedTrack).toBeNull();
  });

  it('uses the exact visible localized frame with an actual line break', () => {
    expect(frameSavedFindingQuestion('Numb', 'Расскажи об этой песне', 'ru'))
      .toBe('О сохранённой песне «Numb»:\nРасскажи об этой песне');
    expect(frameSavedFindingQuestion('Numb', 'Tell me about this song', 'en'))
      .toBe('About saved song “Numb”:\nTell me about this song');
  });

  it('uses an explicit unknown subject marker when saved metadata is rejected', () => {
    expect(frameSavedFindingQuestion('Unknown', 'Как называется песня?', 'ru'))
      .toBe('О сохранённой песне «Unknown»:\nКак называется песня?');
  });
});
