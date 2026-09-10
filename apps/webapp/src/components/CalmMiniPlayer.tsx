import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import { useLocale } from '../state/LocaleContext';
import { resolveNowPlayingTrust } from '../lib/trackTrust';
import { normalizeStationName } from '../lib/stationUtils';
import { StationArtwork } from './StationArtwork';
import { ThemeActionIcon } from './ThemeActionIcon';

export function CalmMiniPlayer() {
  const { player, nowPlaying, nowPlayingStatus, copyTrack, playStation } = usePlayback();
  const { trackHistory } = useLibrary();
  const { winamp } = useShell();
  const { t } = useLocale();
  const station = player.current ?? player.pending;
  const trust = resolveNowPlayingTrust({ station, track: nowPlaying, metadataStatus: nowPlayingStatus, playerStatus: player.status, failure: player.failure });
  if (!station || winamp.expanded) return null;
  const track = trust.track;
  const saved = Boolean(track && trackHistory.some(f => f.stationId === station.stationuuid && f.track === track));
  const status = player.status === 'error' ? t('calm.error') : player.status === 'buffering' ? t('dock.buffering') : player.isPlaying ? normalizeStationName(station.name) : t('calm.paused');
  return <section className="calm-mini" data-calm-player data-status={player.status} aria-label={t('calm.player')}>
    <button className="calm-mini-info" onClick={() => winamp.setExpanded(true)} aria-label={t('dock.openWinamp')}>
      <StationArtwork station={station} size="dock"/>
      <span><strong>{track || normalizeStationName(station.name)}</strong><small><i data-live={player.isPlaying} aria-hidden="true"/>{status}</small></span>
    </button>
    {track && <button className="calm-icon calm-capture" aria-label={t(saved ? 'calm.saved' : 'calm.save')} aria-pressed={saved} onClick={() => { void copyTrack(); }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4V3Z"/></svg>
    </button>}
    <button className="calm-icon calm-mini-play" aria-label={t(player.status === 'error' ? 'dock.retry' : player.isPlaying ? 'common.pause' : 'common.play')} onClick={() => { if (player.status === 'error') playStation(station); else void player.toggle(); }}>
      <ThemeActionIcon name={player.isPlaying ? 'pause' : 'play'}><path d={player.isPlaying ? 'M7 5h4v14H7zm6 0h4v14h-4z' : 'M8 5v14l11-7z'}/></ThemeActionIcon>
    </button>
  </section>;
}
