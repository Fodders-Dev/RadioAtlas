import { useEffect, useMemo, useRef } from 'react';
import type { StationLite } from '../types';
import { normalizeStationName, stationLocation } from '../lib/stationUtils';
import { resolveNowPlayingLine } from '../lib/nowPlayingLine';
import { resolveNowPlayingTrust } from '../lib/trackTrust';
import { triggerHaptic } from '../lib/telegram';
import { latestTrackForStation } from '../state/radio/helpers';
import { useLocale } from '../state/LocaleContext';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import { StationArtwork } from './StationArtwork';
import './AirBlock.css';
import '../screens/homeAir2.css';

/**
 * The redesigned block at the top of Home — the first slice of the new look,
 * wired to the real player rather than to a mock.
 *
 * It exists to answer one question the prototype could not: does the app
 * actually KNOW when sound is happening? Seven hand-set states in an HTML page
 * only prove that a mock renders `sound=true/false` correctly. Here the state
 * comes from `player.status`, and the largest line comes from the same ladder
 * the dock and the full player use.
 *
 * ⚠ The honesty rule, in one place: «В эфире», the pulsing dot and an enabled
 * «Сохранить трек» are gated on things that are TRUE, never on the presence of
 * a station. `player.status === 'playing'` means audio is being produced;
 * `trust.track` means the station named the track and the name survived the
 * trust filter. Nothing here may say live because a station is merely selected
 * — that is defect (1)–(5) in docs/UI-MIGRATION-MAP.md §8, and this component
 * is where the new design either repeats them or does not.
 *
 * ⚠ Deliberate duplication, with a deadline: the ladder derivation below is a
 * SECOND copy of what MiniPlayerDock already does. Two copies is exactly how
 * Home and Лента drifted onto raw `nowPlaying` while the dock used the ladder.
 * This copy is acceptable only while the block is behind `?air2=1`; the moment
 * it replaces the hero for real, both must move to one shared hook.
 */
export const AirBlock = ({
  offerStation,
  onPlayStation
}: {
  /** What to offer when nothing has been chosen yet — Home's own hero pick. */
  offerStation: StationLite | null;
  onPlayStation: (station: StationLite) => void;
}) => {
  const { t } = useLocale();
  const {
    player,
    queue,
    nowPlaying,
    nowPlayingStatus,
    playStation,
    playNext,
    copyTrack
  } = usePlayback();
  const { trackHistory, isFavorite, toggleFavorite } = useLibrary();
  const { setPlayerPresentation } = useShell();
  const blockRef = useRef<HTMLElement | null>(null);

  // While this block is on screen it IS the player, so the dock must not be a
  // second one beside it — that is the «two players» the design removed. When
  // the block scrolls away the dock comes back, which is the compact player the
  // prototype shows. Flag-scoped: the attribute only ever exists under ?air2=1.
  useEffect(() => {
    const node = blockRef.current;
    const root = document.documentElement;
    if (!node) {
      delete root.dataset.airVisible;
      return undefined;
    }
    // The whole flagged look keys off this attribute, so it is written by the
    // one component that only exists under ?air2=1.
    root.dataset.air2 = '1';
    const observer = new IntersectionObserver(
      ([entry]) => {
        root.dataset.airVisible = entry.isIntersecting ? '1' : '0';
      },
      { threshold: 0.35 }
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      delete root.dataset.airVisible;
      delete root.dataset.air2;
    };
    // ⚠ Empty deps on purpose. Without them this ran on EVERY render, and each
    // render's cleanup deleted the two attributes the flagged look hangs on —
    // the dock reappeared beside the block because `data-air-visible` was gone
    // between the observer's callback and the next teardown.
  }, []);

  // The station this block is ABOUT: on air, or the one being connected to.
  // `pending` matters — without it the block would empty itself for the whole
  // of a station change, which is the defect 0.1b.1 closed in the dock.
  const current = player.current ?? player.pending;
  const station = current ?? offerStation;

  const trust = resolveNowPlayingTrust({
    station: current,
    track: nowPlaying,
    metadataStatus: nowPlayingStatus,
    playerStatus: player.status,
    failure: player.failure
  });
  const activeTrack = trust.track || '';
  const lastHeard = useMemo(
    () =>
      nowPlayingStatus === 'unavailable' && !trust.track && current
        ? latestTrackForStation(trackHistory, current.stationuuid)
        : null,
    [nowPlayingStatus, trust.track, current, trackHistory]
  );
  const line = useMemo(
    () => resolveNowPlayingLine({ station: current, track: activeTrack, lastHeard: lastHeard?.track }),
    [current, activeTrack, lastHeard?.track]
  );

  const mode = !current
    ? 'offer'
    : player.status === 'error'
      ? 'error'
      : player.status === 'buffering'
        ? 'connecting'
        : player.status === 'playing'
          ? 'playing'
          : player.status === 'paused'
            ? 'paused'
            : 'ready';

  // Sound is happening. Everything that claims liveness hangs off this one
  // boolean so a future edit cannot re-open the gap between them.
  const onAir = mode === 'playing';
  // A track exists only when the station named one AND it passed the filter.
  const hasTrack = onAir && Boolean(activeTrack);

  const stationName = normalizeStationName(station?.name) || '';
  const place = station ? stationLocation(station) : '';
  const genreText = line.kind === 'genre' ? t(`genre.${line.slug}`) : '';

  const eyebrow =
    mode === 'offer'
      ? t('air.eyebrowOffer')
      : mode === 'ready'
        ? t('air.eyebrowReady')
        : mode === 'connecting'
          ? t('air.eyebrowConnecting')
          : mode === 'error'
            ? t('air.eyebrowError')
            : mode === 'paused'
              ? t('air.eyebrowPaused')
              : t('air.eyebrowLive');

  // The big line. Only a playing station may show a track; everything else
  // shows the station, because that is what is true.
  const bigLine = !onAir
    ? stationName
    : line.kind === 'track'
      ? line.text
      : line.kind === 'lastHeard'
        ? line.text
        : line.kind === 'genre'
          ? genreText
          : t('dock.liveBroadcast');
  const subLine = !onAir
    ? place || genreText
    : line.kind === 'track' || line.kind === 'lastHeard'
      ? `${stationName}${place ? ` · ${place}` : ''}`
      : stationName;

  const liked = current ? isFavorite(current.stationuuid) : false;
  const queueCount = queue.items.length;
  const hasNext =
    queue.currentIndex >= 0 ? queue.currentIndex < queueCount - 1 : queueCount > 0;

  if (!station) return null;

  const play = () => {
    triggerHaptic('light');
    if (!current) {
      onPlayStation(station);
      return;
    }
    if (mode === 'error') {
      playStation(current);
      return;
    }
    player.toggle();
  };

  return (
    <section
      ref={blockRef}
      className="air-block"
      data-air-block="true"
      data-mode={mode}
      data-compact={mode === 'offer' ? 'true' : 'false'}
    >
      <div className="air-block-top">
        <span className="air-block-art">
          <StationArtwork station={station} size="card" className="air-block-artwork" />
          {current ? (
            <button
              type="button"
              className={`air-block-like ${liked ? 'is-on' : ''}`.trim()}
              aria-pressed={liked}
              aria-label={t(liked ? 'stationTable.unfavorite' : 'stationTable.favorite')}
              onClick={(event) => {
                event.stopPropagation();
                triggerHaptic('light');
                toggleFavorite(current);
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 20s-7-4.4-7-9.3A4.2 4.2 0 0 1 12 8a4.2 4.2 0 0 1 7 2.7C19 15.6 12 20 12 20z" />
              </svg>
            </button>
          ) : null}
          {/* The dot is liveness, so it exists only while audio is produced. */}
          {onAir ? <i className="air-block-live" aria-hidden="true" /> : null}
        </span>

        <span className="air-block-text">
          <span className="air-block-eyebrow" data-tone={onAir ? 'live' : mode === 'error' ? 'warn' : 'quiet'}>
            {mode === 'connecting' ? <span className="air-block-spin" aria-hidden="true" /> : null}
            {eyebrow}
          </span>
          <h2 className="air-block-title" data-last-heard={line.kind === 'lastHeard' && onAir ? 'true' : 'false'}>
            {bigLine}
          </h2>
          {subLine ? <span className="air-block-sub">{subLine}</span> : null}
        </span>

        {mode !== 'offer' ? (
          <span className="air-block-col">
            <button
              type="button"
              className="air-block-icon"
              aria-label={t('air.expand')}
              onClick={() => setPlayerPresentation('expanded')}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2" />
              </svg>
            </button>
          </span>
        ) : null}

        {mode === 'offer' ? (
          <button
            type="button"
            className="air-block-play is-small"
            aria-label={t('common.play')}
            onClick={play}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        ) : null}
      </div>

      {mode !== 'offer' ? (
        <div className={`air-block-ctl ${mode === 'error' ? 'has-wide' : ''}`.trim()}>
          <button
            type="button"
            className="air-block-pill"
            disabled={!hasTrack}
            aria-label={hasTrack ? t('dock.copyCurrentTrack') : t('air.saveTrackUnavailable')}
            onClick={() => {
              triggerHaptic('light');
              void copyTrack();
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 3h12v18l-6-4.5L6 21z" fill="none" stroke="currentColor" strokeWidth="1.95" />
            </svg>
            {t('air.saveTrack')}
          </button>

          {mode === 'error' ? (
            <button type="button" className="air-block-play is-wide" onClick={play}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5" fill="none" stroke="currentColor" strokeWidth="2.2" />
              </svg>
              {t('dock.retry')}
            </button>
          ) : (
            <button
              type="button"
              className="air-block-play"
              aria-label={t(onAir ? 'common.pause' : 'common.play')}
              onClick={play}
            >
              {mode === 'connecting' ? (
                <span className="air-block-ring" aria-hidden="true" />
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {onAir ? <path d="M7 5h4v14H7zm6 0h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}
                </svg>
              )}
            </button>
          )}

          {/* An empty queue is a normal state and says so. It does not silently
              become a different action — the feed is offered by its own handle
              directly below this block. */}
          <button
            type="button"
            className="air-block-pill"
            disabled={!hasNext}
            onClick={() => {
              triggerHaptic('light');
              playNext();
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d={hasNext ? 'M5 12h13M13 7l5 5-5 5' : 'M4 6h12M4 11h12M4 16h8'}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.95"
              />
            </svg>
            {t(hasNext ? 'air.nextStation' : 'air.queueEnd')}
          </button>
        </div>
      ) : null}
    </section>
  );
};
