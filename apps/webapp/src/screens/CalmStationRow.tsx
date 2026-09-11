import type { StationLite } from '../types';
import { usePlayback } from '../state/RadioContext';
import { useLocale } from '../state/LocaleContext';
import { formatCountryLabel, normalizeStationName, stationTags } from '../lib/stationUtils';
import { StationArtwork } from '../components/StationArtwork';

// One source in a list: the name opens the source, ▶ plays it. Two targets, two
// meanings — the A4 row.
export function CalmStationRow({ station, onPlay, onOpen }: { station: StationLite; onPlay: () => void; onOpen: () => void }) {
  const { t } = useLocale();
  const { player } = usePlayback();
  const name = normalizeStationName(station.name);
  const current = (player.current ?? player.pending)?.stationuuid === station.stationuuid;
  const playing = current && player.isPlaying;
  const tags = stationTags(station, '');
  return <div className="calm-station-row" data-station-row={station.stationuuid} data-current={current || undefined}>
    <button className="calm-source-open" onClick={onOpen} aria-label={t('journal.sourceOpen', { name })}>
      <StationArtwork station={station} size="sm" className="calm-row-art" />
      <span><strong>{name}</strong><small>{[formatCountryLabel(station.country), tags].filter(Boolean).join(' · ')}</small></span>
    </button>
    <button className="calm-icon calm-row-play" onClick={() => { if (current && player.status !== 'error') void player.toggle(); else onPlay(); }} aria-label={playing ? t('common.pause') : t('journal.playStation', { name })}>
      <svg viewBox="0 0 24 24" aria-hidden="true">{playing ? <path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z" /> : <path d="M8 5v14l11-7L8 5Z" />}</svg>
    </button>
  </div>;
}
