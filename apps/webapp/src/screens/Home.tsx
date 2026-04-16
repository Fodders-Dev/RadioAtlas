import { startTransition, useDeferredValue, useMemo, useState } from 'react';
import { StationTable } from '../components/StationTable';
import { createDiscoveryFeed } from '../lib/discoveryFeed';
import { createHomeRecommendationFeed } from '../lib/homeProfile';
import { useDebounce } from '../lib/useDebounce';
import { toLite } from '../lib/stationUtils';
import { useCompactLayout } from '../lib/useCompactLayout';
import { useLocale } from '../state/LocaleContext';
import { useRadio } from '../state/RadioContext';
import { useSession } from '../state/SessionContext';
import type { StationLite } from '../types';

export const Home = () => {
  const {
    stations,
    favorites,
    recent,
    collections,
    followedStations,
    trackHistory,
    playbackHistory,
    behaviorProfile,
    player,
    queue,
    setActiveSection
  } = useRadio();
  const { profile } = useSession();
  const { t } = useLocale();
  const isCompactLayout = useCompactLayout();
  const [query, setQuery] = useState('');
  const [rotationSeed, setRotationSeed] = useState(() => Date.now());
  const deferredQuery = useDeferredValue(query);
  const debounced = useDebounce(deferredQuery, 220);

  const catalog = useMemo(() => stations.map(toLite), [stations]);
  const queuePreview = useMemo(
    () => queue.items.slice(Math.max(queue.currentIndex, 0), Math.max(queue.currentIndex, 0) + 4),
    [queue.currentIndex, queue.items]
  );
  const languageCount = useMemo(() => {
    const labels = new Set(
      catalog
        .map((station) => station.language?.trim())
        .filter((value): value is string => Boolean(value))
    );
    return labels.size;
  }, [catalog]);
  const countryCount = useMemo(
    () =>
      new Set(catalog.map((station) => station.country?.trim()).filter((value): value is string => Boolean(value)))
        .size,
    [catalog]
  );
  const genreCount = useMemo(
    () =>
      new Set(
        catalog
          .flatMap((station) => (station.tags || '').split(',').map((tag) => tag.trim()))
          .filter(Boolean)
      ).size,
    [catalog]
  );

  const discoveryFeed = useMemo(
    () =>
      createDiscoveryFeed({
        catalog,
        favorites,
        recent,
        queuePreview,
        followedStations,
        collections,
        showcaseSeed: rotationSeed,
        query: debounced,
        metrics: {
          countries: countryCount,
          languages: languageCount,
          genres: genreCount
        },
        includeSponsored: !profile?.entitlements.includes('sponsor-free')
      }),
    [
      catalog,
      collections,
      countryCount,
      debounced,
      favorites,
      followedStations,
      genreCount,
      languageCount,
      profile?.entitlements,
      queuePreview,
      recent,
      rotationSeed
    ]
  );

  const homeFeed = useMemo(
    () =>
      createHomeRecommendationFeed({
        catalog,
        favorites,
        recent,
        queuePreview,
        playbackHistory,
        trackHistory,
        collections,
        followedStations,
        behaviorProfile,
        currentStation: player.current,
        rotationSeed
      }),
    [
      behaviorProfile,
      catalog,
      collections,
      favorites,
      followedStations,
      playbackHistory,
      player.current,
      queuePreview,
      recent,
      rotationSeed,
      trackHistory
    ]
  );

  const tasteSignals = useMemo(() => {
    if (homeFeed.tasteSignals.length) {
      return homeFeed.tasteSignals.slice(0, isCompactLayout ? 3 : 4);
    }
    return discoveryFeed.tagRadar.slice(0, isCompactLayout ? 3 : 4).map((tag) => ({
      kind: 'tag' as const,
      label: tag.label,
      score: tag.count
    }));
  }, [discoveryFeed.tagRadar, homeFeed.tasteSignals, isCompactLayout]);

  const personalizedStations = homeFeed.tunedForYou.length
    ? homeFeed.tunedForYou
    : discoveryFeed.freshSignals.stations;
  const likedStations =
    homeFeed.becauseYouLiked.length
      ? homeFeed.becauseYouLiked
      : discoveryFeed.revivedStations?.stations || discoveryFeed.genreSpotlight?.stations || personalizedStations;
  const orbitStations =
    homeFeed.outsideOrbit.length
      ? homeFeed.outsideOrbit
      : discoveryFeed.countrySpotlight?.stations || discoveryFeed.genreSpotlight?.stations || personalizedStations;
  const returnStations =
    homeFeed.returnToAir.length
      ? homeFeed.returnToAir
      : discoveryFeed.resumeStations.length
        ? discoveryFeed.resumeStations
        : ([player.current].filter(Boolean) as StationLite[]);

  const refreshFeed = () => {
    startTransition(() => {
      setRotationSeed(Date.now());
    });
  };

  return (
    <section className="screen screen-home-v2 screen-home-v3">
      <div className="glass-card home-personal-card motion-rise">
        <div className="search-results-head-minimal">
          <div className="section-title">{t('home.personalTitle')}</div>
          <div className="search-results-meta">
            <span>{t('home.behaviorActions')}</span>
            <strong>{homeFeed.profileReady ? homeFeed.actionTotal : 0}</strong>
          </div>
        </div>

        {!homeFeed.profileReady ? (
          <div className="home-card-note">
            {t(isCompactLayout ? 'home.personalEmptyCopyCompact' : 'home.personalEmptyCopy')}
          </div>
        ) : null}

        {homeFeed.profileReady && tasteSignals.length ? (
          <div className="search-chip-row home-taste-row">
            {tasteSignals.map((signal) => (
              <button
                key={`${signal.kind}-${signal.label}`}
                className="search-mini-chip"
                type="button"
                onClick={() => setQuery(signal.label)}
                title={`${signal.label} · ${signal.score}`}
              >
                <span className="search-mini-chip-label">{signal.label}</span>
                <strong className="search-mini-chip-meta">{signal.score}</strong>
              </button>
            ))}
          </div>
        ) : null}

        <div className="home-mini-list">
          <StationTable stations={personalizedStations} compact sourceId="home-for-you" />
        </div>

        <div className="chip-row home-personal-actions">
          <button className="chip active" type="button" onClick={refreshFeed}>
            {t('home.refreshFeed')}
          </button>
          <button className="chip" type="button" onClick={() => setActiveSection('search')}>
            {t('home.openSearch')}
          </button>
          <button className="chip" type="button" onClick={() => setActiveSection('globe')}>
            {t('home.openGlobe')}
          </button>
        </div>
      </div>

      <div className="home-support-grid">
        <div className="glass-card home-quick-card motion-rise motion-delay-1">
          <div className="search-results-head-minimal">
            <div className="section-title">{t('home.searchTitle')}</div>
            <div className="search-results-meta">
              <span>{query.trim() ? t('home.matchesLabel') : t('home.resultsLabel')}</span>
              <strong>{query.trim() ? discoveryFeed.quickResults.length : stations.length}</strong>
            </div>
          </div>
          <div className="search-bar home-search-bar home-search-bar-compact">
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
          {tasteSignals.length ? (
            <div className="chip-row">
              {tasteSignals.map((signal) => (
                <button
                  key={`quick-${signal.kind}-${signal.label}`}
                  className="chip"
                  type="button"
                  onClick={() => setQuery(signal.label)}
                >
                  {signal.label}
                </button>
              ))}
            </div>
          ) : null}
          <div className="home-mini-list">
            <StationTable
              stations={discoveryFeed.quickResults}
              compact
              sourceId={query.trim() ? 'home-search' : 'home-trending'}
            />
          </div>
        </div>

        <div className="glass-card home-continue-card motion-rise motion-delay-2">
          <div className="search-results-head-minimal">
            <div className="section-title">{t('home.resumeTitle')}</div>
            <div className="search-results-meta">
              <span>{t('home.returnMetaLabel')}</span>
              <strong>{returnStations.length}</strong>
            </div>
          </div>
          {returnStations.length ? (
            <div className="home-mini-list">
              <StationTable
                stations={returnStations}
                compact
                sourceId="home-return-to-air"
                buildQueue={queuePreview.length > 0 || recent.length > 0}
              />
            </div>
          ) : (
            <div className="empty-state home-inline-empty">
              <strong>{t('home.resumeEmptyTitle')}</strong>
              <span>{t('home.resumeEmptyCopy')}</span>
            </div>
          )}
        </div>
      </div>

      <div className="home-shelf-grid">
        <div className="glass-card home-shelf-card motion-rise motion-delay-3">
          <div className="search-results-head-minimal">
            <div className="section-title">{t('home.becauseYouLikedTitle')}</div>
            <div className="search-results-meta">
              <span>{t('home.signalsLabel')}</span>
              <strong>{Math.max(favorites.length, homeFeed.actionTotal)}</strong>
            </div>
          </div>
          <div className="home-mini-list">
            <StationTable stations={likedStations} compact sourceId="home-because-you-liked" />
          </div>
        </div>

        <div className="glass-card home-shelf-card motion-rise motion-delay-4">
          <div className="search-results-head-minimal">
            <div className="section-title">{t('home.outsideOrbitTitle')}</div>
            <div className="search-results-meta">
              <span>{t('home.signalsLabel')}</span>
              <strong>{tasteSignals.length}</strong>
            </div>
          </div>
          <div className="home-mini-list">
            <StationTable stations={orbitStations} compact sourceId="home-outside-orbit" />
          </div>
        </div>
      </div>
    </section>
  );
};
