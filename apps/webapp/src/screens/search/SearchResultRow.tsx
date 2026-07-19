import { memo, useMemo } from 'react';
import { StationArtwork } from '../../components/StationArtwork';
import { StationStatusBadge } from '../../components/StationStatusBadge';
import { getStationBadgeState } from '../../lib/stationStatusBadge';
import { normalizeStationName, stationLocation, stationTags } from '../../lib/stationUtils';
import { useLibrary, usePlayback } from '../../state/RadioContext';
import { useLocale } from '../../state/LocaleContext';
import type { StationLite } from '../../types';
import { useSearchNowPlaying } from './useSearchNowPlaying';

type SearchResultRowProps = {
  station: StationLite;
  stations: StationLite[];
  sourceId: string;
  /** Per-visible-row metadata resolution. Off for the idle/no-results paths. */
  nowPlayingEnabled: boolean;
};

const SearchResultRowInner = ({
  station,
  stations,
  sourceId,
  nowPlayingEnabled
}: SearchResultRowProps) => {
  const { t } = useLocale();
  const { playStation, player, shareStation } = usePlayback();
  const { toggleFavorite, isFavorite, playabilityProfile, stationHealthProfile } = useLibrary();

  const active = player.current?.stationuuid === station.stationuuid;
  // "Audible" — not merely selected. The LIVE dot means «you are hearing this
  // right now», so a paused active row must not claim it.
  const isAudible = active && player.isPlaying;
  const liked = isFavorite(station.stationuuid);

  const { rowRef, track } = useSearchNowPlaying(station, nowPlayingEnabled);

  // Phase B-PR2: broken stations are shown in search (demoted, not hidden) —
  // the shared 🚫/⚠ corner badge tells the user before they tap.
  const badge = useMemo(
    () =>
      getStationBadgeState(station, {
        healthProfile: stationHealthProfile,
        playabilityProfile
      }),
    [playabilityProfile, station, stationHealthProfile]
  );

  const name = useMemo(() => normalizeStationName(station.name), [station.name]);
  // Anti-fabrication: pass '' as the fallback and test for truthiness, so an
  // unknown location omits the element instead of rendering «Неизвестно».
  const location = useMemo(() => stationLocation(station, ''), [station]);
  const tags = useMemo(() => stationTags(station, ''), [station]);
  const bitrate = station.bitrate || 0;

  const playLabel = isAudible ? t('common.pause') : t('common.play');

  const toggleStation = () => {
    if (active) {
      void player.toggle();
      return;
    }
    playStation(station, {
      playlist: stations,
      sourceId,
      sourceLabel: t('radio.searchResults')
    });
  };

  return (
    <article
      ref={rowRef}
      className={`search-station-card station-row ${active ? 'active' : ''}`}
      data-search-station-card
      data-station-id={station.stationuuid}
    >
      <div className="search-station-card-media">
        <StationArtwork station={station} size="card" />
      </div>

      <div className="search-station-card-copy">
        <div className="search-card-title" title={name}>
          <StationStatusBadge state={badge} />
          {name}
        </div>

        {location ? (
          <div className="search-card-meta" title={location}>
            {location}
          </div>
        ) : null}

        {/* LINE 3 — exactly one slot. A resolved track SUPERSEDES the genre
            line rather than adding to it. The track arrives asynchronously, so
            an extra line would shift every row below it mid-scroll, and
            reserving height for it is precisely the placeholder the
            anti-fabrication rule forbids. Same trick StationTable already uses
            (`showTagline = compact && compactTags && !displayTrack`). Result:
            constant row height, zero layout shift, no skeleton. */}
        {track ? (
          <div className="search-card-track" title={track}>
            ♪ {track}
          </div>
        ) : tags ? (
          <div className="search-card-tags" title={tags}>
            {tags}
          </div>
        ) : null}

        <div className="search-card-metrics">
          {/* Every station in the catalog is a live stream, so a LIVE dot on
              all 124 rows is tautological at best. It renders ONLY on the row
              that is audibly playing, where "live" carries real information.
              aria-hidden: the play button's «Пауза: X» label already conveys
              this to assistive tech; a second announcement is noise. */}
          {isAudible ? (
            <span className="search-card-live" aria-hidden="true">
              <i />
              {t('search.liveNow')}
            </span>
          ) : null}

          {/* ←──── FUTURE listeners count slots in HERE, between LIVE and
                   bitrate: <span className="search-card-listeners">2.3K</span>
                   One conditional span, one locale key, one CSS rule. The line
                   already exists and is already sized for its tallest child, so
                   adding it costs no layout rework and no row-height change.
                   Nothing renders here today — RadioAtlas has no listener data,
                   and votes/clickcount are NOT a listener count. ────→ */}

          {bitrate ? <span className="search-card-bitrate">{bitrate} kbps</span> : null}

          <button
            className="icon-btn search-card-share"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void shareStation(station);
            }}
            aria-label={t('common.share')}
            title={t('common.share')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Pointer-only convenience layer. It used to carry the SAME aria-label as
          the play button, so every row announced "Играть: X" twice. Now that the
          play orb is always visible (it was display:none ≤430px), this overlay
          is demoted out of the a11y tree; the accessible equivalent sits in the
          same row. The class stays — two specs click it directly. */}
      <button
        className="search-station-card-primary-action"
        type="button"
        onClick={toggleStation}
        aria-hidden="true"
        tabIndex={-1}
      />

      <div className="search-card-actions">
        <button
          className={`icon-btn search-card-fav search-card-orb ${liked ? 'active' : ''}`}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            toggleFavorite(station);
          }}
          aria-label={liked ? t('stationTable.unfavorite') : t('stationTable.favorite')}
          aria-pressed={liked}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 21.2l-1.4-1.3C5.4 15.4 2 12.3 2 8.4 2 5.6 4.2 3.5 7 3.5c1.6 0 3.2.7 4.2 2 1-1.3 2.6-2 4.2-2 2.8 0 5 2.1 5 4.9 0 3.9-3.4 7-8.6 11.4L12 21.2z" />
          </svg>
        </button>
        <button
          className="play-btn search-card-play search-card-orb"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            toggleStation();
          }}
          data-playing={isAudible ? 'true' : 'false'}
          aria-label={`${playLabel}: ${name}`}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {isAudible ? <path d="M7 5h4v14H7zm6 0h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}
          </svg>
        </button>
      </div>
    </article>
  );
};

/**
 * Memoized so a metadata tick for station X does not re-render Y and Z.
 *
 * Honest limit, recorded rather than papered over: this row calls usePlayback()
 * and useLibrary() directly, so any play/pause still re-renders every mounted
 * row regardless of memo. Lifting those into parent-computed slices (the
 * StationTable T2.11a treatment) is a separate change; what memo buys here —
 * and what actually matters for this feature — is per-row metadata isolation.
 */
export const SearchResultRow = memo(SearchResultRowInner);
SearchResultRow.displayName = 'SearchResultRow';
