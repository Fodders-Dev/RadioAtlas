import { useMemo, useState } from 'react';
import { StationTable } from '../components/StationTable';
import { useDebounce } from '../lib/useDebounce';
import { toLite } from '../lib/stationUtils';
import { useLocale } from '../state/LocaleContext';
import { useRadio } from '../state/RadioContext';
import type { LibraryTab } from '../types';

export const Home = () => {
  const {
    stations,
    player,
    favorites,
    recent,
    libraryTab,
    setLibraryTab,
    queue,
    setActiveSection
  } = useRadio();
  const { t } = useLocale();
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 220);

  const trending = useMemo(() => stations.slice(0, 8).map(toLite), [stations]);
  const favoritePreview = useMemo(() => favorites.slice(0, 4), [favorites]);
  const recentPreview = useMemo(() => recent.slice(0, 4), [recent]);
  const queuePreview = useMemo(
    () => queue.items.slice(Math.max(queue.currentIndex, 0), Math.max(queue.currentIndex, 0) + 4),
    [queue.currentIndex, queue.items]
  );

  const quickResults = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    if (!q) return trending.slice(0, 4);
    return stations
      .filter((station) => [station.name, station.country, station.tags, station.language].join(' ').toLowerCase().includes(q))
      .slice(0, 4)
      .map(toLite);
  }, [debounced, stations, trending]);

  const previewTab = (libraryTab === 'history' ? 'recent' : libraryTab) as Exclude<LibraryTab, 'history'>;
  const previewStations =
    previewTab === 'favorites' ? favoritePreview : previewTab === 'recent' ? recentPreview : queuePreview;
  const previewSourceId = previewTab === 'favorites' ? 'favorites' : previewTab === 'recent' ? 'recent' : 'home-queue';
  const previewFallback = previewTab === 'queue' ? trending.slice(0, 4) : trending.slice(0, 3);
  const previewSubtitle =
    previewTab === 'favorites'
      ? t('home.libraryFavoritesCopy')
      : previewTab === 'recent'
        ? t('home.libraryRecentCopy')
        : t('home.libraryQueueCopy');
  const previewTabs: Array<Exclude<LibraryTab, 'history'>> = ['favorites', 'recent', 'queue'];

  return (
    <section className="screen screen-home-v2">
      <div className="shell-hero glass-card">
        <div className="shell-hero-copy">
          <div className="shell-kicker">{t('home.kicker')}</div>
          <h1>{t('home.title')}</h1>
          <p>{t('home.subtitle')}</p>
          <div className="hero-chip-row">
            <button className="chip active" type="button" onClick={() => setActiveSection('globe')}>
              {t('home.openGlobe')}
            </button>
            <button className="chip" type="button" onClick={() => setActiveSection('search')}>
              {t('home.openSearch')}
            </button>
          </div>
        </div>
      </div>

      <div className="home-grid">
        <div className="home-main-stack">
          <div className="glass-card home-search-card">
            <div className="library-section-head">
              <div>
                <div className="section-title">{t('home.quickMix')}</div>
                <div className="section-subtitle">{t('home.quickMixCopy')}</div>
              </div>
              <button className="chip" type="button" onClick={() => setActiveSection('search')}>
                {t('home.openSearch')}
              </button>
            </div>
            <div className="search-bar home-search-bar">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('explore.quickSearchPlaceholder')}
              />
              {query ? (
                <button className="clear-btn" type="button" onClick={() => setQuery('')}>
                  {t('common.clear')}
                </button>
              ) : null}
            </div>
            <div className="home-mini-list">
              <StationTable stations={quickResults} compact sourceId={query ? 'home-search' : 'home-trending'} />
            </div>
          </div>

        </div>

        <aside className="home-side-stack">
          <div className="glass-card">
            <div className="section-title">{t('home.resumeTitle')}</div>
            <div className="section-subtitle">
              {player.current
                ? t('explore.resumeReady', {
                    station: player.current.name,
                    source: queue.sourceLabel || t('radio.queueDefault')
                  })
                : t('explore.resumeEmpty')}
            </div>
            <div className="hero-chip-row">
              <button
                className="chip active"
                type="button"
                onClick={() => {
                  if (player.current) {
                    void player.toggle();
                  }
                }}
                disabled={!player.current}
              >
                {player.current && player.isPlaying ? t('common.pause') : t('common.play')}
              </button>
              <button className="chip" type="button" onClick={() => setActiveSection('library')}>
                {t('home.openLibrary')}
              </button>
            </div>
            <div className="home-mini-list">
              <StationTable stations={queuePreview.length ? queuePreview : trending.slice(0, 4)} compact sourceId="home-queue" />
            </div>
          </div>

          <div className="glass-card">
            <div className="library-section-head">
              <div>
                <div className="section-title">{t('home.libraryTitle')}</div>
                <div className="section-subtitle">{previewSubtitle}</div>
              </div>
              <button className="chip" type="button" onClick={() => setActiveSection('library')}>
                {t('home.openLibrary')}
              </button>
            </div>
            <div className="chip-row">
              {previewTabs.map((tab) => (
                <button
                  key={tab}
                  className={`chip ${previewTab === tab ? 'active' : ''}`}
                  type="button"
                  onClick={() => setLibraryTab(tab)}
                >
                  {t(`library.tabs.${tab}`)}
                </button>
              ))}
            </div>
            <div className="home-mini-list">
              <StationTable
                stations={previewStations.length ? previewStations : previewFallback}
                compact
                sourceId={previewSourceId}
              />
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
};
