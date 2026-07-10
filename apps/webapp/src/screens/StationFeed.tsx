import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { StationBackdrop } from '../components/StationBackdrop';
import { createAutoplaySettler, resolveFeedEntry } from '../lib/feedAutoplay';
import { createHomeRecommendationFeed } from '../lib/homeProfile';
import { buildStationFeed } from '../lib/stationFeed';
import {
  isStationHardHiddenByPlayability,
  isStationHardHiddenByUpstream
} from '../lib/stationPlayability';
import { isStationSuppressedByHealth } from '../lib/stationHealth';
import { rankStationsForUser, withFavoriteTasteBoosts } from '../lib/tasteProfile';
import { useDialog } from '../lib/useDialog';
import { useMobileLayout } from '../lib/useMobileLayout';
import { latestTrackForStation } from '../state/radio/helpers';
import { useCatalog } from '../state/CatalogContext';
import { useLocale } from '../state/LocaleContext';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import type { StationLite } from '../types';
import type { VisualizerFrame } from '../lib/useAudioPlayer';
import './stationFeed.css';

// Phase 2 — the vertical, one-station-per-screen "tik-tok" discovery feed. The
// card you settle on autoplays (a DELIBERATE swipe = a play request, so it never
// violates PR #86's never-auto-switch — that guards the MAIN player against
// UNREQUESTED switches, which this isn't). The pure pieces are unit-tested:
// buildStationFeed (the mix) and createAutoplaySettler (the settle debounce).

const FEED_SOURCE_ID = 'discovery-feed';
// A card is "landed" once ≥60% of it fills the viewport AND the scroll has gone
// quiet for the settle window — so a fast flick through five cards plays once,
// not five times (see feedAutoplay.test.ts).
const LANDING_RATIO = 0.6;
const SETTLE_MS = 220;
// Only ±2 cards around focus mount their heavy content (backdrop + cover image +
// — for the focused card only — the 30Hz audio subscription). Every card still
// renders a full-height spacer so scroll height and snap points stay correct.
const RENDER_WINDOW = 2;
const FEED_INITIAL_VISIBLE = 40;
const FEED_VISIBLE_BATCH = 40;
const FEED_PREFETCH_REMAINING = 6;
const FEED_MAX_ITEMS = 320;
const FEED_PERSONAL_POOL_LIMIT = 160;

const mergeUnique = (...collections: StationLite[][]): StationLite[] => {
  const seen = new Set<string>();
  const merged: StationLite[] = [];
  collections.forEach((items) => {
    items.forEach((station) => {
      const id = station?.stationuuid;
      if (!id || seen.has(id)) return;
      seen.add(id);
      merged.push(station);
    });
  });
  return merged;
};

const tagSummary = (station: StationLite): string =>
  (station.tags || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' · ');

type FeedCardProps = {
  station: StationLite;
  active: boolean;
  isCurrent: boolean;
  isLive: boolean;
  trackLine: string;
  favorite: boolean;
  subscribe: (callback: (frame: VisualizerFrame) => void) => () => void;
  onToggleFavorite: () => void;
  onEnqueue: () => void;
  onOpenPlayer: () => void;
  labels: {
    live: string;
    like: string;
    unlike: string;
    addToQueue: string;
    openPlayer: string;
  };
};

const HeartIcon = ({ filled }: { filled: boolean }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" data-filled={filled ? 'true' : 'false'}>
    <path d="M12 21s-7.2-4.6-9.6-9.05C.9 8.9 2.4 5.5 5.6 5.5c1.9 0 3.2 1.05 4.05 2.1.35.43 1.1.43 1.45 0C12 6.55 13.3 5.5 15.2 5.5c3.2 0 4.7 3.4 3.2 6.45C18 16.4 12 21 12 21Z" />
  </svg>
);

const QueueIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 6h12v2H3V6Zm0 5h12v2H3v-2Zm0 5h8v2H3v-2Zm15-7h2v4h4v2h-4v4h-2v-4h-4v-2h4V9Z" />
  </svg>
);

const ExpandIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M14 4h6v6h-2V7.4l-3.3 3.3-1.4-1.4L16.6 6H14V4ZM4 14h2v2.6l3.3-3.3 1.4 1.4L7.4 18H10v2H4v-6Z" />
  </svg>
);

const FeedCard = ({
  station,
  active,
  isCurrent,
  isLive,
  trackLine,
  favorite,
  subscribe,
  onToggleFavorite,
  onEnqueue,
  onOpenPlayer,
  labels
}: FeedCardProps) => {
  const tags = tagSummary(station);
  return (
    <div className="station-feed-card-content">
      <StationBackdrop station={station} active={active} subscribe={subscribe} />

      <div className="station-feed-card-actions">
        <button
          type="button"
          className={`station-feed-action ${favorite ? 'is-on' : ''}`.trim()}
          onClick={onToggleFavorite}
          aria-pressed={favorite}
          aria-label={favorite ? labels.unlike : labels.like}
        >
          <HeartIcon filled={favorite} />
        </button>
        <button
          type="button"
          className="station-feed-action"
          onClick={onEnqueue}
          aria-label={labels.addToQueue}
        >
          <QueueIcon />
        </button>
        <button
          type="button"
          className="station-feed-action"
          onClick={onOpenPlayer}
          aria-label={labels.openPlayer}
        >
          <ExpandIcon />
        </button>
      </div>

      <div className="station-feed-card-info">
        {isCurrent && isLive ? (
          <span className="station-feed-live">
            <span className="station-feed-live-dot" aria-hidden="true" />
            {labels.live}
          </span>
        ) : null}
        <h2 className="station-feed-card-name">{station.name}</h2>
        {trackLine ? <p className="station-feed-card-track">{trackLine}</p> : null}
        {(station.country || tags) ? (
          <p className="station-feed-card-meta">
            {[station.country, tags].filter(Boolean).join('  ·  ')}
          </p>
        ) : null}
      </div>
    </div>
  );
};

export const StationFeed = () => {
  const { t } = useLocale();
  const { summary } = useCatalog();
  const { player, playStation, queue, nowPlaying } = usePlayback();
  const {
    favorites,
    recent,
    playbackHistory,
    trackHistory,
    collections,
    followedStations,
    followedRegions,
    behaviorProfile,
    playabilityProfile,
    tasteProfile,
    stationHealthProfile,
    radioSessionEvents,
    stationExposure,
    recordStationsShown,
    toggleFavorite,
    isFavorite
  } = useLibrary();
  const { setActiveSection, feedSeed, winamp } = useShell();
  const isMobile = useMobileLayout();

  // The feed re-rolls on EVERY open: rerollFeedSeed runs from the «Лента» entry's
  // onClick, so each open mints a new seed → a fresh personal-fresh mix, while
  // Home's own sessionSeed (frozen per session) stays put.
  const seed = feedSeed;
  const effectiveTasteProfile = useMemo(
    () => withFavoriteTasteBoosts(tasteProfile, favorites),
    [favorites, tasteProfile]
  );

  // Build the feed ONCE per (catalog, seed): a list you can scroll without it
  // reshuffling underneath you. Volatile inputs (the playing station, favorites,
  // recent, a like you just tapped) are read at compute time but deliberately
  // kept OUT of the deps so a swipe-to-play or a like never reorders the list
  // mid-scroll — yet because `seed` changes per open, the NEXT open re-reads them
  // (so a station you just liked/played is freshly excluded next time).
  const feedStations = useMemo(() => {
    const pool = summary?.catalogPool ?? [];
    if (!pool.length) return [];
    const now = Date.now();
    // Liveness gate: drop anything broken/suppressed so the feed never autoplays
    // a dead stream on a swipe. Mirrors filterStationsByPlayability + the upstream
    // hard-hidden check used across discovery.
    const isLive = (candidate: StationLite) =>
      !isStationHardHiddenByPlayability(playabilityProfile, candidate, now) &&
      !isStationSuppressedByHealth(stationHealthProfile, candidate, now) &&
      !isStationHardHiddenByUpstream(candidate, now);
    // Freshness: drop what's already in the user's world so every card is new —
    // their favorites, recently-played stations, and the one playing right now.
    // (#86-safe: excluding the current station means the feed opens on card 0
    // without switching the player; resolveFeedEntry seeds it as already-played.)
    const exclude = new Set<string>();
    favorites.forEach((s) => exclude.add(s.stationuuid));
    recent.forEach((s) => exclude.add(s.stationuuid));
    if (player.current) exclude.add(player.current.stationuuid);

    const rankedCatalog = rankStationsForUser(pool, effectiveTasteProfile, playabilityProfile, {
      mode: 'personal',
      currentStation: null,
      seed,
      limit: pool.length,
      healthProfile: stationHealthProfile,
      sessionEvents: radioSessionEvents,
      exposure: stationExposure,
      now
    });
    const recommendation = createHomeRecommendationFeed({
      catalog: rankedCatalog,
      favorites,
      recent,
      queuePreview: queue.items,
      playbackHistory,
      trackHistory,
      collections,
      followedStations,
      followedRegions,
      behaviorProfile,
      currentStation: null,
      rotationSeed: seed,
      exposure: stationExposure,
      now
    });
    // Taste leads, strongest first (tunedForYou[0] becomes the pinned card 0).
    const tasteStations = mergeUnique(
      recommendation.tunedForYou,
      recommendation.becauseYouLiked,
      recommendation.outsideOrbit,
      rankedCatalog.slice(0, FEED_PERSONAL_POOL_LIMIT)
    );
    return buildStationFeed({
      tasteStations,
      trending: summary?.trending ?? [],
      pool: rankedCatalog,
      seed,
      limit: Math.min(FEED_MAX_ITEMS, rankedCatalog.length || FEED_MAX_ITEMS),
      exclude,
      isLive
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, seed]);

  const [visibleIndex, setVisibleIndex] = useState(0);
  const [visibleLimit, setVisibleLimit] = useState(FEED_INITIAL_VISIBLE);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  const kickstartedRef = useRef(false);
  const visibleFeedStations = useMemo(
    () => feedStations.slice(0, Math.min(visibleLimit, feedStations.length)),
    [feedStations, visibleLimit]
  );

  // Latest-value refs so the single (stable) settler reads the current list /
  // player without being torn down and recreated on every render.
  const feedRef = useRef(visibleFeedStations);
  feedRef.current = visibleFeedStations;
  const playStationRef = useRef(playStation);
  playStationRef.current = playStation;
  const currentIdRef = useRef(player.current?.stationuuid ?? null);
  currentIdRef.current = player.current?.stationuuid ?? null;
  const sourceLabel = t('feed.sourceLabel');
  const sourceLabelRef = useRef(sourceLabel);
  sourceLabelRef.current = sourceLabel;
  // Collect the ids of cards the user actually LANDS on (ref, no re-render), then
  // flush them once when the feed closes so the next open can softly demote them.
  // This is the cross-session «freshness» signal the feed lacked — cheap: zero
  // per-swipe state churn, one batched write on unmount.
  const shownIdsRef = useRef<Set<string>>(new Set());
  const recordShownRef = useRef(recordStationsShown);
  recordShownRef.current = recordStationsShown;

  const settler = useMemo(
    () =>
      createAutoplaySettler({
        settleMs: SETTLE_MS,
        onSettle: (index) => {
          const station = feedRef.current[index];
          if (!station) return;
          // Skip if this is ALREADY the current station — playing OR paused.
          // Landing back on the current card must never restart it (#86), and
          // this backstops the seedPlayed guard for the open-on-current case.
          if (currentIdRef.current === station.stationuuid) return;
          playStationRef.current(station, {
            playlist: feedRef.current,
            sourceId: FEED_SOURCE_ID,
            sourceLabel: sourceLabelRef.current
          });
        }
      }),
    []
  );

  // Tear down any pending play when the feed closes/unmounts.
  useEffect(() => () => settler.cancel(), [settler]);

  // Flush the "shown" impressions once on unmount (feed close), so the exposure
  // ledger demotes these stations on the next open. Read through refs so the
  // effect stays mount-once and never re-fires mid-scroll.
  useEffect(
    () => () => {
      const ids = Array.from(shownIdsRef.current);
      if (ids.length) recordShownRef.current(ids);
    },
    []
  );

  useEffect(() => {
    setVisibleLimit(FEED_INITIAL_VISIBLE);
    setVisibleIndex(0);
    cardRefs.current = [];
    kickstartedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  const handleClose = useCallback(() => {
    settler.cancel();
    setActiveSection('home');
  }, [settler, setActiveSection]);

  // Accessible modal: focus-trap + Escape-to-close + #root inerting + focus
  // restoration, the project's portal-overlay contract (FullPlayerOverlay /
  // Globe / Library). The scroll-snap pager is unaffected — useDialog only
  // governs Tab / Escape / inert.
  const rootRef = useRef<HTMLDivElement>(null);
  useDialog(rootRef, { isOpen: true, onClose: handleClose });

  // Kickstart: settle the OPENING card once the feed has content. The
  // IntersectionObserver's INITIAL callback can race with layout (report ratio 0
  // for a card that fills the viewport, then never re-fire on a static page), so
  // without this opening the feed wouldn't act. resolveFeedEntry enforces #86:
  // autoplay-on-open ONLY when nothing is currently loaded; if a station is
  // already current the feed opens ON its card (scrolled there) and is SEEDED as
  // already-played so neither this nor the observer's initial fire can switch the
  // persistent player — the first play must be a deliberate swipe to another card.
  useEffect(() => {
    if (kickstartedRef.current || visibleFeedStations.length === 0) return;
    kickstartedRef.current = true;
    const { index, autoplayInitial } = resolveFeedEntry(visibleFeedStations, currentIdRef.current);
    setVisibleIndex(index);
    if (autoplayInitial) {
      settler.notify(index);
      return;
    }
    settler.seedPlayed(index);
    const scroller = scrollerRef.current;
    if (scroller && index > 0) {
      scroller.scrollTop = index * scroller.clientHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleFeedStations, settler]);

  useEffect(() => {
    if (visibleFeedStations.length === 0) return;
    if (visibleLimit >= feedStations.length) return;
    if (visibleIndex < visibleFeedStations.length - FEED_PREFETCH_REMAINING) return;
    setVisibleLimit((current) => Math.min(feedStations.length, current + FEED_VISIBLE_BATCH));
  }, [feedStations.length, visibleFeedStations.length, visibleIndex, visibleLimit]);

  useEffect(() => {
    cardRefs.current = cardRefs.current.slice(0, visibleFeedStations.length);
  }, [visibleFeedStations.length]);

  // Track which card has "landed" (≥60% visible). The immediate signal drives the
  // ±2 render window; the SAME signal, debounced through the settler, drives the
  // autoplay so a fast swipe doesn't thrash playback.
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root || visibleFeedStations.length === 0) return undefined;
    const ratios = new Map<number, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const index = Number((entry.target as HTMLElement).dataset.feedIndex);
          if (Number.isNaN(index)) return;
          ratios.set(index, entry.intersectionRatio);
        });
        let landed = -1;
        let best = LANDING_RATIO;
        ratios.forEach((ratio, index) => {
          if (ratio >= best) {
            best = ratio;
            landed = index;
          }
        });
        if (landed >= 0) {
          setVisibleIndex(landed);
          settler.notify(landed);
          const landedId = feedRef.current[landed]?.stationuuid;
          if (landedId) shownIdsRef.current.add(landedId);
        }
      },
      { root, threshold: [0, 0.25, 0.5, 0.6, 0.75, 1] }
    );
    cardRefs.current.forEach((node) => node && observer.observe(node));
    return () => observer.disconnect();
  }, [visibleFeedStations, settler]);

  const handleOpenPlayer = (station: StationLite) => {
    if (player.current?.stationuuid !== station.stationuuid) {
      playStation(station, {
        playlist: visibleFeedStations,
        sourceId: FEED_SOURCE_ID,
        sourceLabel
      });
    }
    setActiveSection('home');
    winamp.setExpanded(true);
  };

  if (typeof document === 'undefined') return null;

  const labels = {
    live: t('feed.live'),
    like: t('feed.like'),
    unlike: t('feed.unlike'),
    addToQueue: t('feed.addToQueue'),
    openPlayer: t('feed.openPlayer')
  };

  const overlay = (
    <div
      ref={rootRef}
      className={`station-feed-overlay ${isMobile ? '' : 'station-feed-overlay--desktop'}`.trim()}
      role="dialog"
      aria-modal="true"
      aria-label={t('feed.title')}
    >
      <header className="station-feed-topbar">
        <button
          type="button"
          className="station-feed-close"
          onClick={handleClose}
          aria-label={t('feed.close')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6 6.4 5Z" />
          </svg>
        </button>
        <div className="station-feed-heading">
          <strong>{t('feed.title')}</strong>
          <span>{t('feed.tagline')}</span>
        </div>
      </header>

      <div ref={scrollerRef} className="station-feed-scroller">
        {visibleFeedStations.length === 0 ? (
          <div className="station-feed-empty">
            <strong>{summary ? t('feed.emptyTitle') : t('feed.loading')}</strong>
            {summary ? <p>{t('feed.emptyBody')}</p> : null}
          </div>
        ) : (
          visibleFeedStations.map((station, index) => {
            const windowed = Math.abs(index - visibleIndex) <= RENDER_WINDOW;
            const isCurrent = player.current?.stationuuid === station.stationuuid;
            const liveTrack = isCurrent && nowPlaying ? nowPlaying.trim() : '';
            const lastTrack = latestTrackForStation(trackHistory, station.stationuuid)?.track ?? '';
            return (
              <section
                key={station.stationuuid}
                className="station-feed-card"
                data-feed-index={index}
                aria-label={station.name}
                ref={(node) => {
                  cardRefs.current[index] = node;
                }}
              >
                {windowed ? (
                  <FeedCard
                    station={station}
                    active={index === visibleIndex}
                    isCurrent={isCurrent}
                    isLive={Boolean(liveTrack) || (isCurrent && player.isPlaying)}
                    trackLine={liveTrack || lastTrack}
                    favorite={isFavorite(station.stationuuid)}
                    subscribe={player.subscribeVisualizer}
                    onToggleFavorite={() => toggleFavorite(station)}
                    onEnqueue={() => queue.enqueue(station)}
                    onOpenPlayer={() => handleOpenPlayer(station)}
                    labels={labels}
                  />
                ) : null}
              </section>
            );
          })
        )}
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
};
