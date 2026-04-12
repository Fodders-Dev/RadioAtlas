import { useEffect, useMemo, useState } from 'react';
import { createLibraryDiscoveryFeed } from '../lib/discoveryFeed';
import { StationTable } from '../components/StationTable';
import { stationLocation } from '../lib/stationUtils';
import { useLocale } from '../state/LocaleContext';
import { useRadio } from '../state/RadioContext';
import { useSession } from '../state/SessionContext';
import type { LibraryTab } from '../types';

const TAB_ORDER: LibraryTab[] = ['favorites', 'queue', 'recent', 'history'];

export const Library = () => {
  const {
    favorites,
    recent,
    trackHistory,
    playbackHistory,
    queue,
    player,
    clearFavorites,
    clearRecent,
    clearTrackHistory,
    libraryTab,
    setLibraryTab
  } = useRadio();
  const { status: sessionStatus, syncState, profile, library } = useSession();
  const { locale, t } = useLocale();
  const [trackJournalExpanded, setTrackJournalExpanded] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1024
  );

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const compactRows = viewportWidth < 720;
  const libraryDiscovery = useMemo(
    () =>
      createLibraryDiscoveryFeed({
        current: player.current,
        queuePreview: queue.items.slice(
          Math.max(queue.currentIndex, 0),
          Math.max(queue.currentIndex, 0) + 4
        ),
        recent,
        favorites,
        playbackHistory,
        trackHistory,
        linkedProviders: profile?.linkedProviders || [],
        libraryUpdatedAt: library?.updatedAt || null
      }),
    [favorites, library?.updatedAt, playbackHistory, player.current, profile?.linkedProviders, queue.currentIndex, queue.items, recent, trackHistory]
  );

  const formatTime = (value: number) =>
    new Date(value).toLocaleString(locale, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

  return (
    <section className="screen screen-library-v2">
      <div className="glass-card library-header-card">
        <div className="library-header-copy">
          <div className="shell-kicker">{t('library.kicker')}</div>
          <div className="section-title">{t('library.title')}</div>
          <div className="section-subtitle">{t('library.subtitle')}</div>
          <div className="library-header-stats">
            <div className="globe-selection-pill">
              <span>{t('library.tabs.favorites')}</span>
              <strong>{favorites.length}</strong>
            </div>
            <div className="globe-selection-pill">
              <span>{t('playlist.title')}</span>
              <strong>{queue.items.length}</strong>
            </div>
            <div className="globe-selection-pill">
              <span>{t('library.tabs.history')}</span>
              <strong>{trackHistory.length}</strong>
            </div>
            <div className={`globe-selection-pill ${sessionStatus === 'authenticated' ? 'active' : ''}`}>
              <span>{t('account.syncStatus')}</span>
              <strong>
                {sessionStatus === 'authenticated'
                  ? t(`account.syncStates.${syncState}`)
                  : t('account.local')}
              </strong>
            </div>
          </div>
        </div>
        <div className="chip-row">
          {TAB_ORDER.map((tab) => (
            <button
              key={tab}
              className={`chip ${libraryTab === tab ? 'active' : ''}`}
              type="button"
              onClick={() => setLibraryTab(tab)}
            >
              {t(`library.tabs.${tab}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="library-overview-grid">
        <div className="glass-card library-overview-card">
          <div className="library-section-head">
            <div>
              <div className="section-title">{t('library.returnToAirTitle')}</div>
              <div className="section-subtitle">{t('library.returnToAirCopy')}</div>
            </div>
            <button className="chip" type="button" onClick={() => setLibraryTab('recent')}>
              {t('library.tabs.recent')}
            </button>
          </div>
          {libraryDiscovery.returnToAir.length ? (
            <StationTable stations={libraryDiscovery.returnToAir} compact sourceId="library-return-to-air" />
          ) : (
            <div className="empty-state library-empty-state">
              <div className="library-empty-title">{t('library.returnToAirEmptyTitle')}</div>
              <div className="section-subtitle">{t('library.returnToAirEmptyCopy')}</div>
            </div>
          )}
        </div>

        <div className="glass-card library-overview-card">
          <div className="library-section-head">
            <div>
              <div className="section-title">{t('library.cloudTitle')}</div>
              <div className="section-subtitle">
                {sessionStatus === 'authenticated'
                  ? t('library.cloudReadyCopy', { status: t(`account.syncStates.${syncState}`) })
                  : t('library.cloudLocalCopy')}
              </div>
            </div>
            <button className="chip" type="button" onClick={() => setLibraryTab('history')}>
              {t('library.tabs.history')}
            </button>
          </div>
          <div className="library-overview-pills">
            <div className={`globe-selection-pill ${libraryDiscovery.cloudSummary.mode === 'cloud' ? 'active' : ''}`}>
              <span>{t('account.syncStatus')}</span>
              <strong>
                {sessionStatus === 'authenticated'
                  ? t(`account.syncStates.${syncState}`)
                  : t('account.local')}
              </strong>
            </div>
            <div className="globe-selection-pill">
              <span>{t('library.cloudProviders')}</span>
              <strong>
                {libraryDiscovery.cloudSummary.providerKinds.length
                  ? libraryDiscovery.cloudSummary.providerKinds.map((kind) => t(`account.providers.${kind}`)).join(' · ')
                  : t('account.local')}
              </strong>
            </div>
            <div className="globe-selection-pill">
              <span>{t('library.cloudLastSync')}</span>
              <strong>
                {libraryDiscovery.cloudSummary.updatedAt
                  ? formatTime(libraryDiscovery.cloudSummary.updatedAt)
                  : t('common.unavailable')}
              </strong>
            </div>
          </div>
          {libraryDiscovery.journalPreview.length ? (
            <div className="library-mini-track-list">
              {libraryDiscovery.journalPreview.map((item) => (
                <button
                  key={item.id}
                  className="library-mini-track"
                  type="button"
                  onClick={() => navigator.clipboard.writeText(item.track)}
                >
                  <strong title={item.track}>{item.track}</strong>
                  <span title={item.stationName}>{item.stationName}</span>
                </button>
              ))}
            </div>
          ) : libraryDiscovery.favoritesPreview.length ? (
            <StationTable stations={libraryDiscovery.favoritesPreview} compact sourceId="library-favorites-preview" />
          ) : (
            <div className="empty-state library-empty-state">
              <div className="library-empty-title">{t('library.cloudEmptyTitle')}</div>
              <div className="section-subtitle">{t('library.cloudEmptyCopy')}</div>
            </div>
          )}
        </div>
      </div>

      {libraryTab === 'favorites' ? (
        <div className="glass-card">
          <div className="library-section-head">
            <div>
              <div className="section-title">{t('favoritesScreen.myStations')}</div>
              <div className="section-subtitle">{t('explore.favoritesSubtitle')}</div>
            </div>
            <button className="chip" type="button" onClick={clearFavorites} disabled={!favorites.length}>
              {t('settings.clearFavorites')}
            </button>
          </div>
          {favorites.length ? (
            <StationTable stations={favorites} compact={compactRows} sourceId="favorites" />
          ) : (
            <div className="empty-state library-empty-state">
              <div className="library-empty-title">{t('library.emptyFavoritesTitle')}</div>
              <div className="section-subtitle">{t('library.emptyFavoritesCopy')}</div>
            </div>
          )}
        </div>
      ) : null}

      {libraryTab === 'queue' ? (
        <div className="glass-card">
          <div className="library-section-head">
            <div>
              <div className="section-title">{t('playlist.title')}</div>
              <div className="section-subtitle">
                {queue.sourceLabel || t('radio.queueDefault')}
              </div>
            </div>
            <button className="chip" type="button" onClick={() => queue.clearQueue()} disabled={!queue.items.length}>
              {t('playlist.clearQueue')}
            </button>
          </div>
          {queue.items.length ? (
            <div className="playlist-list">
              {queue.items.map((station, index) => {
                const active =
                  index === queue.currentIndex &&
                  player.current?.stationuuid === station.stationuuid;
                return (
                  <div key={station.stationuuid} className={`playlist-row ${active ? 'active' : ''}`}>
                    <div className="playlist-order">{index + 1}</div>
                    <div className="playlist-body">
                      <div className="playlist-name">{station.name}</div>
                      <div className="playlist-meta">{stationLocation(station)}</div>
                    </div>
                    <div className="playlist-actions">
                      <button className="chip" type="button" onClick={() => queue.playAtIndex(index)}>
                        {active && player.isPlaying ? t('playlist.playing') : t('common.play')}
                      </button>
                      <button className="chip" type="button" onClick={() => queue.removeAtIndex(index)}>
                        {t('common.remove')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-state library-empty-state">
              <div className="library-empty-title">{t('library.emptyQueueTitle')}</div>
              <div className="section-subtitle">{t('playlist.empty')}</div>
            </div>
          )}
        </div>
      ) : null}

      {libraryTab === 'recent' ? (
        <div className="glass-card">
          <div className="library-section-head">
            <div>
              <div className="section-title">{t('favoritesScreen.recentStations')}</div>
              <div className="section-subtitle">{t('explore.recentSubtitle')}</div>
            </div>
            <button className="chip" type="button" onClick={clearRecent} disabled={!recent.length}>
              {t('settings.clearRecent')}
            </button>
          </div>
          <StationTable stations={recent} compact={compactRows} sourceId="recent" />
        </div>
      ) : null}

      {libraryTab === 'history' ? (
        <div className="library-history-grid">
          <div className="glass-card">
            <div className="library-section-head">
              <div>
                <div className="section-title">{t('favoritesScreen.journalTitle')}</div>
                <div className="section-subtitle">
                  {trackJournalExpanded
                    ? t('library.trackJournal')
                    : t('library.trackJournalCollapsed')}
                </div>
              </div>
              <div className="chip-row">
                {trackHistory.length ? (
                  <button className="chip" type="button" onClick={clearTrackHistory}>
                    {t('common.clear')}
                  </button>
                ) : null}
                <button
                  className={`chip ${trackJournalExpanded ? 'active' : ''}`}
                  type="button"
                  onClick={() => setTrackJournalExpanded((prev) => !prev)}
                >
                  {trackJournalExpanded
                    ? t('library.trackJournalCollapse')
                    : t('library.trackJournalExpand')}
                </button>
              </div>
            </div>
            <div className="library-journal-summary">
              <div className="globe-selection-pill">
                <span>{t('favoritesScreen.journalTitle')}</span>
                <strong>{t('library.trackJournalCount', { count: trackHistory.length })}</strong>
              </div>
              {trackHistory[0] ? (
                <div className="globe-selection-pill">
                  <span>{t('common.song')}</span>
                  <strong title={trackHistory[0].track}>{trackHistory[0].track}</strong>
                </div>
              ) : null}
            </div>
            {trackJournalExpanded ? (
              trackHistory.length ? (
                <div className="track-list track-list-scroll">
                  {trackHistory.map((item) => (
                    <div key={item.id} className="track-card">
                      <div className="track-card-copy">
                        <div className="track-title">{item.track}</div>
                        <div className="track-meta">
                          {item.stationName} · {formatTime(item.timestamp)}
                        </div>
                      </div>
                      <button
                        className="chip"
                        type="button"
                        onClick={() => navigator.clipboard.writeText(item.track)}
                      >
                        {t('common.copy')}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">{t('favoritesScreen.journalEmpty')}</div>
              )
            ) : null}
          </div>

          <div className="glass-card">
            <div className="section-title">{t('playlist.historyTitle')}</div>
            <div className="section-subtitle">{t('library.stationHistory')}</div>
            {playbackHistory.length ? (
              <div className="playlist-history-list">
                {playbackHistory
                  .slice()
                  .reverse()
                  .slice(0, 16)
                  .map((station) => (
                    <div key={`${station.stationuuid}-${station.name}`} className="playlist-history-item">
                      <div className="playlist-history-name">{station.name}</div>
                      <div className="playlist-history-meta">{stationLocation(station)}</div>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="empty-state">{t('playlist.historyEmpty')}</div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
};
