import { StationArtwork } from '../components/StationArtwork';
import type {
  HomeHeroModule,
  HomeRailModule,
  HomeResumeModule
} from '../lib/homeSurface';
import { stationLocation, stationTags } from '../lib/stationUtils';
import { useLocale } from '../state/LocaleContext';
import type { StationLite } from '../types';

type PlayHandler = (station: StationLite, playlist: StationLite[], sourceId: string) => void;
type ToggleFavoriteHandler = (station: StationLite) => void;
type ExploreHandler = (query: string) => void;

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
  onToggleFavorite
}: HomeStationTileProps) => {
  const { t } = useLocale();
  const caption = captionForStation(station, isActive, activeTrack, t);
  return (
    <article
      className={`home-station-tile home-station-tile-${tone} ${dense ? 'is-dense' : ''} ${isActive ? 'is-active' : ''}`.trim()}
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

type HomeHeroCardProps = {
  module: HomeHeroModule;
  dense?: boolean;
  metrics: {
    countries: number;
    languages: number;
    genres: number;
  };
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
  metrics,
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
  const station = module.station;
  const companionStations = dense ? module.companionStations.slice(0, 2) : module.companionStations;

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
          {module.label ? <span className="home-surface-label">{module.label}</span> : null}
        </div>
        <button
          className={`home-refresh-chip ${refreshing ? 'is-loading' : ''}`.trim()}
          type="button"
          onClick={onRefresh}
        >
          {refreshing ? t('common.loading') : t('home.refreshFeed')}
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
          <p className="home-hero-description">{t(module.copyKey)}</p>

          <div className="home-hero-trackline" data-active={isActive ? 'true' : 'false'}>
            <strong>{isActive && activeTrack ? activeTrack : stationTags(station)}</strong>
            <span>{isActive ? t('app.liveBadge') : t('home.heroExploreHint')}</span>
          </div>

          <div className="home-hero-actions">
            <button
              className="home-primary-btn"
              type="button"
              onClick={() => onPlay(station, [station, ...companionStations], module.sourceId)}
            >
              {isActive ? t('common.pause') : t('common.play')}
            </button>
            <button
              className="home-secondary-btn"
              type="button"
              onClick={() => onExplore(module.querySuggestion)}
            >
              {t('home.heroExploreAction')}
            </button>
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

      <div className="home-hero-metrics">
        <div className="home-metric-pill">
          <span>{t('home.catalogPulseCountries')}</span>
          <strong>{metrics.countries}</strong>
        </div>
        <div className="home-metric-pill">
          <span>{t('home.catalogPulseLanguages')}</span>
          <strong>{metrics.languages}</strong>
        </div>
        <div className="home-metric-pill">
          <span>{t('home.catalogPulseGenres')}</span>
          <strong>{metrics.genres}</strong>
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
          <div className="home-section-title">{t(module.titleKey)}</div>
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
  currentStationId,
  activeTrack,
  isFavorite,
  onPlay,
  onToggleFavorite,
  onExplore
}: HomeRailProps) => {
  const { t } = useLocale();

  return (
    <section
      className={`home-rail-card ${dense ? 'is-dense' : ''}`.trim()}
      data-home-rail={module.id}
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
      </div>

      <div className="home-horizontal-scroll home-rail-list">
        {module.stations.slice(0, dense ? 4 : module.stations.length).map((station) => (
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
  total: number;
  stations: StationLite[];
  currentStationId: string | null;
  activeTrack: string | null;
  isFavorite: (stationId: string) => boolean;
  onPlay: PlayHandler;
  onToggleFavorite: ToggleFavoriteHandler;
  onOpenSearch: (query: string) => void;
};

export const HomeSearchPreview = ({
  dense = false,
  query,
  total,
  stations,
  currentStationId,
  activeTrack,
  isFavorite,
  onPlay,
  onToggleFavorite,
  onOpenSearch
}: HomeSearchPreviewProps) => {
  const { t } = useLocale();
  const hasQuery = Boolean(query.trim());

  if (!stations.length) {
    return (
      <div className={`home-search-idle ${dense ? 'is-dense' : ''}`.trim()}>
        <strong>{t(hasQuery ? 'home.quickSearchNoResultsTitle' : 'home.quickSearchIdleTitle')}</strong>
        <span>{t(hasQuery ? 'home.quickSearchNoResultsCopy' : 'home.quickSearchIdleCopy')}</span>
      </div>
    );
  }

  return (
    <div
      className={`home-search-preview ${dense ? 'is-dense' : ''}`.trim()}
      data-home-search-preview={query.trim()}
    >
      <div className="home-search-preview-head">
        <span>{t('home.quickSearchResults')}</span>
        <button className="home-inline-link" type="button" onClick={() => onOpenSearch(query)}>
          {t('home.openFullSearch', { count: total })}
        </button>
      </div>
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
