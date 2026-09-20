import { useEffect, useRef } from 'react';
import type { StationLite } from '../types';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import { useLocale } from '../state/LocaleContext';
import { isAiAssistantEnabled } from '../lib/aiChat';
import { stationGenreSlug } from '../lib/stationGenre';
import { formatCountryLabel, normalizeStationName, stationLocation, stationTags } from '../lib/stationUtils';
import { StationArtwork } from '../components/StationArtwork';

// A source, not a player: what the catalogue knows about a station and the four
// things a listener does with one — play it, keep it, put it on the map, ask
// Лира about it. Opening this never changes the air.
export function CalmSourceSheet({ station, onClose, onPlay }: { station: StationLite; onClose: () => void; onPlay: (station: StationLite) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { t } = useLocale();
  const { player, queue } = usePlayback();
  const { isFavorite, toggleFavorite } = useLibrary();
  const { setGlobeFocusStationId, setActiveSection, requestChat } = useShell();
  useEffect(() => { dialog.current?.showModal(); }, []);
  const current = (player.current ?? player.pending)?.stationuuid === station.stationuuid;
  const playing = current && player.isPlaying;
  const queueEditBlocked = Boolean(player.pending && player.status === 'buffering');
  const genre = stationGenreSlug(station);
  const tags = stationTags(station, '');
  const queued = queue.items.some((item) => item.stationuuid === station.stationuuid);
  const site = station.homepage && /^https?:/.test(station.homepage) ? station.homepage : null;
  const close = () => dialog.current?.close();
  const name = normalizeStationName(station.name);

  return <dialog ref={dialog} className="calm-sheet calm-source-sheet" aria-labelledby="calm-source-title" onClose={onClose} data-calm-source={station.stationuuid}>
    <div className="calm-sheet-handle" aria-hidden="true" />
    <div className="calm-sheet-head"><span className="calm-eyebrow">{t('journal.sourceKicker')} · {formatCountryLabel(station.country)}</span><button className="calm-icon" onClick={close} aria-label={t('common.close')}>×</button></div>
    <div className="calm-source-profile">
      <StationArtwork station={station} size="card" className="calm-source-art" />
      <h2 id="calm-source-title">{name}</h2>
      <p>{[stationLocation(station), genre ? t(`genre.${genre}`) : '', station.language?.split(',')[0]?.trim()].filter(Boolean).join(' · ')}</p>
      <p className="calm-source-tags">{tags || t('journal.sourceGenres')}</p>
    </div>
    <button className="calm-primary calm-primary-wide" data-source-play onClick={() => { if (current && player.status !== 'error') { void player.toggle(); return; } onPlay(station); }}>
      <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span> {playing ? t('journal.sourcePause') : t('journal.sourcePlay')}
    </button>
    {queueEditBlocked ? <p id="calm-source-queue-edit-pending" className="calm-footnote" role="status">{t('queue.editPending')}</p> : null}
    <div className="calm-sheet-rows">
      <button className="calm-sheet-row" aria-pressed={isFavorite(station.stationuuid)} onClick={() => toggleFavorite(station)} data-source-favorite>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.4 4.9 13.3a4.2 4.2 0 0 1 6-6l1.1 1.1 1.1-1.1a4.2 4.2 0 0 1 6 6L12 20.4Z" /></svg>
        <span>{t(isFavorite(station.stationuuid) ? 'journal.sourceUnfavorite' : 'journal.sourceFavorite')}</span>
      </button>
      <button className="calm-sheet-row" data-source-map onClick={() => { close(); setGlobeFocusStationId(station.stationuuid); setActiveSection('globe'); }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 2c-2.2 0-4 3.1-4 7s1.8 7 4 7 4-3.1 4-7-1.8-7-4-7ZM3 12h18" /></svg>
        <span>{t('journal.sourceOnMap')}</span><i aria-hidden="true">→</i>
      </button>
      <button
        className="calm-sheet-row"
        onClick={() => { queue.enqueue(station); }}
        disabled={queueEditBlocked}
        title={queueEditBlocked ? t('queue.editPending') : undefined}
        aria-describedby={queueEditBlocked ? 'calm-source-queue-edit-pending' : undefined}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18M3 11h12M3 17h9M18 14l4 3-4 3z" /></svg>
        <span>{t(queued ? 'journal.sourceQueued' : 'journal.sourceQueue')}</span>
      </button>
      {isAiAssistantEnabled() && <button className="calm-sheet-row" onClick={() => { close(); requestChat(t('chat.promptThisStationQuery', { station: `${name} (${stationLocation(station) || formatCountryLabel(station.country)})` })); }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 14 9l6.5 2-6.5 2-2 6.5-2-6.5L5.5 11 12 9l2-6.5Z" /></svg>
        <span>{t('journal.sourceLira')}</span><i aria-hidden="true">→</i>
      </button>}
      {site && <a className="calm-sheet-row" href={site} target="_blank" rel="noopener noreferrer">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 0l4-4a5 5 0 0 0-7-7l-3 3M14 11a5 5 0 0 0-7 0l-4 4a5 5 0 0 0 7 7l3-3" /></svg>
        <span>{t('journal.sourceSite')}</span><i aria-hidden="true">↗</i>
      </a>}
    </div>
    <p className="calm-footnote">{t('journal.catalogNote')}</p>
  </dialog>;
}
