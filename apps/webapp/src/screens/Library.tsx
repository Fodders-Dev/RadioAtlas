import { useEffect, useMemo, useState } from 'react';
import { StationTable } from '../components/StationTable';
import { createLibraryDiscoveryFeed } from '../lib/discoveryFeed';
import { stationLocation } from '../lib/stationUtils';
import { useLocale } from '../state/LocaleContext';
import { useRadio } from '../state/RadioContext';
import { useSession } from '../state/SessionContext';
import type { LibraryTab, StationLite } from '../types';

const TAB_ORDER: LibraryTab[] = ['favorites', 'tracks', 'queue', 'recent', 'history', 'collections'];

export const Library = () => {
  const {
    stations,
    favorites,
    recent,
    collections,
    followedStations,
    followedRegions,
    alerts,
    trackHistory,
    playbackHistory,
    queue,
    player,
    nowPlaying,
    clearFavorites,
    clearRecent,
    clearTrackHistory,
    createCollection,
    addStationToCollection,
    removeStationFromCollection,
    markAlertRead,
    playStation,
    playLast,
    playNext,
    setActiveSection,
    libraryTab,
    setLibraryTab
  } = useRadio();
  const {
    status: sessionStatus,
    profile,
    library: cloudLibrary,
    openAccountSheet
  } = useSession();
  const { locale, t } = useLocale();
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1024
  );

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const compactRows = viewportWidth < 720;
  const stationMap = useMemo(() => new Map(stations.map((station) => [station.stationuuid, station])), [stations]);
  const libraryFeed = useMemo(
    () =>
      createLibraryDiscoveryFeed({
        current: player.current,
        queuePreview: queue.items.slice(Math.max(queue.currentIndex, 0), Math.max(queue.currentIndex, 0) + 4),
        recent,
        favorites,
        playbackHistory,
        trackHistory,
        collections,
        followedStations,
        followedRegions,
        alerts,
        linkedProviders: profile?.linkedProviders || [],
        libraryUpdatedAt: cloudLibrary?.updatedAt || null
      }),
    [
      alerts,
      cloudLibrary?.updatedAt,
      collections,
      favorites,
      followedRegions,
      followedStations,
      playbackHistory,
      player.current,
      profile?.linkedProviders,
      queue.currentIndex,
      queue.items,
      recent,
      trackHistory
    ]
  );

  const formatTime = (value: number) =>
    new Date(value).toLocaleString(locale, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

  const unreadAlerts = alerts.filter((alert) => alert.readAt === null);
  const tabCounts: Record<LibraryTab, number> = {
    favorites: favorites.length,
    tracks: trackHistory.length,
    queue: queue.items.length,
    recent: recent.length,
    history: playbackHistory.length,
    collections: collections.length
  };
  const returnToAirStations = libraryFeed.returnToAir;

  const promptCreateCollection = () => {
    const name = window.prompt(t('library.createCollectionPrompt'), '');
    if (!name) return;
    createCollection(name);
  };
  const openLibraryTab = (tab: LibraryTab) => setLibraryTab(tab);
  const queueLeadStation =
    player.current ??
    (queue.currentIndex >= 0 ? queue.items[queue.currentIndex] : null) ??
    queue.items[0] ??
    null;
  const queueSourceLabel = queue.sourceLabel || t('radio.queueDefault');
  const queueSlotValue = queue.items.length
    ? `${Math.min(Math.max(queue.currentIndex, 0) + 1, queue.items.length)}/${queue.items.length}`
    : '0/0';
  const recentSessionPreview = playbackHistory.slice().reverse().slice(0, 4);
  const trackJournalPreview = trackHistory.slice(0, 4);
  const playHistoryStation = (station: StationLite) => {
    playStation(station, {
      playlist: recentSessionPreview.length ? recentSessionPreview : [station],
      sourceId: 'history',
      sourceLabel: t('playlist.historyTitle')
    });
  };

  const renderCollectionStations = (collection: (typeof collections)[number]) => {
    const collectionStations = collection.stationIds
      .map((stationId) => stationMap.get(stationId))
      .filter(Boolean) as StationLite[];

    if (!collectionStations.length) {
      return <div className="empty-state library-empty-state">{t('library.collectionEmpty')}</div>;
    }

    return (
      <div className="library-collection-preview">
        <StationTable
          stations={collectionStations.slice(0, compactRows ? 3 : 4)}
          compact
          sourceId={`collection-${collection.id}`}
        />
      </div>
    );
  };

  return (
    <section className="screen screen-library-v2">
      <div className="library-tab-strip" role="tablist" aria-label={t('library.title')}>
        {TAB_ORDER.map((tab) => (
          <button
            key={tab}
            className={`chip library-tab-chip ${libraryTab === tab ? 'active' : ''}`}
            type="button"
            onClick={() => setLibraryTab(tab)}
          >
            <span>{t(`library.tabs.${tab}`)}</span>
            <strong className="library-tab-count">{tabCounts[tab]}</strong>
          </button>
        ))}
      </div>

      {libraryTab === 'favorites' ? (
        <div className="glass-card">
          <div className="library-section-head">
            <div>
              <div className="section-title">{t('library.tabs.favorites')}</div>
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
              <div className="hero-chip-row">
                <button className="chip active" type="button" onClick={() => setActiveSection('search')}>
                  {t('home.openSearch')}
                </button>
                <button className="chip" type="button" onClick={() => setActiveSection('globe')}>
                  {t('home.openGlobe')}
                </button>
              </div>
              {sessionStatus !== 'authenticated' ? (
                <button className="chip active" type="button" onClick={openAccountSheet}>
                  {t('account.signInAndSync')}
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {libraryTab === 'queue' ? (
        <div className="glass-card library-queue-shell">
          <div className="library-section-head">
            <div>
              <div className="section-title">{t('playlist.title')}</div>
              <div className="section-subtitle">{queueSourceLabel}</div>
            </div>
            <div className="chip-row">
              <button
                className="chip active"
                type="button"
                onClick={() => {
                  if (queue.items.length) {
                    queue.playAtIndex(Math.max(queue.currentIndex, 0));
                  }
                }}
                disabled={!queue.items.length}
              >
                {t('playlist.playCurrent')}
              </button>
              <button className="chip" type="button" onClick={playNext} disabled={queue.items.length <= 1}>
                {t('common.next')}
              </button>
              <button className="chip" type="button" onClick={() => openLibraryTab('history')}>
                {t('library.openHistoryAction')}
              </button>
              <button className="chip" type="button" onClick={() => queue.clearQueue()} disabled={!queue.items.length}>
                {t('playlist.clearQueue')}
              </button>
            </div>
          </div>
          <div className="library-queue-overview">
            <div className="globe-selection-pill">
              <span>{t('playlist.title')}</span>
              <strong>{queue.items.length}</strong>
            </div>
            <div className="globe-selection-pill">
              <span>{t('app.nowPlayingLabel')}</span>
              <strong>{queueSlotValue}</strong>
            </div>
            <div className="globe-selection-pill">
              <span>{t('favoritesScreen.journalTitle')}</span>
              <strong>{trackHistory.length}</strong>
            </div>
            <div className="globe-selection-pill">
              <span>{t('playlist.historyTitle')}</span>
              <strong>{playbackHistory.length}</strong>
            </div>
          </div>

          {queue.items.length ? (
            <div className="library-queue-layout">
              <div className="library-queue-main">
                <div className="library-queue-now-card">
                  <div className="shell-kicker">{player.current ? t('dock.liveNow') : t('common.resume')}</div>
                  <div className="section-title">
                    {queueLeadStation?.name || t('library.returnToAirEmptyTitle')}
                  </div>
                  <div className="section-subtitle">
                    {nowPlaying?.trim() ||
                      (queueLeadStation ? stationLocation(queueLeadStation) : t('playlist.empty'))}
                  </div>
                  <div className="hero-chip-row">
                    <button
                      className="chip active"
                      type="button"
                      onClick={() => {
                        if (queueLeadStation) {
                          playStation(queueLeadStation, {
                            playlist: queue.items.length ? queue.items : [queueLeadStation],
                            sourceId: queue.sourceId || 'queue',
                            sourceLabel: queueSourceLabel
                          });
                        }
                      }}
                      disabled={!queueLeadStation}
                    >
                      {player.current && player.isPlaying ? t('playlist.playing') : t('common.play')}
                    </button>
                    <button className="chip" type="button" onClick={playLast}>
                      {t('common.resume')}
                    </button>
                    <button className="chip" type="button" onClick={() => openLibraryTab('recent')}>
                      {t('library.openRecentAction')}
                    </button>
                  </div>
                </div>

                <div className="playlist-list library-queue-list">
                  {queue.items.map((station, index) => {
                    const active =
                      index === queue.currentIndex && player.current?.stationuuid === station.stationuuid;
                    const nextUp = !active && index === Math.max(queue.currentIndex, 0) + 1;
                    return (
                      <div key={station.stationuuid} className={`playlist-row ${active ? 'active' : ''}`}>
                        <div className="playlist-order">{index + 1}</div>
                        <div className="playlist-body library-queue-row-copy">
                          <div className="library-queue-row-head">
                            <div className="playlist-name">{station.name}</div>
                            {active ? (
                              <span className="library-status-pill active">{t('playlist.playing')}</span>
                            ) : nextUp ? (
                              <span className="library-status-pill">{t('common.next')}</span>
                            ) : null}
                          </div>
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
              </div>

              <div className="library-queue-rail">
                <div className="glass-card library-queue-side-card">
                  <div className="section-title">{t('playlist.historyTitle')}</div>
                  <div className="section-subtitle">{t('library.stationHistory')}</div>
                  {recentSessionPreview.length ? (
                    <div className="playlist-history-list">
                      {recentSessionPreview.map((station) => (
                        <button
                          key={`${station.stationuuid}-${station.name}`}
                          className="playlist-history-item library-history-button"
                          type="button"
                          onClick={() => playHistoryStation(station)}
                        >
                          <div className="playlist-history-name">{station.name}</div>
                          <div className="playlist-history-meta">{stationLocation(station)}</div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">{t('playlist.historyEmpty')}</div>
                  )}
                </div>

                <div className="glass-card library-queue-side-card">
                  <div className="section-title">{t('favoritesScreen.journalTitle')}</div>
                  <div className="section-subtitle">{t('library.trackJournalCollapsed')}</div>
                  {trackJournalPreview.length ? (
                    <div className="track-list">
                      {trackJournalPreview.map((item) => (
                        <div key={item.id} className="track-card">
                          <div className="track-card-copy">
                            <div className="track-title">{item.track}</div>
                            <div className="track-meta">{item.stationName}</div>
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
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-state library-empty-state library-queue-empty-state">
              <div className="library-empty-title">{t('library.emptyQueueTitle')}</div>
              <div className="section-subtitle">{t('playlist.empty')}</div>
              <div className="hero-chip-row">
                <button className="chip active" type="button" onClick={() => setActiveSection('search')}>
                  {t('home.openSearch')}
                </button>
                <button className="chip" type="button" onClick={() => setActiveSection('globe')}>
                  {t('home.openGlobe')}
                </button>
                <button
                  className="chip"
                  type="button"
                  onClick={playLast}
                  disabled={!returnToAirStations.length && !recent.length && !player.current}
                >
                  {t('common.resume')}
                </button>
              </div>
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
          {recent.length ? (
            <StationTable stations={recent} compact={compactRows} sourceId="recent" />
          ) : (
            <div className="empty-state library-empty-state">
              <div className="library-empty-title">{t('explore.recentTitle')}</div>
              <div className="section-subtitle">{t('explore.recentEmpty')}</div>
              <div className="hero-chip-row">
                <button className="chip active" type="button" onClick={() => setActiveSection('search')}>
                  {t('home.openSearch')}
                </button>
                <button className="chip" type="button" onClick={() => setActiveSection('home')}>
                  {t('nav.home')}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {libraryTab === 'tracks' ? (
        <div className="glass-card">
          <div className="library-section-head">
            <div>
              <div className="section-title">{t('favoritesScreen.journalTitle')}</div>
              <div className="section-subtitle">{t('library.trackJournal')}</div>
            </div>
            {trackHistory.length ? (
              <button className="chip" type="button" onClick={clearTrackHistory}>
                {t('common.clear')}
              </button>
            ) : null}
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
          {trackHistory.length ? (
            <div className="track-list track-list-scroll">
              {trackHistory.map((item) => (
                <div key={item.id} className="track-card">
                  <div className="track-card-copy">
                    <div className="track-title">{item.track}</div>
                    <div className="track-meta">
                      {item.stationName} · {formatTime(item.timestamp)}
                    </div>
                  </div>
                  <button className="chip" type="button" onClick={() => navigator.clipboard.writeText(item.track)}>
                    {t('common.copy')}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state library-empty-state">
              <div className="library-empty-title">{t('favoritesScreen.journalTitle')}</div>
              <div className="section-subtitle">{t('favoritesScreen.journalEmpty')}</div>
              <div className="hero-chip-row">
                <button className="chip active" type="button" onClick={() => setActiveSection('search')}>
                  {t('home.openSearch')}
                </button>
                <button className="chip" type="button" onClick={() => setActiveSection('globe')}>
                  {t('home.openGlobe')}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {libraryTab === 'history' ? (
        <div className="library-history-grid">
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

      {libraryTab === 'collections' ? (
        <div className="library-collections-stack">
          <div className="glass-card">
            <div className="library-section-head">
              <div>
                <div className="section-title">{t('library.collectionsTitle')}</div>
                <div className="section-subtitle">{t('library.collectionsCopy')}</div>
              </div>
              <button className="chip active" type="button" onClick={promptCreateCollection}>
                {t('library.createCollection')}
              </button>
            </div>
            <div className="library-collection-grid">
              {collections.length ? (
                collections.map((collection) => (
                  <div key={collection.id} className="library-collection-card">
                    <div className="library-collection-head">
                      <div>
                        <div className="section-title">{collection.name}</div>
                        <div className="section-subtitle">
                          {t('library.collectionCount', { count: collection.stationIds.length })}
                        </div>
                      </div>
                      <div className="chip-row">
                        <button
                          className="chip"
                          type="button"
                          onClick={() => {
                            const station = player.current || favorites[0] || recent[0];
                            if (station) {
                              addStationToCollection(collection.id, station);
                            }
                          }}
                        >
                          {t('library.addCurrentToCollection')}
                        </button>
                      </div>
                    </div>
                    {renderCollectionStations(collection)}
                    {collection.stationIds.length ? (
                      <div className="chip-row">
                        {collection.stationIds.slice(0, 4).map((stationId) => (
                          <button
                            key={`${collection.id}-${stationId}`}
                            className="chip"
                            type="button"
                            onClick={() => removeStationFromCollection(collection.id, stationId)}
                          >
                            {t('library.removeFromCollection')}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="empty-state library-empty-state">
                  <div className="library-empty-title">{t('library.collectionsEmptyTitle')}</div>
                  <div className="section-subtitle">{t('library.collectionsEmptyCopy')}</div>
                  <div className="hero-chip-row">
                    <button className="chip active" type="button" onClick={promptCreateCollection}>
                      {t('library.createCollection')}
                    </button>
                    <button className="chip" type="button" onClick={() => setActiveSection('search')}>
                      {t('home.openSearch')}
                    </button>
                    <button className="chip" type="button" onClick={() => setActiveSection('globe')}>
                      {t('home.openGlobe')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="library-history-grid">
            <div className="glass-card">
              <div className="section-title">{t('library.followedStationsTitle')}</div>
              <div className="section-subtitle">{t('library.followedStationsCopy')}</div>
              {libraryFeed.followedStationsPreview.length ? (
                <div className="playlist-history-list">
                  {libraryFeed.followedStationsPreview.map((station) => (
                    <div key={station.stationId} className="playlist-history-item">
                      <div className="playlist-history-name">{station.stationName}</div>
                      <div className="playlist-history-meta">{station.country}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">{t('library.followedStationsEmpty')}</div>
              )}
            </div>

            <div className="glass-card">
              <div className="section-title">{t('library.followedRegionsTitle')}</div>
              <div className="section-subtitle">{t('library.followedRegionsCopy')}</div>
              {libraryFeed.followedRegionsPreview.length ? (
                <div className="playlist-history-list">
                  {libraryFeed.followedRegionsPreview.map((region) => (
                    <div key={region.id} className="playlist-history-item">
                      <div className="playlist-history-name">{region.label}</div>
                      <div className="playlist-history-meta">{region.scope}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">{t('library.followedRegionsEmpty')}</div>
              )}
            </div>
          </div>

          <div className="glass-card">
            <div className="library-section-head">
              <div>
                <div className="section-title">{t('library.alertsTitle')}</div>
                <div className="section-subtitle">{t('library.alertsCopy')}</div>
              </div>
              <div className={`globe-selection-pill ${unreadAlerts.length ? 'active' : ''}`}>
                <span>{t('library.alertsUnread')}</span>
                <strong>{libraryFeed.unreadAlerts}</strong>
              </div>
            </div>
            {alerts.length ? (
              <div className="track-list track-list-scroll">
                {alerts.slice(0, 8).map((alert) => (
                  <div key={alert.id} className={`track-card ${alert.readAt ? '' : 'active'}`}>
                    <div className="track-card-copy">
                      <div className="track-title">{alert.title}</div>
                      <div className="track-meta">{alert.body}</div>
                    </div>
                    <button className="chip" type="button" onClick={() => markAlertRead(alert.id)}>
                      {alert.readAt ? t('library.alertRead') : t('library.alertMarkRead')}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">{t('library.alertsEmpty')}</div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
};
