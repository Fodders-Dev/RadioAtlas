import { startTransition, useMemo, useState } from 'react';
import { StationTable } from '../components/StationTable';
import { useDebounce } from '../lib/useDebounce';
import { toLite } from '../lib/stationUtils';
import { useLocale } from '../state/LocaleContext';
import { useRadio } from '../state/RadioContext';
import type { StationLite } from '../types';

const hashValue = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const seededSort = <T,>(items: T[], seed: number, pickKey: (item: T) => string) =>
  [...items].sort((left, right) => {
    const leftScore = hashValue(`${pickKey(left)}:${seed}`);
    const rightScore = hashValue(`${pickKey(right)}:${seed}`);
    return leftScore - rightScore;
  });

const firstMeaningfulTag = (value: string) =>
  value
    .split(',')
    .map((tag) => tag.trim())
    .find((tag) => tag && tag.toLowerCase() !== 'no tags') || '';

const uniqueStations = (stations: StationLite[]) => {
  const seen = new Set<string>();
  return stations.filter((station) => {
    if (seen.has(station.stationuuid)) return false;
    seen.add(station.stationuuid);
    return true;
  });
};

export const Home = () => {
  const {
    stations,
    player,
    queue,
    setActiveSection
  } = useRadio();
  const { t } = useLocale();
  const [query, setQuery] = useState('');
  const [showcaseSeed, setShowcaseSeed] = useState(() => Date.now());
  const debounced = useDebounce(query, 220);
  const catalog = useMemo(() => stations.map(toLite), [stations]);
  const queuePreview = useMemo(
    () => queue.items.slice(Math.max(queue.currentIndex, 0), Math.max(queue.currentIndex, 0) + 4),
    [queue.currentIndex, queue.items]
  );

  const discoveryDeck = useMemo(() => seededSort(catalog, showcaseSeed, (station) => station.stationuuid), [catalog, showcaseSeed]);

  const freshSignals = useMemo(() => discoveryDeck.slice(0, 4), [discoveryDeck]);
  const searchLaunch = useMemo(() => discoveryDeck.slice(4, 8), [discoveryDeck]);
  const queueFallback = useMemo(() => discoveryDeck.slice(8, 12), [discoveryDeck]);

  const countryBuckets = useMemo(() => {
    const buckets = new Map<string, { label: string; stations: StationLite[] }>();
    catalog.forEach((station) => {
      const country = station.country?.trim();
      if (!country) return;
      const current = buckets.get(country);
      if (current) {
        current.stations.push(station);
      } else {
        buckets.set(country, { label: country, stations: [station] });
      }
    });
    return Array.from(buckets.values()).filter((bucket) => bucket.stations.length >= 4);
  }, [catalog]);

  const tagBuckets = useMemo(() => {
    const buckets = new Map<string, StationLite[]>();
    catalog.forEach((station) => {
      const tag = firstMeaningfulTag(station.tags || '');
      if (!tag) return;
      const current = buckets.get(tag);
      if (current) {
        current.push(station);
      } else {
        buckets.set(tag, [station]);
      }
    });
    return Array.from(buckets.entries())
      .filter(([, bucket]) => bucket.length >= 4)
      .map(([label, bucket]) => ({ label, stations: bucket }));
  }, [catalog]);

  const countrySpotlight = useMemo(() => {
    const picked = seededSort(countryBuckets, showcaseSeed + 17, (bucket) => bucket.label)[0];
    if (!picked) return null;
    return {
      label: picked.label,
      stations: seededSort(uniqueStations(picked.stations), showcaseSeed + 29, (station) => station.stationuuid).slice(0, 4)
    };
  }, [countryBuckets, showcaseSeed]);

  const genreSpotlight = useMemo(() => {
    const picked = seededSort(tagBuckets, showcaseSeed + 41, (bucket) => bucket.label)[0];
    if (!picked) return null;
    return {
      label: picked.label,
      stations: seededSort(uniqueStations(picked.stations), showcaseSeed + 53, (station) => station.stationuuid).slice(0, 4)
    };
  }, [showcaseSeed, tagBuckets]);

  const quickResults = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    if (!q) return searchLaunch.length ? searchLaunch : freshSignals;
    return stations
      .filter((station) => [station.name, station.country, station.tags, station.language].join(' ').toLowerCase().includes(q))
      .slice(0, 4)
      .map(toLite);
  }, [debounced, freshSignals, searchLaunch, stations]);

  const refreshShowcase = () => {
    startTransition(() => {
      setShowcaseSeed(Date.now());
    });
  };

  return (
    <section className="screen screen-home-v2">
      <div className="shell-hero glass-card motion-rise">
        <div className="shell-hero-copy">
          <div className="shell-kicker">{t('home.kicker')}</div>
          <h1>{t('home.title')}</h1>
          <p>{t('home.subtitle')}</p>
          <div className="hero-chip-row">
            <button className="chip active" type="button" onClick={() => setActiveSection('search')}>
              {t('home.openSearch')}
            </button>
            <button className="chip" type="button" onClick={() => setActiveSection('globe')}>
              {t('home.openGlobe')}
            </button>
            <button className="chip" type="button" onClick={refreshShowcase}>
              {t('home.refreshFeed')}
            </button>
          </div>
        </div>
        <div className="home-hero-note">
          <div className="globe-selection-pill">
            <span>{t('home.freshSignalsTitle')}</span>
            <strong>{freshSignals.length}</strong>
          </div>
          {countrySpotlight ? (
            <div className="globe-selection-pill">
              <span>{t('home.countrySpotlightPill')}</span>
              <strong>{countrySpotlight.label}</strong>
            </div>
          ) : null}
          {genreSpotlight ? (
            <div className="globe-selection-pill">
              <span>{t('home.genreSpotlightPill')}</span>
              <strong>{genreSpotlight.label}</strong>
            </div>
          ) : null}
        </div>
      </div>

      <div className="home-grid">
        <div className="home-main-stack">
          <div className="glass-card home-search-card motion-rise motion-delay-1">
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

          <div className="home-showcase-grid">
            <div className="glass-card home-feature-card motion-rise motion-delay-2">
              <div className="library-section-head">
                <div>
                  <div className="section-title">{t('home.freshSignalsTitle')}</div>
                  <div className="section-subtitle">{t('home.freshSignalsCopy')}</div>
                </div>
                <button className="chip" type="button" onClick={refreshShowcase}>
                  {t('home.refreshFeed')}
                </button>
              </div>
              <div className="home-mini-list">
                <StationTable stations={freshSignals} compact sourceId="home-fresh-signals" />
              </div>
            </div>

            <div className="glass-card home-feature-card motion-rise motion-delay-3">
              <div className="library-section-head">
                <div>
                  <div className="section-title">
                    {countrySpotlight
                      ? t('home.countrySpotlightTitle', { country: countrySpotlight.label })
                      : t('home.freshSignalsTitle')}
                  </div>
                  <div className="section-subtitle">
                    {countrySpotlight
                      ? t('home.countrySpotlightCopy')
                      : t('home.freshSignalsCopy')}
                  </div>
                </div>
                <button className="chip" type="button" onClick={() => setActiveSection('globe')}>
                  {t('home.openGlobe')}
                </button>
              </div>
              <div className="home-mini-list">
                <StationTable
                  stations={countrySpotlight?.stations || freshSignals}
                  compact
                  sourceId="home-country-spotlight"
                />
              </div>
            </div>
          </div>
        </div>

        <aside className="home-side-stack">
          <div className="glass-card motion-rise motion-delay-2">
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
              <StationTable
                stations={queuePreview.length ? queuePreview : queueFallback.length ? queueFallback : freshSignals}
                compact
                sourceId="home-queue"
              />
            </div>
          </div>

          <div className="glass-card motion-rise motion-delay-4">
            <div className="library-section-head">
              <div>
                <div className="section-title">
                  {genreSpotlight
                    ? t('home.genreSpotlightTitle', { genre: genreSpotlight.label })
                    : t('home.freshSignalsTitle')}
                </div>
                <div className="section-subtitle">
                  {genreSpotlight
                    ? t('home.genreSpotlightCopy')
                    : t('home.freshSignalsCopy')}
                </div>
              </div>
              <button className="chip" type="button" onClick={() => setActiveSection('search')}>
                {t('home.openSearch')}
              </button>
            </div>
            <div className="home-mini-list">
              <StationTable
                stations={genreSpotlight?.stations || freshSignals}
                compact
                sourceId="home-genre-spotlight"
              />
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
};
