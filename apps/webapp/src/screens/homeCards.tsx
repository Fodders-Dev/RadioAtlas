import { useEffect, useRef } from 'react';
import { StationArtwork } from '../components/StationArtwork';
import type {
  HomeHeroModule,
  HomeRailModule,
  HomeResumeModule
} from '../lib/homeSurface';
import { stationLocation, stationTags } from '../lib/stationUtils';
import { useCompactLayout } from '../lib/useCompactLayout';
import { useLocale } from '../state/LocaleContext';
import type { StationLite } from '../types';

type PlayHandler = (station: StationLite, playlist: StationLite[], sourceId: string) => void;
type ToggleFavoriteHandler = (station: StationLite) => void;
type ExploreHandler = (query: string) => void;

type HomePersonalRadioCardProps = {
  dense?: boolean;
  queueCount: number;
  isPlaying: boolean;
  disabled: boolean;
  onPlay: () => void;
};

type HomeStationTileProps = {
  station: StationLite;
  playlist: StationLite[];
  sourceId: string;
  tone: 'rail' | 'resume' | 'search';
  dense?: boolean;
  isActive: boolean;
  activeTrack: string | null;
  liked: boolean;
  onPlay: PlayHandler;
  onToggleFavorite: ToggleFavoriteHandler;
  // T2.23 render variants. `featured` widens the lead tile (~1.5×); `logoOnly`
  // renders an artwork-only chip (no text/actions) for the logo-strip lane.
  featured?: boolean;
  logoOnly?: boolean;
};

const captionForStation = (
  station: StationLite,
  isActive: boolean,
  activeTrack: string | null,
  t: ReturnType<typeof useLocale>['t']
) => {
  if (isActive && activeTrack) return activeTrack;
  return station.description || stationTags(station) || t('app.metadataUnavailable');
};

const HomeStationTile = ({
  station,
  playlist,
  sourceId,
  tone,
  dense = false,
  isActive,
  activeTrack,
  liked,
  onPlay,
  onToggleFavorite,
  featured = false,
  logoOnly = false
}: HomeStationTileProps) => {
  const { t } = useLocale();
  const caption = captionForStation(station, isActive, activeTrack, t);

  // T2.23 logo-strip variant: artwork-only chip that still plays on click and
  // keeps an accessible name (no visible text/metadata/actions).
  if (logoOnly) {
    return (
      <article
        className={`home-station-tile home-station-tile--logo ${isActive ? 'is-active' : ''}`.trim()}
        data-home-station={station.stationuuid}
      >
        <button
          className="home-logo-play"
          type="button"
          onClick={() => onPlay(station, playlist, sourceId)}
          aria-label={`${isActive ? t('common.pause') : t('common.play')}: ${station.name}`}
        >
          <StationArtwork station={station} size="card" className="home-station-artwork" />
          <span className="visually-hidden">{station.name}</span>
        </button>
      </article>
    );
  }

  return (
    <article
      className={`home-station-tile home-station-tile-${tone} ${dense ? 'is-dense' : ''} ${isActive ? 'is-active' : ''} ${featured ? 'home-station-tile--featured' : ''}`.trim()}
      data-home-station={station.stationuuid}
    >
      <div className="home-station-main">
        <StationArtwork
          station={station}
          size={tone === 'resume' ? 'sm' : 'card'}
          className="home-station-artwork"
        />
        <div className="home-station-copy">
          <div className="home-station-title" title={station.name}>
            {station.name}
          </div>
          <div className="home-station-caption" title={caption}>
            {caption}
          </div>
          <div className="home-station-meta" title={stationLocation(station)}>
            {stationLocation(station)}
          </div>
        </div>
      </div>
      <div className="home-station-actions">
        <button
          className="home-action-btn home-action-btn-play"
          type="button"
          onClick={() => onPlay(station, playlist, sourceId)}
          aria-label={isActive ? t('common.pause') : t('common.play')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {isActive ? (
              <path d="M7 5h4v14H7zm6 0h4v14h-4z" />
            ) : (
              <path d="M8 5v14l11-7z" />
            )}
          </svg>
        </button>
        <button
          className={`home-action-btn home-action-btn-like ${liked ? 'is-liked' : ''}`.trim()}
          type="button"
          onClick={() => onToggleFavorite(station)}
          aria-label={liked ? t('stationTable.unfavorite') : t('stationTable.favorite')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 21.2l-1.4-1.3C5.4 15.4 2 12.3 2 8.4 2 5.6 4.2 3.5 7 3.5c1.6 0 3.2.7 4.2 2 1-1.3 2.6-2 4.2-2 2.8 0 5 2.1 5 4.9 0 3.9-3.4 7-8.6 11.4L12 21.2z" />
          </svg>
        </button>
      </div>
    </article>
  );
};

export const HomePersonalRadioCard = ({
  dense = false,
  queueCount,
  isPlaying,
  disabled,
  onPlay
}: HomePersonalRadioCardProps) => {
  const { t } = useLocale();
  return (
    <section
      className={`home-personal-radio ${dense ? 'is-dense' : ''}`.trim()}
      data-home-personal-radio="true"
    >
      <div className="home-personal-copy">
        <span>{t('home.personalRadioTitle')}</span>
        <strong>{t('home.personalRadioCount', { count: queueCount })}</strong>
      </div>
      <button
        className="home-personal-play"
        type="button"
        onClick={onPlay}
        disabled={disabled}
        aria-label={isPlaying ? t('common.pause') : t('home.personalRadioAction')}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {isPlaying ? <path d="M7 5h4v14H7zm6 0h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}
        </svg>
        <span>{isPlaying ? t('common.pause') : t('home.personalRadioAction')}</span>
      </button>
    </section>
  );
};

type HomeHeroCardProps = {
  module: HomeHeroModule;
  dense?: boolean;
  isActive: boolean;
  activeTrack: string | null;
  liked: boolean;
  refreshing: boolean;
  onPlay: PlayHandler;
  onToggleFavorite: ToggleFavoriteHandler;
  onExplore: ExploreHandler;
  onRefresh: () => void;
};

export const HomeHeroCard = ({
  module,
  dense = false,
  isActive,
  activeTrack,
  liked,
  refreshing,
  onPlay,
  onToggleFavorite,
  onExplore,
  onRefresh
}: HomeHeroCardProps) => {
  const { t } = useLocale();
  const compactLayout = useCompactLayout();
  const station = module.station;
  const companionStations = dense || compactLayout ? [] : module.companionStations;
  const moduleLabel = module.label?.trim();

  if (!station) {
    return (
      <section className={`home-hero-card home-hero-empty ${dense ? 'is-dense' : ''}`.trim()}>
        <div className="home-hero-empty-copy">
          <strong>{t('home.heroEmptyTitle')}</strong>
          <span>{t('home.heroEmptyCopy')}</span>
        </div>
        <div className="home-hero-actions">
          <button className="home-primary-btn" type="button" onClick={() => onExplore('')}>
            {t('home.openSearch')}
          </button>
          <button className="home-secondary-btn" type="button" onClick={onRefresh}>
            {t('home.refreshFeed')}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`home-hero-card ${dense ? 'is-dense' : ''}`.trim()}
      data-home-hero={station.stationuuid}
    >
      <div className="home-hero-topline">
        <div className="home-hero-eyebrow">
          <span className="home-surface-kicker">{t(module.titleKey)}</span>
          {moduleLabel ? <span className="home-surface-label">{moduleLabel}</span> : null}
        </div>
        <button
          className={`home-refresh-chip ${refreshing ? 'is-loading' : ''}`.trim()}
          type="button"
          onClick={onRefresh}
          aria-label={t('home.refreshFeed')}
          title={t('home.refreshFeed')}
        >
          {refreshing ? (
            t('common.loading')
          ) : dense ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.76-4.24L13 11h8V3z" />
            </svg>
          ) : (
            t('home.refreshFeed')
          )}
        </button>
      </div>

      <div className="home-hero-body">
        <div className="home-hero-poster">
          <StationArtwork station={station} size="card" className="home-hero-artwork" />
          <div className="home-hero-poster-glow" />
        </div>

        <div className="home-hero-copy">
          <h2 className="home-hero-title" title={station.name}>
            {station.name}
          </h2>
          <div className="home-hero-subtitle">{stationLocation(station)}</div>

          <div className="home-hero-trackline" data-active={isActive ? 'true' : 'false'}>
            <strong>{isActive && activeTrack ? activeTrack : stationTags(station)}</strong>
            {isActive ? <span>{t('app.liveBadge')}</span> : null}
          </div>

          <div className="home-hero-actions">
            <button
              className="home-primary-btn"
              type="button"
              onClick={() => onPlay(station, [station, ...companionStations], module.sourceId)}
              aria-label={isActive ? t('common.pause') : t('common.play')}
            >
              {dense ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {isActive ? (
                    <path d="M7 5h4v14H7zm6 0h4v14h-4z" />
                  ) : (
                    <path d="M8 5v14l11-7z" />
                  )}
                </svg>
              ) : (
                isActive ? t('common.pause') : t('common.play')
              )}
            </button>
            {!dense ? (
              <button
                className="home-secondary-btn"
                type="button"
                onClick={() => onExplore(module.querySuggestion)}
              >
                {t('home.heroExploreAction')}
              </button>
            ) : null}
            <button
              className={`home-icon-btn ${liked ? 'is-liked' : ''}`.trim()}
              type="button"
              onClick={() => onToggleFavorite(station)}
              aria-label={liked ? t('stationTable.unfavorite') : t('stationTable.favorite')}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 21.2l-1.4-1.3C5.4 15.4 2 12.3 2 8.4 2 5.6 4.2 3.5 7 3.5c1.6 0 3.2.7 4.2 2 1-1.3 2.6-2 4.2-2 2.8 0 5 2.1 5 4.9 0 3.9-3.4 7-8.6 11.4L12 21.2z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {companionStations.length ? (
        <div className="home-hero-companions">
          {companionStations.map((companion) => (
            <button
              key={companion.stationuuid}
              className="home-companion-chip"
              type="button"
              onClick={() => onPlay(companion, [station, ...companionStations], module.sourceId)}
            >
              <span>{companion.name}</span>
              <strong>{stationLocation(companion)}</strong>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
};

type HomeResumeStripProps = {
  module: HomeResumeModule;
  dense?: boolean;
  currentStationId: string | null;
  activeTrack: string | null;
  isFavorite: (stationId: string) => boolean;
  onPlay: PlayHandler;
  onToggleFavorite: ToggleFavoriteHandler;
};

export const HomeResumeStrip = ({
  module,
  dense = false,
  currentStationId,
  activeTrack,
  isFavorite,
  onPlay,
  onToggleFavorite
}: HomeResumeStripProps) => {
  const { t } = useLocale();

  return (
    <section
      className={`home-resume-strip ${dense ? 'is-dense' : ''}`.trim()}
      data-home-resume="true"
    >
      <div className="home-section-head">
        <div>
          <div className="home-section-title">
            {t(dense ? 'home.resumeShelfTitleCompact' : module.titleKey)}
          </div>
          <div className="home-section-copy">
            {module.queueCount > 0
              ? t('home.resumeQueueCopy', { count: module.queueCount })
              : t(module.copyKey)}
          </div>
        </div>
        <div className="home-section-badge">
          {module.activeStationId ? t('app.liveBadge') : t('common.resume')}
        </div>
      </div>

      <div className="home-horizontal-scroll home-resume-list">
        {module.stations.slice(0, dense ? 4 : module.stations.length).map((station) => (
          <HomeStationTile
            key={station.stationuuid}
            station={station}
            playlist={module.stations}
            sourceId="home-resume"
            tone="resume"
            dense={dense}
            isActive={currentStationId === station.stationuuid}
            activeTrack={currentStationId === station.stationuuid ? activeTrack : null}
            liked={isFavorite(station.stationuuid)}
            onPlay={onPlay}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
      </div>
    </section>
  );
};

type HomeRailProps = {
  module: HomeRailModule;
  dense?: boolean;
  variant?: 'default' | 'featured-lead' | 'logo-strip';
  currentStationId: string | null;
  activeTrack: string | null;
  isFavorite: (stationId: string) => boolean;
  onPlay: PlayHandler;
  onToggleFavorite: ToggleFavoriteHandler;
  onExplore: ExploreHandler;
};

export const HomeRail = ({
  module,
  dense = false,
  variant = 'default',
  currentStationId,
  activeTrack,
  isFavorite,
  onPlay,
  onToggleFavorite,
  onExplore
}: HomeRailProps) => {
  const { t } = useLocale();
  const railRef = useRef<HTMLDivElement | null>(null);
  const visibleStations = module.stations.slice(0, dense ? 6 : module.stations.length);
  const scrollRail = (direction: -1 | 1) => {
    const node = railRef.current;
    if (!node) return;
    node.scrollBy({
      left: direction * Math.max(node.clientWidth * 0.72, 220),
      behavior: 'smooth'
    });
  };
  // React's onWheel is passive by default — preventDefault no-ops
  // there. Attach via addEventListener with { passive: false } so
  // the page stops scrolling vertically while the user converts a
  // wheel into rail scroll.
  useEffect(() => {
    const node = railRef.current;
    if (!node) return;
    const handler = (event: globalThis.WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (node.scrollWidth <= node.clientWidth) return;
      const maxScrollLeft = node.scrollWidth - node.clientWidth;
      const nextScrollLeft = Math.min(
        maxScrollLeft,
        Math.max(0, node.scrollLeft + event.deltaY)
      );
      if (nextScrollLeft === node.scrollLeft) return;
      event.preventDefault();
      node.scrollLeft = nextScrollLeft;
    };
    node.addEventListener('wheel', handler, { passive: false });
    return () => node.removeEventListener('wheel', handler);
  }, []);
  const showScrollControls = visibleStations.length > (dense ? 3 : 4);
  const scrollButtonIcon = (direction: -1 | 1) => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={direction < 0 ? 'M15.7 5.3 9 12l6.7 6.7-1.4 1.4L6.2 12l8.1-8.1z' : 'M8.3 18.7 15 12 8.3 5.3l1.4-1.4 8.1 8.1-8.1 8.1z'} />
    </svg>
  );

  return (
    <section
      id={`home-rail-${module.id}`}
      className={`home-rail-card ${dense ? 'is-dense' : ''} ${variant === 'logo-strip' ? 'home-rail--logo-strip' : ''}`.trim()}
      data-home-rail={module.id}
      data-home-rail-variant={variant === 'default' ? undefined : variant}
    >
      <div className="home-section-head">
        <div>
          <div className="home-section-title">{t(module.titleKey)}</div>
          <div className="home-section-copy">{t(module.copyKey)}</div>
        </div>
        {module.label ? (
          <button
            className="home-section-badge home-section-badge-action"
            type="button"
            onClick={() => onExplore(module.label || '')}
          >
            {module.label}
          </button>
        ) : null}
        {showScrollControls ? (
          <div className="home-rail-scroll-controls">
            <button
              className="home-rail-scroll-btn"
              type="button"
              aria-label={t('common.back')}
              onClick={() => scrollRail(-1)}
            >
              {scrollButtonIcon(-1)}
            </button>
            <button
              className="home-rail-scroll-btn"
              type="button"
              aria-label={t('common.next')}
              onClick={() => scrollRail(1)}
            >
              {scrollButtonIcon(1)}
            </button>
          </div>
        ) : null}
      </div>

      <div
        className="home-horizontal-scroll home-rail-list"
        ref={railRef}
      >
        {visibleStations.map((station, index) => (
          <HomeStationTile
            key={station.stationuuid}
            station={station}
            playlist={module.stations}
            sourceId={module.sourceId}
            tone="rail"
            dense={dense}
            isActive={currentStationId === station.stationuuid}
            activeTrack={currentStationId === station.stationuuid ? activeTrack : null}
            liked={isFavorite(station.stationuuid)}
            featured={variant === 'featured-lead' && index === 0 && !dense}
            logoOnly={variant === 'logo-strip'}
            onPlay={onPlay}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
      </div>
    </section>
  );
};

type HomeSearchPreviewProps = {
  dense?: boolean;
  query: string;
  stations: StationLite[];
  currentStationId: string | null;
  activeTrack: string | null;
  isFavorite: (stationId: string) => boolean;
  onPlay: PlayHandler;
  onToggleFavorite: ToggleFavoriteHandler;
};

export const HomeSearchPreview = ({
  dense = false,
  query,
  stations,
  currentStationId,
  activeTrack,
  isFavorite,
  onPlay,
  onToggleFavorite
}: HomeSearchPreviewProps) => {
  const { t } = useLocale();
  const hasQuery = Boolean(query.trim());

  if (!stations.length) {
    // Only render the placeholder when the user has typed something
    // and got no hits. In the cold-idle case the section header copy
    // ("Один запрос — и сразу короткая выдача") plus the chip row
    // already explain what to do — the second card just duplicated
    // the message and made the launcher feel cluttered.
    if (!hasQuery) return null;
    return (
      <div className={`home-search-idle ${dense ? 'is-dense' : ''}`.trim()}>
        <strong>{t('home.quickSearchNoResultsTitle')}</strong>
        <span>{t('home.quickSearchNoResultsCopy')}</span>
      </div>
    );
  }

  return (
    <div
      className={`home-search-preview ${dense ? 'is-dense' : ''}`.trim()}
      data-home-search-preview={query.trim()}
    >
      <div className="home-search-preview-list">
        {stations.map((station) => (
          <HomeStationTile
            key={station.stationuuid}
            station={station}
            playlist={stations}
            sourceId="home-search-preview"
            tone="search"
            dense={dense}
            isActive={currentStationId === station.stationuuid}
            activeTrack={currentStationId === station.stationuuid ? activeTrack : null}
            liked={isFavorite(station.stationuuid)}
            onPlay={onPlay}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
      </div>
    </div>
  );
};
