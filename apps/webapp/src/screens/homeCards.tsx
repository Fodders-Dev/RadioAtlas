import { useEffect, useRef, type CSSProperties } from 'react';
import { StationArtwork } from '../components/StationArtwork';
import { StationScene } from '../components/StationScene';
import type {
  HomeHeroModule,
  HomeRailModule,
  HomeResumeModule
} from '../lib/homeSurface';
import { normalizeStationName, stationLocation, stationTags } from '../lib/stationUtils';
import { useCompactLayout } from '../lib/useCompactLayout';
import { useLocale } from '../state/LocaleContext';
import { useLibrary } from '../state/RadioContext';
import { getStationBadgeState } from '../lib/stationStatusBadge';
import { StationStatusBadge } from '../components/StationStatusBadge';
import type { StationLite } from '../types';
import type { VisualizerFrame } from '../lib/useAudioPlayer';

type VisualizerSubscribe = (callback: (frame: VisualizerFrame) => void) => () => void;

// The hero "equalizer" bars react to the REAL audio spectrum while this station
// is on air: it subscribes to the shared audio-pump (the same analyser the full
// player uses) and writes each bar's live level through `--ra-level` via direct
// DOM (no React state per frame). When the hero station isn't the one playing —
// or the stream produces no readable analyser data — it hands back to the CSS
// idle bounce (data-live='false').
const HomeHeroEqualizer = ({
  active,
  subscribe
}: {
  active: boolean;
  subscribe?: VisualizerSubscribe;
}) => {
  const barsRef = useRef<Array<HTMLSpanElement | null>>([]);
  const levelsRef = useRef<number[]>([]);

  useEffect(() => {
    if (!active || !subscribe) return undefined;
    const levels = levelsRef.current;
    const unsubscribe = subscribe((frame) => {
      const bars = barsRef.current;
      const { spectrum } = frame;
      for (let index = 0; index < bars.length; index += 1) {
        const bar = bars[index];
        if (!bar) continue;
        const bin = Math.floor((index * spectrum.length) / bars.length);
        const target = Math.min(1, spectrum[bin] ?? 0);
        const prev = levels[index] ?? 0;
        // Fast attack, gentle release — the bars pop on transients and fall back
        // smoothly, so a heavily-smoothed analyser still reads as a lively meter.
        const next = target >= prev ? target : prev * 0.82 + target * 0.18;
        levels[index] = next;
        bar.style.setProperty('--ra-level', Math.max(0.06, next).toFixed(3));
      }
    });
    return () => {
      unsubscribe();
      for (const bar of barsRef.current) bar?.style.removeProperty('--ra-level');
    };
  }, [active, subscribe]);

  return (
    <div
      className="home-hero-waveform"
      data-live={active ? 'true' : 'false'}
      aria-hidden="true"
    >
      {HERO_WAVEFORM_BARS.map((bar, index) => (
        <span
          key={bar.key}
          style={bar.style}
          ref={(element) => {
            barsRef.current[index] = element;
          }}
        />
      ))}
    </div>
  );
};

type PlayHandler = (station: StationLite, playlist: StationLite[], sourceId: string) => void;
type ToggleFavoriteHandler = (station: StationLite) => void;
type ExploreHandler = (query: string) => void;

const HERO_WAVEFORM_BARS = [
  9, 19, 13, 27, 16, 32, 11, 24, 38, 17, 29, 12, 21, 34, 14, 25, 10, 22, 31, 15, 26, 12, 35, 18,
  28, 13, 23, 16
].map(
  (height, index) => ({
    key: `${height}-${index}`,
    style: { '--wave-height': `${height}px` } as CSSProperties
  })
);

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

const HomeStationTile = ({
  station,
  playlist,
  sourceId,
  tone,
  dense = false,
  isActive,
  onPlay,
  featured = false,
  logoOnly = false
}: HomeStationTileProps) => {
  const { t } = useLocale();
  const { playabilityProfile, stationHealthProfile } = useLibrary();
  // Phase B-PR2: a broken station that survives into a rail (demoted, not
  // dropped) shows the shared 🚫/⚠ badge instead of looking healthy. Computed
  // inline (the tile is not memoised, so this adds no re-render cost).
  const badge = getStationBadgeState(station, {
    healthProfile: stationHealthProfile,
    playabilityProfile
  });

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
          aria-label={`${isActive ? t('common.pause') : t('common.play')}: ${normalizeStationName(station.name)}`}
        >
          <StationArtwork station={station} size="card" className="home-station-artwork" />
          <span className="visually-hidden">{normalizeStationName(station.name)}</span>
        </button>
      </article>
    );
  }

  // The whole tile remains a generous play target, but the hit area is now a
  // real sibling <button>. The previous article[role=button] wrapped Play/Like
  // buttons, which created nested interactive controls and let keyboard events
  // from the heart bubble into playback.
  const playStation = () => onPlay(station, playlist, sourceId);

  return (
    <article
      className={`home-station-tile home-station-tile-${tone} ${dense ? 'is-dense' : ''} ${isActive ? 'is-active' : ''} ${featured ? 'home-station-tile--featured' : ''}`.trim()}
      data-home-station={station.stationuuid}
    >
      {/* Reference cards are scene-first: the generated country+vibe scene fills
          the card and fails soft to a deterministic procedural gradient — never
          the raw station logo, which is frequently a generic placeholder. Name +
          location overlay the bottom; the whole tile is the play target. */}
      <StationScene station={station} className="home-station-scene" priority={featured} />
      <span className="home-station-scrim" aria-hidden="true" />
      {/* Owner ask: show the station's own emblem ON TOP of the generated scene —
          "симбиоз" between the two — for the stations that actually have one.
          StationArtwork already resolves stationArtwork → favicon → generated
          initial and reports which it used via data-has-image, so the CSS hides
          this badge whenever there is no real logo (or the URL turns out to be
          broken at runtime). No placeholder letters on the cards. */}
      <StationArtwork station={station} size="sm" className="home-station-logo" />
      <button
        className="home-station-primary-action"
        type="button"
        onClick={playStation}
        aria-label={t(isActive ? 'common.pause' : 'stationTile.playLabel', {
          name: normalizeStationName(station.name)
        })}
      />
      <div className="home-station-overlay">
        <div className="home-station-copy">
          <div className="home-station-title" title={normalizeStationName(station.name)}>
            <StationStatusBadge state={badge} />
            {normalizeStationName(station.name)}
          </div>
          <div className="home-station-meta" title={stationLocation(station)}>
            {stationLocation(station)}
          </div>
        </div>
      </div>
      <div className="home-station-actions">
        <span className="home-action-btn home-action-btn-play" aria-hidden="true">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {isActive ? (
              <path d="M7 5h4v14H7zm6 0h4v14h-4z" />
            ) : (
              <path d="M8 5v14l11-7z" />
            )}
          </svg>
        </span>
      </div>
    </article>
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
  // Real-audio equalizer: the shared pump subscribe + whether the analyser is
  // currently producing data for the on-air station.
  subscribeVisualizer?: VisualizerSubscribe;
  visualizerActive?: boolean;
  // True when the hero is showing the LOADED station rather than the frozen
  // recommendation (owner ask #1). Survives pause: the card must not flip back
  // to a recommendation every time the user hits pause.
  nowPlaying?: boolean;
  // True only while that station is actually producing audio. Splits the honest
  // claims («Сейчас играет», the LIVE dot) from mere identity — a paused or
  // errored station keeps `nowPlaying` but loses `onAir`.
  onAir?: boolean;
  // The FROZEN recommended station id, surfaced as a data attribute even while
  // the on-air override is rendered. The rank-freeze e2e asserts on this: the
  // rendered hero may follow playback, but the recommendation deck must never
  // advance under the user's finger.
  recommendedStationId?: string | null;
  // NOTE: the pull-to-expand gesture used to arrive here as four pointer props.
  // It is now bound once on the Home screen root and hit-tested against
  // `.home-hero-card, .home-feed-hero` (see useHeroPullToExpand) — the hero does
  // not participate, which is also what makes the sibling grabber handle
  // draggable at all.
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
  onRefresh,
  subscribeVisualizer,
  visualizerActive = false,
  nowPlaying = false,
  onAir = false,
  recommendedStationId = null
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

  const stationName = normalizeStationName(station.name);
  const longStationName = Array.from(stationName).length > 24;
  // Only a REAL now-playing track (when this station is the one on air). No
  // "Подборка на сейчас — обнови" filler: the hero should read like the
  // reference — station · location · genre, and the live track once it plays.
  const heroTrack = isActive ? activeTrack : null;
  // Reference genre line: «J-Pop • News • Talk» — at most three tags, Title
  // Case, bullet-separated. Raw tags arrive as one lowercase run («club dance
  // electronic house trance») or ·-joined; split on both and prettify.
  const heroGenre = (() => {
    const raw = stationTags(station);
    if (!raw) return stationLocation(station);
    const parts = raw
      .split(/·|,/)
      .flatMap((chunk) => (chunk.trim().length > 18 ? chunk.trim().split(/\s+/) : [chunk.trim()]))
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 3)
      .map((tag) => tag.replace(/(^|[\s-])(\p{L})/gu, (m) => m.toUpperCase()));
    return parts.join(' • ');
  })();

  return (
    <section
      className={`home-hero-card ${dense ? 'is-dense' : ''}`.trim()}
      data-home-hero={station.stationuuid}
      data-home-hero-mode={nowPlaying ? 'now-playing' : 'recommendation'}
      data-home-hero-recommended={recommendedStationId ?? undefined}
      data-home-hero-air={nowPlaying ? (onAir ? 'playing' : 'paused') : 'idle'}
    >
      <div className="home-hero-topline">
        <div className="home-hero-eyebrow">
          <span className="home-surface-kicker">
            {t(
              nowPlaying
                ? onAir
                  ? 'home.heroKickerNowPlaying'
                  : 'home.heroKickerPaused'
                : 'home.heroKicker'
            )}
          </span>
          {moduleLabel ? <span className="home-surface-label">{moduleLabel}</span> : null}
          {/* The LIVE dot used to render unconditionally — it claimed "LIVE" over
              a mere recommendation with nothing playing. It now means what it
              says: this station is on air RIGHT NOW, which is why it hangs off
              `onAir` and not off `nowPlaying` (that one survives pause). */}
          {onAir ? (
            <span className="home-hero-live-dot">
              <span aria-hidden="true" />
              {t('app.liveBadge')}
            </span>
          ) : null}
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

      <StationScene station={station} className="home-hero-scene" priority />
      <div className="home-hero-scrim" aria-hidden="true" />

      <div className="home-hero-body">
        <div className="home-hero-copy">
          <StationArtwork
            station={station}
            size="sm"
            className="home-hero-station-logo"
            priority
          />
          <h2
            className={`home-hero-title ${longStationName ? 'is-long' : ''}`.trim()}
            title={stationName}
          >
            {stationName}
          </h2>
          <div className="home-hero-subtitle">{stationLocation(station)}</div>
          <div className="home-hero-tags">{heroGenre}</div>

          {heroTrack ? (
            <div className="home-hero-trackline">
              <strong>{heroTrack}</strong>
            </div>
          ) : null}

          <HomeHeroEqualizer
            active={visualizerActive}
            subscribe={subscribeVisualizer}
          />

          <div className="home-hero-secondary-actions">
            {/* Reference hero is clean — only play + favorite. The «изучить рядом»
                explore CTA was removed; discovery lives in the rails below. */}
            <button
              className={`home-icon-btn ${liked ? 'is-liked' : ''}`.trim()}
              type="button"
              onClick={() => onToggleFavorite(station)}
              aria-label={liked ? t('stationTable.unfavorite') : t('stationTable.favorite')}
              aria-pressed={liked}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 21.2l-1.4-1.3C5.4 15.4 2 12.3 2 8.4 2 5.6 4.2 3.5 7 3.5c1.6 0 3.2.7 4.2 2 1-1.3 2.6-2 4.2-2 2.8 0 5 2.1 5 4.9 0 3.9-3.4 7-8.6 11.4L12 21.2z" />
              </svg>
            </button>
          </div>
        </div>

        <div className="home-hero-play-zone">
          <div className="home-hero-poster" aria-hidden="true">
            <div className="home-hero-poster-glow" />
          </div>
          <div className="home-hero-actions">
            <button
              className="home-primary-btn home-hero-play"
              type="button"
              onClick={() => onPlay(station, [station, ...companionStations], module.sourceId)}
              aria-label={`${isActive ? t('common.pause') : t('common.play')}: ${stationName}`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {isActive ? (
                  <path d="M7 5h4v14H7zm6 0h4v14h-4z" />
                ) : (
                  <path d="M8 5v14l11-7z" />
                )}
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
              <span>{normalizeStationName(companion.name)}</span>
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
  onExplore?: ExploreHandler;
};

export const HomeResumeStrip = ({
  module,
  dense = false,
  currentStationId,
  activeTrack,
  isFavorite,
  onPlay,
  onToggleFavorite,
  onExplore
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
            {t('home.continueListeningTitle')}
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
        <button
          className="home-section-see-all"
          type="button"
          onClick={() => onExplore?.('')}
        >
          {t('home.seeAll')}
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 5l1.4-1.4L18.8 12l-8.4 8.4L9 19l7-7-7-7Z" />
          </svg>
        </button>
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
        <button
          className="home-section-see-all"
          type="button"
          onClick={() => onExplore?.('')}
        >
          {t('home.seeAll')}
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 5l1.4-1.4L18.8 12l-8.4 8.4L9 19l7-7-7-7Z" />
          </svg>
        </button>
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
            // PR-5: the artwork-only logo strip stays a desktop "fast-scan" lane;
            // on mobile top-voted renders full cards so name + location are
            // readable (owner's discovery-rail spec).
            logoOnly={variant === 'logo-strip' && !dense}
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
