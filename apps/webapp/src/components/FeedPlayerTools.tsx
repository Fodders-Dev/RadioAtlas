import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDialog } from '../lib/useDialog';
import { SLEEP_TIMER_PRESETS_MIN, formatSleepRemaining } from '../lib/sleepTimer';
import { normalizeStationName, stationLocation } from '../lib/stationUtils';
import { openStationRecording, recordingAvailable } from '../lib/telegram';
import { useLocale } from '../state/LocaleContext';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import type { StationLite } from '../types';
import './FeedPlayerTools.css';

export function FeedPlayerTools({ station, onClose, filters }: { station: StationLite; onClose: () => void; filters?: { chips: Array<{ id: string; label: string }>; active: string; label: string; onSelect: (id: never) => void } }) {
  const root = useRef<HTMLDivElement>(null);
  const { t } = useLocale();
  const { player, queue, sleepTimer, startSleepTimer, cancelSleepTimer, openExternal, shareStation } = usePlayback();
  const { isStationHiddenFromRecommendations, hideStationFromRecommendations, unhideStationFromRecommendations } = useLibrary();
  const { setActiveSection, setLibraryTab } = useShell();
  useDialog(root, { isOpen: true, onClose });
  const hidden = isStationHiddenFromRecommendations(station.stationuuid);
  const openLibrary = (tab: 'queue' | 'tracks') => { onClose(); setLibraryTab(tab); setActiveSection('library'); };

  return createPortal(<div className="feed-player-tools" ref={root} role="dialog" aria-modal="true" aria-label={t('dock.more')}>
    <button className="feed-tools-scrim" data-dialog-backdrop aria-label={t('common.close')} onClick={onClose} />
    <div className="feed-tools-card">
      <header><div><small>{t('calm.player')}</small><h2>{normalizeStationName(station.name)}</h2></div><button className="feed-tools-close" onClick={onClose} aria-label={t('common.close')}>×</button></header>
      <section className="feed-tools-sleep" aria-label={t('settings.sleepTimerLabel')}>
        <div className="feed-tools-heading"><h3>{t('settings.sleepTimerLabel')}</h3><output>{sleepTimer.active ? formatSleepRemaining(sleepTimer.remainingMs) : t('settings.off')}</output></div>
        <div className="feed-tools-presets">{SLEEP_TIMER_PRESETS_MIN.map(minutes => <button key={minutes} aria-pressed={sleepTimer.active && sleepTimer.minutes === minutes} onClick={() => startSleepTimer(minutes)}>{minutes} {t('settings.sleepMin')}</button>)}</div>
        {sleepTimer.active && <button className="feed-tools-row" onClick={cancelSleepTimer}>{t('settings.sleepStop')}</button>}
      </section>
      {filters ? (
        <section className="feed-tools-filters" aria-label={filters.label}>
          <div className="feed-tools-heading"><h3>{filters.label}</h3></div>
          <div className="feed-tools-presets">{filters.chips.map((chip) => <button key={chip.id} aria-pressed={filters.active === chip.id} onClick={() => filters.onSelect(chip.id as never)} data-feed-filter={chip.id}>{chip.label}</button>)}</div>
        </section>
      ) : null}
      <label className="feed-tools-volume"><span>{t('dock.volume')} <output>{Math.round(player.volume * 100)}%</output></span><input aria-label={t('dock.volume')} type="range" min="0" max="1" step="0.01" value={player.volume} onChange={event => player.setVolume(Number(event.target.value))} /></label>
      <div className="feed-tools-links">
        <button onClick={() => queue.enqueue(station)}>{t('feed.addToQueue')} <span>＋</span></button>
        <button onClick={() => openLibrary('queue')}>{t('winamp.queue')} <span>{queue.items.length} ↗</span></button>
        <button onClick={() => openLibrary('tracks')}>{t('calm.finds')} <span>↗</span></button>
        {/* Recording (the bot's /record flow, 5/15/30 min, the file lands in the
            bot chat) lost its entry when the tray replaced the old player. Same
            deep link, same gate; the station is the one this tray was opened
            for, and leaving for the bot never plays or switches anything. */}
        {recordingAvailable() ? (
          <>
            <button onClick={() => openStationRecording(station.stationuuid)} data-feed-record>{t('winamp.record')} <span>↗</span></button>
            <p className="feed-tools-hint">{t('feed.recordHint')}</p>
          </>
        ) : null}
        <button onClick={() => shareStation(station)}>{t('feed.share')} <span>↗</span></button>
        <button onClick={() => openExternal(station)}>{t('calm.openStream')} <span>↗</span></button>
      </div>
      <details className="feed-tools-details"><summary tabIndex={0}>{t('winamp.stationDetails')}</summary><p>{stationLocation(station)}</p>{station.description && <p>{station.description}</p>}<p>{station.tags}</p></details>
      <button className="feed-tools-row" aria-pressed={hidden} onClick={() => hidden ? unhideStationFromRecommendations(station) : hideStationFromRecommendations(station)}>{t(hidden ? 'calm.unhide' : 'calm.hide')}</button>
    </div>
  </div>, document.body);
}
