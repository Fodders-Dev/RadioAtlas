import { startTransition, useDeferredValue, useMemo, useState } from 'react';
import { createDiscoveryFeed } from '../lib/discoveryFeed';
import { AccountCard } from '../components/AccountCard';
import { StationTable } from '../components/StationTable';
import { useDebounce } from '../lib/useDebounce';
import { toLite } from '../lib/stationUtils';
import { useCompactLayout } from '../lib/useCompactLayout';
import { useLocale } from '../state/LocaleContext';
import { useRadio } from '../state/RadioContext';
import { useSession } from '../state/SessionContext';
import type { DiscoveryStationModule } from '../domain/contracts';
import type { StationLite } from '../types';

export const Home = () => {
  const {
    stations,
    favorites,
    recent,
    collections,
    followedStations,
    player,
    queue,
    setActiveSection
  } = useRadio();
  const { profile } = useSession();
  const { t } = useLocale();
  const [query, setQuery] = useState('');
  const isCompactLayout = useCompactLayout();
  const [showcaseSeed, setShowcaseSeed] = useState(() => Date.now());
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
        showcaseSeed,
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
      showcaseSeed
    ]
  );

  const refreshShowcase = () => {
    startTransition(() => {
      setShowcaseSeed(Date.now());
    });
  };

  const renderDiscoveryCard = (module: DiscoveryStationModule, index = 2) => {
    if (module.kind === 'fresh-signals') {
      return (
        <div className="glass-card home-feature-card home-feature-card-primary motion-rise motion-delay-2" data-home-module="fresh-signals">
          <div className="library-section-head">
            <div>
              <div className="shell-kicker">{t('home.discoveryKicker')}</div>
              <div className="section-title">{t('home.freshSignalsTitle')}</div>
              <div className="section-subtitle">{t(isCompactLayout ? 'home.freshSignalsCopyCompact' : 'home.freshSignalsCopy')}</div>
            </div>
            <button className="chip" type="button" onClick={refreshShowcase}>
              {t('home.refreshFeed')}
            </button>
          </div>
          <div className="home-mini-list">
            <StationTable stations={module.stations} compact sourceId={module.sourceId} />
          </div>
        </div>
      );
    }

    if (module.kind === 'revived-stations') {
      return (
        <div className={`glass-card home-feature-card motion-rise motion-delay-${index}`} data-home-module="revived-stations">
          <div className="library-section-head">
            <div>
              <div className="shell-kicker">{t('home.revivedKicker')}</div>
              <div className="section-title">{t('home.revivedTitle')}</div>
              <div className="section-subtitle">{t(isCompactLayout ? 'home.revivedCopyCompact' : 'home.revivedCopy')}</div>
            </div>
            <button className="chip" type="button" onClick={() => setActiveSection('library')}>
              {t('home.openLibrary')}
            </button>
          </div>
          <div className="home-mini-list">
            <StationTable stations={module.stations} compact sourceId={module.sourceId} />
          </div>
        </div>
      );
    }

    if (module.kind === 'country-spotlight') {
      return (
        <div className={`glass-card home-feature-card home-feature-card-secondary motion-rise motion-delay-${index}`} data-home-module="country-spotlight">
          <div className="library-section-head">
            <div>
              <div className="shell-kicker">{t('home.mapKicker')}</div>
              <div className="section-title">{t('home.countrySpotlightTitle', { country: module.label || '' })}</div>
              <div className="section-subtitle">{t(isCompactLayout ? 'home.countrySpotlightCopyCompact' : 'home.countrySpotlightCopy')}</div>
            </div>
            <button className="chip" type="button" onClick={() => setActiveSection('globe')}>
              {t('home.openGlobe')}
            </button>
          </div>
          <div className="home-mini-list">
            <StationTable stations={module.stations} compact sourceId={module.sourceId} />
          </div>
        </div>
      );
    }

    if (module.kind === 'session-delta') {
      return (
        <div className={`glass-card home-feature-card motion-rise motion-delay-${index}`} data-home-module="session-delta">
          <div className="library-section-head">
            <div>
              <div className="shell-kicker">{t('home.deltaKicker')}</div>
              <div className="section-title">{t('home.sessionDeltaTitle')}</div>
              <div className="section-subtitle">{t(isCompactLayout ? 'home.sessionDeltaCopyCompact' : 'home.sessionDeltaCopy')}</div>
            </div>
          </div>
          <div className="home-mini-list">
            <StationTable stations={module.stations} compact sourceId={module.sourceId} />
          </div>
        </div>
      );
    }

    if (module.kind === 'sponsored') {
      return (
        <div className={`glass-card home-session-card motion-rise motion-delay-${index} sponsored-module`} data-home-module="sponsored">
          <div className="library-section-head">
            <div>
              <div className="shell-kicker">{t('home.sponsoredKicker')}</div>
              <div className="section-title">{t('home.sponsoredTitle')}</div>
              <div className="section-subtitle">{t(isCompactLayout ? 'home.sponsoredCopyCompact' : 'home.sponsoredCopy')}</div>
            </div>
            <div className="chip active">{t('home.sponsoredBadge')}</div>
          </div>
          <div className="home-mini-list">
            <StationTable stations={module.stations} compact sourceId={module.sourceId} />
          </div>
        </div>
      );
    }

    if (module.kind === 'genre-spotlight') {
      return (
        <div className={`glass-card home-pulse-card home-pulse-card-accent motion-rise motion-delay-${index}`} data-home-module="genre-spotlight">
          <div className="library-section-head">
            <div>
              <div className="shell-kicker">{t('home.genreKicker')}</div>
              <div className="section-title">{t('home.genreSpotlightTitle', { genre: module.label || '' })}</div>
              <div className="section-subtitle">{t('home.genreSpotlightCopy')}</div>
            </div>
          </div>
          <div className="home-pulse-metrics">
            <div className="globe-selection-pill">
              <span>{t('home.catalogPulseCountries')}</span>
              <strong>{discoveryFeed.metrics.countries}</strong>
            </div>
            <div className="globe-selection-pill">
              <span>{t('home.catalogPulseLanguages')}</span>
              <strong>{discoveryFeed.metrics.languages}</strong>
            </div>
            <div className="globe-selection-pill">
              <span>{t('home.catalogPulseGenres')}</span>
              <strong>{discoveryFeed.metrics.genres}</strong>
            </div>
          </div>
          <div className="home-pulse-chipcloud">
            {discoveryFeed.tagRadar.slice(0, 2).map((tag, chipIndex) => (
              <button
                key={`${tag.label}-${chipIndex}`}
                className={`chip ${module.label === tag.label ? 'active' : ''}`}
                type="button"
                onClick={() => setActiveSection('search')}
                title={`${tag.label} · ${tag.count}`}
              >
                {tag.label}
              </button>
            ))}
          </div>
          <div className="hero-chip-row">
            <button className="chip active" type="button" onClick={() => setActiveSection('search')}>
              {t('home.openSearch')}
            </button>
            <button className="chip" type="button" onClick={() => setActiveSection('globe')}>
              {t('home.openGlobe')}
            </button>
          </div>
          <div className="home-mini-list">
            <StationTable stations={module.stations} compact sourceId={module.sourceId} />
          </div>
        </div>
      );
    }

    return null;
  };

  const moreDiscoveryModules = discoveryFeed.rankedDiscoveryModules.filter(
    (module) => module.kind !== discoveryFeed.primaryDiscoveryModule?.kind
  );

  const quickSearchCard = (
    <div className="glass-card home-search-card home-search-card-primary motion-rise motion-delay-1" data-home-module="search-preview">
      <div className="library-section-head">
        <div>
          <div className="shell-kicker">{t('home.searchKicker')}</div>
          <div className="section-title">{t('home.searchTitle')}</div>
          <div className="section-subtitle">{t(isCompactLayout ? 'home.quickMixCopyCompact' : 'home.quickMixCopy')}</div>
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
        <StationTable stations={discoveryFeed.quickResults} compact sourceId={query ? 'home-search' : 'home-trending'} />
      </div>
    </div>
  );

  const resumeCard = (
    <div className="glass-card home-session-card motion-rise motion-delay-2" data-home-module="resume">
      <div className="library-section-head">
        <div>
          <div className="shell-kicker">{t('home.sessionKicker')}</div>
          <div className="section-title">{t('home.resumeTitle')}</div>
          <div className="section-subtitle">
            {player.current
              ? t('explore.resumeReady', {
                  station: player.current.name,
                  source: queue.sourceLabel || t('radio.queueDefault')
                })
              : discoveryFeed.resumeStations.length
                ? t('home.resumeQueueCopy', { count: discoveryFeed.resumeStations.length })
                : t('explore.resumeEmpty')}
          </div>
        </div>
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
      {discoveryFeed.resumeStations.length || player.current ? (
        <div className="home-mini-list">
          <StationTable
            stations={
              discoveryFeed.resumeStations.length
                ? discoveryFeed.resumeStations
                : ([player.current].filter(Boolean) as StationLite[])
            }
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
  );

  return (
    <section className="screen screen-home-v2">
      <div className="home-grid">
        <div className="home-main-stack">
          {discoveryFeed.promoteDiscoveryAbove === 'quick-search' ? renderDiscoveryCard(discoveryFeed.primaryDiscoveryModule, 1) : null}
          {quickSearchCard}
          {discoveryFeed.promoteDiscoveryAbove === 'resume' ? renderDiscoveryCard(discoveryFeed.primaryDiscoveryModule, 2) : null}
          {resumeCard}

          {moreDiscoveryModules.length ? (
            <div className="home-showcase-grid">
              <div className="library-section-head">
                <div>
                  <div className="shell-kicker">{t('home.moreDiscoveriesKicker')}</div>
                  <div className="section-title">{t('home.moreDiscoveriesTitle')}</div>
                </div>
              </div>
              {moreDiscoveryModules.map((module, index) => (
                <div key={`${module.kind}-${index}`}>{renderDiscoveryCard(module, index + 3)}</div>
              ))}
            </div>
          ) : null}
        </div>

        <aside className="home-side-stack">
          <AccountCard />
        </aside>
      </div>
    </section>
  );
};
