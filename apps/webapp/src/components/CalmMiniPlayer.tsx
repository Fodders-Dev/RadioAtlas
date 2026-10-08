import { useRef } from 'react';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import { useLocale } from '../state/LocaleContext';
import { resolveNowPlayingTrust } from '../lib/trackTrust';
import { normalizeStationName } from '../lib/stationUtils';
import { StationArtwork } from './StationArtwork';
import { ThemeActionIcon } from './ThemeActionIcon';
import { useDockSwipe } from '../lib/useDockSwipe';
import { triggerHaptic } from '../lib/telegram';
import type { StationLite } from '../types';

export function CalmMiniPlayer({ onOpenFeedPlayer }: { onOpenFeedPlayer: (station: StationLite) => void }) {
  const { player, nowPlaying, nowPlayingStatus, copyTrack, playStation, playNext, playPrevious } = usePlayback();
  const { trackHistory, isFavorite, toggleFavorite } = useLibrary();
  const { winamp, activeSection } = useShell();
  const { t } = useLocale();
  const station = player.current ?? player.pending;
  const barRef = useRef<HTMLElement>(null);
  const visible = Boolean(station) && !winamp.expanded && activeSection !== 'feed';
  useDockSwipe(barRef, direction => {
    triggerHaptic('light');
    if (direction === 'next') playNext();
    else playPrevious();
  }, visible);
  const trust = resolveNowPlayingTrust({ station, track: nowPlaying, metadataStatus: nowPlayingStatus, playerStatus: player.status, failure: player.failure });
  if (!station || !visible) return null;
  const track = trust.track;
  const saved = Boolean(track && trackHistory.some(f => f.stationId === station.stationuuid && f.track === track));
  const status = player.status === 'error' ? t('calm.error') : player.status === 'buffering' ? t('dock.buffering') : player.isPlaying ? normalizeStationName(station.name) : t('calm.paused');
  return <section ref={barRef} className="calm-mini" data-calm-player data-status={player.status} aria-label={t('calm.player')}>
    <button className="calm-mini-info" onClick={() => onOpenFeedPlayer(station)} aria-label={t('calm.openFeedPlayer')}>
      <StationArtwork station={station} size="dock"/>
      <span><strong>{track || normalizeStationName(station.name)}</strong><small><i data-live={player.isPlaying} aria-hidden="true"/>{status}</small></span>
    </button>
    {track && <button className="calm-icon calm-capture" data-dock-swipe-ignore aria-label={t(saved ? 'calm.saved' : 'calm.save')} aria-pressed={saved} onClick={() => { void copyTrack(); }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4V3Z"/></svg>
    </button>}
    <button className="calm-icon calm-mini-favorite" data-dock-swipe-ignore aria-label={t(isFavorite(station.stationuuid) ? 'journal.sourceUnfavorite' : 'journal.sourceFavorite')} aria-pressed={isFavorite(station.stationuuid)} onClick={() => { triggerHaptic(); toggleFavorite(station); }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/></svg>
    </button>
    <button className="calm-icon calm-mini-play" data-dock-swipe-ignore aria-label={t(player.status === 'error' ? 'dock.retry' : player.isPlaying ? 'common.pause' : 'common.play')} onClick={() => { if (player.status === 'error') playStation(station); else void player.toggle(); }}>
      <ThemeActionIcon name={player.isPlaying ? 'pause' : 'play'}><path d={player.isPlaying ? 'M7 5h4v14H7zm6 0h4v14h-4z' : 'M8 5v14l11-7z'}/></ThemeActionIcon>
    </button>
    <button className="calm-icon calm-mini-next" data-dock-swipe-ignore aria-label={t('common.next')} onClick={() => { triggerHaptic('light'); playNext(); }}>
      <ThemeActionIcon name="next"><path d="m5 5 10 7-10 7V5Zm12 0h2v14h-2V5Z"/></ThemeActionIcon>
    </button>
  </section>;
}
