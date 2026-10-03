import { normalizeTrustedTrackTitle } from './trackTrust';
import type { SavedFindingChatContext, TrackHistoryItem } from '../state/radio/types';

export const savedFindingChatContext = (find: TrackHistoryItem): SavedFindingChatContext => ({
  track: find.track,
  stationName: find.stationName,
  timestamp: find.timestamp,
  trustedTrack: normalizeTrustedTrackTitle(find.track, {
    name: find.stationName,
    url_resolved: '',
    homepage: ''
  })
});

export const frameSavedFindingQuestion = (
  track: string,
  question: string,
  locale: 'ru' | 'en'
) => {
  const safeTrack = track.replace(/[\0\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
  return locale === 'ru'
    ? `О сохранённой песне «${safeTrack}»:\n${question}`
    : `About saved song “${safeTrack}”:\n${question}`;
};
