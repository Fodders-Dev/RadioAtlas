import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react';
import { createPortal } from 'react-dom';
import { FeedWaveform } from '../components/FeedWaveform';
import { StationBackdrop } from '../components/StationBackdrop';
import { createAutoplaySettler, resolveFeedEntry } from '../lib/feedAutoplay';
import { isFeedFilterAvailable, resolveFeedFilterSources, type FeedFilter } from '../lib/feedFilters';
import { createHomeRecommendationFeed } from '../lib/homeProfile';
import { formatCoordinatePair } from '../lib/localTime';
import { buildStationFeed, isFeedStationEligible } from '../lib/stationFeed';
import { normalizeStationName, stationLocation, stationTags } from '../lib/stationUtils';
import { prewarmStation } from '../lib/streamPrewarm';
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
import type { ResolvedCoords } from '../lib/geoResolver';
import { normalizeExposureLedger, type StationExposureLedger } from '../lib/stationExposure';
import type { StationLite } from '../types';
import type { VisualizerFrame } from '../lib/useAudioPlayer';
import './stationFeed.css';

// Phase 2 — the vertical, one-station-per-screen "tik-tok" discovery feed. The
// card you settle on autoplays (a DELIBERATE swipe = a play request, so it never
// violates PR #86's never-auto-switch — that guards the MAIN player against
// UNREQUESTED switches, which this isn't). The pure pieces are unit-tested:
// buildStationFeed (the mix), createAutoplaySettler (the settle debounce) and
// resolveFeedFilterSources (the filter chips).

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

// The geo line is the app's strictest honesty gate on this screen.
//
// `source === 'station'` means the coordinates are the STATION'S OWN and passed
// geoResolver's country-bbox sanity check. The other two sources —
// 'country-pool' and 'country-centroid' — are coordinates WE SYNTHESIZE so the
// Globe has a dot to draw. Printing their digits as "the station's coordinates"
// would be fabricated data, so they yield no line at all.
//
// ⚠ THERE IS DELIBERATELY NO LOCAL TIME HERE, and re-adding one needs a real
// timezone. The obvious implementation — lib/localTime's formatLocalTime, which
// the Globe still uses — is SOLAR time (lon / 15°): it knows nothing about
// political timezones or DST. Measured against the true IANA zones: Madrid was
// out by 2h15m AND on the wrong calendar day, Vladivostok by 1h12m, New York by
// 56m, London by 1h, Kashgar by ~3h. Printed next to a coordinate quoted
// verbatim to its stored precision, the exact datum lent the estimate authority
// it had not earned, and a "≈" cannot carry a three-hour error. This is the same
// rule that keeps the listener count off the card.
//
// A REAL clock is possible without a network call or a new dependency, but not
// from what the card has today: the browser ships the full IANA database via
// Intl.DateTimeFormat({ timeZone }), yet nothing here maps a POINT to a zone —
// Intl.supportedValuesOf('timeZone') only enumerates zone ids. The honest input
// would be the station's ISO country code through a countrycode→IANA table for
// single-zone countries (omitting the line for the rest, like every other
// optional line here) — and `countrycode` is not on StationLite (types.ts), only
// on the API's Station. Add the field end-to-end first, then the clock.

// PERF: geoResolve is NOT cheap on the miss path. When a station HAS stored
// coords that fail geoResolver's country-bbox sanity check (Radio Browser ships
// bogus lat/lon "fairly often", per that module), control falls through to
// ensureSamplePool — rejection sampling up to 2048 points with MAX_SAMPLE_TRIES
// 32000 — and this function then DISCARDS the result, because only
// source === 'station' yields a line. That was measured at 89–204ms of
// synchronous main-thread work on the first such station per country, on the
// render path, i.e. a dropped frame landing mid-swipe.
//
// The answer is immutable per station, so it is resolved at most once each.
const geoCoordsCache = new Map<string, ResolvedCoords | null>();
const resolveStationGeo = (
  station: StationLite,
  geoResolve: (station: StationLite) => ResolvedCoords | null
): ResolvedCoords | null => {
  const id = station.stationuuid;
  if (!id) return null;
  if (geoCoordsCache.has(id)) return geoCoordsCache.get(id) ?? null;
  const coords = geoResolve(station);
  const kept = coords?.source === 'station' ? coords : null;
  geoCoordsCache.set(id, kept);
  return kept;
};

// A station can only ever produce a geo line if it ships its own coordinates.
// Split out from resolveGeoLine so `data-lines` can be computed from this STABLE
// precondition instead of from the resolved line: the resolver arrives via a lazy
// import ~100ms after mount, so counting the resolved line made the station name
// jump a font-size step a beat after the card had already settled.
const canHaveGeoLine = (station: StationLite) =>
  station.geo_lat != null && station.geo_long != null;

const resolveGeoLine = (
  station: StationLite,
  geoResolve: ((station: StationLite) => ResolvedCoords | null) | null
): string | null => {
  // Stage 1 — synchronous, free, and a NECESSARY condition: no stored coords
  // means the resolver could only ever synthesize, so don't even load it.
  if (!canHaveGeoLine(station)) return null;
  if (!geoResolve) return null;
  const coords = resolveStationGeo(station, geoResolve);
  if (!coords) return null;
  return formatCoordinatePair(coords.lat, coords.lon);
};

type FeedCardProps = {
  station: StationLite;
  active: boolean;
  isCurrent: boolean;
  isPlaying: boolean;
  isLive: boolean;
  trackLine: string;
  geoLine: string | null;
  favorite: boolean;
  subscribe: (callback: (frame: VisualizerFrame) => void) => () => void;
  onTogglePlayback: () => void;
  onToggleFavorite: () => void;
  onEnqueue: () => void;
  onShare: () => void;
  onOpenPlayer: () => void;
  labels: {
    live: string;
    play: string;
    pause: string;
    like: string;
    unlike: string;
    addToQueue: string;
    share: string;
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

// Arrow leaving a box — the reference's share glyph.
const ShareIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M13 3h8v8h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H13V3ZM5 5h5v2H6v11h11v-4h2v6H5V5Z" />
  </svg>
);

const ExpandIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M14 4h6v6h-2V7.4l-3.3 3.3-1.4-1.4L16.6 6H14V4ZM4 14h2v2.6l3.3-3.3 1.4 1.4L7.4 18H10v2H4v-6Z" />
  </svg>
);

const SlidersIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 6h9v2H4V6Zm11 0h5v2h-5V6Zm-11 5h4v2H4v-2Zm6 0h10v2H10v-2ZM4 16h9v2H4v-2Zm11 0h5v2h-5v-2Z" />
    <path d="M13 4h2v6h-2V4ZM8 9h2v6H8V9Zm5 5h2v6h-2v-6Z" />
  </svg>
);

const PlayPauseIcon = ({ playing }: { playing: boolean }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {playing ? (
      <path d="M6.5 5h4v14h-4V5Zm7 0h4v14h-4V5Z" />
    ) : (
      <path d="M8 5v14l11-7L8 5Z" />
    )}
  </svg>
);

const FeedCard = ({
  station,
  active,
  isCurrent,
  isPlaying,
  isLive,
  trackLine,
  geoLine,
  favorite,
  subscribe,
  onTogglePlayback,
  onToggleFavorite,
  onEnqueue,
  onShare,
  onOpenPlayer,
  labels
}: FeedCardProps) => {
  // Every optional line is independently gated on real data, and the common case
  // is that several are missing. The stack is a flex column whose rhythm comes
  // entirely from `gap` (no per-line margins), so an absent line costs exactly
  // zero pixels; `data-lines` lets the name grow back into the space when the
  // station is sparse, which is what keeps a name-only card looking intentional
  // rather than empty.
  //
  // NOT RENDERED, deliberately: a listener count. votes / clicktrend /
  // clickcount live only on the API's CatalogStation and are dropped by
  // toStationLite's whitelist projection (apps/api/src/catalog/service.ts), so no
  // listener figure reaches the client for ANY station. There is no placeholder
  // and no estimate here on purpose — do not "fix" this without adding the field
  // end-to-end first.
  const place = stationLocation(station, '');
  const genres = stationTags(station, '');
  const railRef = useRef<HTMLDivElement>(null);

  // FOCUS HANDOFF — the other half of the #86 rail guard below.
  //
  // A card that stops being active hides its rail from assistive tech
  // (aria-hidden) and drops it out of the tab cycle (tabIndex -1). Neither
  // blurs an element that is ALREADY focused, so a user who focuses a rail
  // control and then swipes — a screen-reader user on touch, or anyone on
  // Telegram Desktop who focuses the heart and scrolls with the wheel — was
  // left with focus stranded inside an aria-hidden subtree painted at opacity 0
  // by the entrance rule: axe `aria-hidden-focus` (AT loses the focus location
  // entirely) plus WCAG 2.4.7 (no visible indicator). Tab "recovered" only by
  // teleporting to the ✕ button, because getFocusable skips tabIndex -1 and
  // indexOf returned -1.
  //
  // So hand focus to the SAME control on the card that just became active. The
  // DOM for the whole commit is in place before layout effects run, so the new
  // card's rail is already queryable and already marked data-focus="true".
  //
  // `preventScroll` is load-bearing for #86: focus() would otherwise scroll its
  // target into view, and a scroll is exactly what the pager reads as a play
  // request. The new card is already the landed one — nothing may move.
  useLayoutEffect(() => {
    if (active) return;
    const rail = railRef.current;
    if (!rail) return;
    const doc = rail.ownerDocument;
    const focused = doc.activeElement;
    if (!(focused instanceof HTMLElement) || !rail.contains(focused)) return;
    const name = focused.dataset.feedAction;
    const activeRail = doc.querySelector<HTMLElement>(
      '.station-feed-card-content[data-focus="true"] .station-feed-card-actions'
    );
    const replacement =
      (name ? activeRail?.querySelector<HTMLElement>(`[data-feed-action="${name}"]`) : null) ??
      activeRail?.querySelector<HTMLElement>('[data-feed-action="play"]') ??
      null;
    // Blurring is the floor, not a nicety: leaving focus where it is would
    // re-create exactly the violation this effect exists to close. Escape and
    // Tab both still work from <body> (lib/useDialog listens on the document).
    if (replacement) replacement.focus({ preventScroll: true });
    else focused.blur();
  }, [active]);

  // Counted from the geo PRECONDITION, not from the resolved `geoLine`: the
  // resolver lands via a lazy import ~100ms after mount, so counting the
  // resolved line would tick optionalLines 1 → 2 and drop the name a font-size
  // step (data-lines below) a beat AFTER the card had visibly settled. The
  // precondition is known synchronously from the station record.
  const optionalLines = [trackLine, place, genres].filter(Boolean).length +
    (active && canHaveGeoLine(station) ? 1 : 0);

  return (
    <div
      className="station-feed-card-content"
      data-focus={active ? 'true' : 'false'}
      data-playing={isPlaying ? 'true' : 'false'}
    >
      <StationBackdrop station={station} active={active} subscribe={subscribe} />
      <div className="station-feed-card-veil" aria-hidden="true" />

      {/* ⚠ #86 + a11y: ONLY THE ACTIVE CARD'S RAIL IS REACHABLE.
          The ±2 render window mounts the rail on peeking cards too, and those
          buttons used to sit in the dialog's Tab cycle. Tabbing onto one makes
          the browser scroll it into view → the pager's passive scroll handler →
          commitLandedIndex → settler.notify → playStation. Measured before this
          guard: 8 Tab presses from the close button moved scrollTop 0 → 1688
          (two whole cards) and started a station nobody swiped for — an
          auto-switch, reachable by one key.

          `tabIndex: -1` (not `inert`) is what closes it, because useDialog's
          getFocusable filters on `element.tabIndex !== -1` and does NOT
          understand inertness — an inert-but-tabIndex-0 button would still be
          enumerated, focus() would silently no-op, and the trap would simply
          move. It also removes the phantom focus ring: the entrance rule paints
          non-focused cards' controls at opacity 0, so a focus outline on one was
          invisible (WCAG 2.4.7). aria-hidden stops screen readers announcing
          five cards' worth of identical controls at once, and the stylesheet
          takes non-active rails out of the hit test entirely, so an invisible
          control can't be tapped mid-scroll either.

          `data-feed-action` is the handoff key: it names each control so the
          layout effect above can move focus to the SAME one on the card that
          just became active. */}
      <div
        ref={railRef}
        className="station-feed-card-actions"
        aria-hidden={active ? undefined : 'true'}
      >
        {/* The orb is MOUNTED on every windowed card, but `data-feed-playback-action`
            — the active-card sentinel that playback-no-auto-switch.spec counts
            (`cards.filter({ has: … })` → toHaveCount(1)) — stays on the active
            one only. Rendering it conditionally instead used to rip a focused
            orb out of the DOM on every swipe, dropping activeElement to <body>:
            the handoff above cannot see focus it no longer contains, and the orb
            is by far the likeliest control to be focused. */}
        <button
          type="button"
          className={`station-feed-action station-feed-action--play ${isPlaying ? 'is-playing' : ''}`.trim()}
          onClick={onTogglePlayback}
          aria-label={`${isPlaying ? labels.pause : labels.play}: ${station.name}`}
          data-feed-action="play"
          data-feed-playback-action={active ? '' : undefined}
          tabIndex={active ? undefined : -1}
        >
          <PlayPauseIcon playing={isPlaying} />
        </button>
        <button
          type="button"
          className={`station-feed-action ${favorite ? 'is-on' : ''}`.trim()}
          onClick={onToggleFavorite}
          aria-pressed={favorite}
          // Every rail label names its station, as the orb already did: without
          // it a screen reader hears «В избранное» with no idea which of the
          // windowed cards it belongs to.
          aria-label={`${favorite ? labels.unlike : labels.like}: ${station.name}`}
          data-feed-action="favorite"
          tabIndex={active ? undefined : -1}
        >
          <HeartIcon filled={favorite} />
        </button>
        <button
          type="button"
          className="station-feed-action"
          onClick={onEnqueue}
          aria-label={`${labels.addToQueue}: ${station.name}`}
          data-feed-action="queue"
          tabIndex={active ? undefined : -1}
        >
          <QueueIcon />
        </button>
        <button
          type="button"
          className="station-feed-action"
          onClick={onShare}
          aria-label={`${labels.share}: ${station.name}`}
          data-feed-action="share"
          tabIndex={active ? undefined : -1}
        >
          <ShareIcon />
        </button>
        <button
          type="button"
          className="station-feed-action"
          onClick={onOpenPlayer}
          aria-label={`${labels.openPlayer}: ${station.name}`}
          data-feed-action="expand"
          tabIndex={active ? undefined : -1}
        >
          <ExpandIcon />
        </button>
      </div>

      <div className="station-feed-card-info" data-lines={optionalLines}>
        {/* «В ЭФИРЕ» means "this is what YOU are playing" — it is a player state,
            not a station property. There is no per-station on-air signal in this
            stack (lastcheckok only says upstream reached the stream recently), so
            this must never widen to every card. */}
        {isCurrent && isLive ? (
          <span className="station-feed-live">
            <span className="station-feed-live-dot" aria-hidden="true" />
            {labels.live}
          </span>
        ) : null}
        <h2 className="station-feed-card-name">{normalizeStationName(station.name)}</h2>
        {trackLine ? <p className="station-feed-card-track">{trackLine}</p> : null}
        {place ? <p className="station-feed-card-place">{place}</p> : null}
        {genres ? <p className="station-feed-card-genres">{genres}</p> : null}
        {geoLine ? <p className="station-feed-card-geo">{geoLine}</p> : null}
        {/* Real analyser data when this station is playing; a flat resting strip
            otherwise — never a fake animated amplitude. It is also the stack's
            constant floor, so a name-only card still has a base to sit on. */}
        <FeedWaveform active={isPlaying} subscribe={subscribe} />
      </div>
    </div>
  );
};

export const StationFeed = () => {
  const { t } = useLocale();
  const { summary } = useCatalog();
  const { player, playStation, queue, nowPlaying, shareStation } = usePlayback();
  const {
    knownStations,
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
  const { setActiveSection, feedSeed, feedEntryStation, winamp } = useShell();
  const isMobile = useMobileLayout();

  // The feed re-rolls on EVERY open: rerollFeedSeed runs from the «Лента» entry's
  // onClick, so each open mints a new seed → a fresh personal-fresh mix, while
  // Home's own sessionSeed (frozen per session) stays put.
  const seed = feedSeed;
  const effectiveTasteProfile = useMemo(
    () => withFavoriteTasteBoosts(tasteProfile, favorites),
    [favorites, tasteProfile]
  );

  // Filter state is LOCAL to this screen — never Shell/Radio state. It resets per
  // open, and nothing outside the overlay re-renders when it changes.
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('picks');
  const [filtersOpen, setFiltersOpen] = useState(true);

  type VolatileSnapshot = {
    known: StationLite[];
    exclude: Set<string>;
    pin: StationLite | null;
    exposure: StationExposureLedger;
  };
  const volatileRef = useRef<VolatileSnapshot | null>(null);

  // The EXPENSIVE half of the deck: ranking + the recommendation stack. Split out
  // from the filter step so a chip tap provably cannot recompute it.
  //
  // Volatile inputs (the playing station, favorites, recent, the station cache)
  // are read at compute time but deliberately kept OUT of the deps so a
  // swipe-to-play or a like never reorders the list mid-scroll — yet because
  // `seed` changes per open, the NEXT open re-reads them. They are additionally
  // SNAPSHOTTED into a ref on first content: `feedFilter` is a real dep of the
  // cheap memo below, and without the snapshot a chip tap would silently re-read
  // them and make a station you liked mid-session vanish from the deck.
  const baseDeck = useMemo(() => {
    const summaryPool = summary?.catalogPool ?? [];
    if (!summaryPool.length) {
      volatileRef.current = null;
      return null;
    }
    const now = Date.now();

    if (!volatileRef.current) {
      // Freshness: drop what's already in the user's world so every card is new —
      // their favorites, recently-played stations, and the one playing right now.
      // (#86-safe: excluding the current station means the feed opens on card 0
      // without switching the player; resolveFeedEntry seeds it as already-played.)
      const exclude = new Set<string>();
      favorites.forEach((s) => exclude.add(s.stationuuid));
      recent.forEach((s) => exclude.add(s.stationuuid));
      if (player.current) exclude.add(player.current.stationuuid);

      // The Home hero the feed was expanded FROM becomes card 0 (owner ask #2 —
      // the hero IS the first feed card). It bypasses `exclude` (which always
      // contains the playing station) via buildStationFeed's `pinFirst`.
      //
      // #86 accounting, both branches:
      //   • a station IS current → the pin is that station → resolveFeedEntry
      //     finds it at index 0 → autoplayInitial:false → settler.seedPlayed(0).
      //     The feed opens ON the playing card, plays nothing, switches nothing.
      //   • nothing is playing  → resolveFeedEntry returns autoplayInitial:true and
      //     card 0 IS played on open (unchanged from today's idle behaviour). So an
      //     IDLE pin must clear the same liveness + eligibility bar as any other
      //     card, or we would autoplay a dead stream. Hence the asymmetric guard.
      const pinCandidate =
        feedEntryStation?.stationuuid && feedEntryStation.url_resolved ? feedEntryStation : null;
      const pinIsCurrent = Boolean(
        pinCandidate && pinCandidate.stationuuid === player.current?.stationuuid
      );
      const pinIsLiveEnough = Boolean(
        pinCandidate &&
          !isStationHardHiddenByPlayability(playabilityProfile, pinCandidate, now) &&
          !isStationSuppressedByHealth(stationHealthProfile, pinCandidate, now) &&
          !isStationHardHiddenByUpstream(pinCandidate, now) &&
          isFeedStationEligible(pinCandidate)
      );
      volatileRef.current = {
        known: knownStations,
        exclude,
        pin: pinIsCurrent || pinIsLiveEnough ? pinCandidate : null,
        // NORMALIZED, not raw. recordStationsShown prunes on write, but a ledger
        // can age past EXPOSURE_TTL_MS while it just sits in localStorage — and
        // «Новое для тебя» tests entries by PRESENCE (`!exposure[id]`), so a
        // stale entry would keep excluding a station the ledger no longer
        // considers recently-seen. Normalizing once here makes "an absent entry
        // means not recently surfaced" actually true, for both that predicate
        // and the chip's availability gate. It is a no-op for the rankers, which
        // already decay to zero past the TTL.
        exposure: normalizeExposureLedger(stationExposure, now)
      };
    }
    const volatile = volatileRef.current;

    // The summary ships `catalogPool: sorted.slice(0, 18)`, so the raw deck is at
    // most ~18 cards — too thin to split across filter chips without them reading
    // as broken. Merge in the station cache exactly as Home does (Home.tsx), which
    // needs no API change and cannot affect card 0 (that is `pinFirst`, not deck
    // contents).
    const pool = mergeUnique(summaryPool, volatile.known);

    // Liveness gate: drop anything broken/suppressed so the feed never autoplays
    // a dead stream on a swipe. Mirrors filterStationsByPlayability + the upstream
    // hard-hidden check used across discovery.
    const isLive = (candidate: StationLite) =>
      !isStationHardHiddenByPlayability(playabilityProfile, candidate, now) &&
      !isStationSuppressedByHealth(stationHealthProfile, candidate, now) &&
      !isStationHardHiddenByUpstream(candidate, now);

    const rankedCatalog = rankStationsForUser(pool, effectiveTasteProfile, playabilityProfile, {
      mode: 'personal',
      currentStation: null,
      seed,
      limit: pool.length,
      healthProfile: stationHealthProfile,
      sessionEvents: radioSessionEvents,
      exposure: volatile.exposure,
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
      exposure: volatile.exposure,
      now
    });
    // Taste leads, strongest first (tunedForYou[0] becomes the pinned card 0).
    const taste = mergeUnique(
      recommendation.tunedForYou,
      recommendation.becauseYouLiked,
      recommendation.outsideOrbit,
      rankedCatalog.slice(0, FEED_PERSONAL_POOL_LIMIT)
    );
    return { rankedCatalog, taste, isLive, ...volatile };
    // `feedEntryStation` is safe to depend on: it is written in the SAME gesture
    // handler that flips activeSection to 'feed', i.e. strictly before this
    // screen mounts, and never mutates while the feed is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, seed, feedEntryStation]);

  // `topVoted` was already fetched by the catalog and never read by the feed —
  // «Популярное» is the first consumer. Both fields are server-ranked
  // (clicktrend / votes); the client can order by them but can never print a
  // number, because toStationLite strips the counts.
  const popularSource = useMemo(
    () => mergeUnique(summary?.trending ?? [], summary?.topVoted ?? []),
    [summary]
  );
  // Availability is read from the deck's SNAPSHOTTED ledger, not from live
  // `stationExposure`, so the chip set cannot change shape underneath the user
  // mid-session (the ledger is flushed on close, but React state could still
  // update from another surface).
  const filterAvailability = { popular: popularSource, exposure: baseDeck?.exposure };
  const popularAvailable = isFeedFilterAvailable('popular', filterAvailability);
  const freshAvailable = isFeedFilterAvailable('fresh', filterAvailability);

  // The CHEAP half: buildStationFeed only. This is what a chip tap recomputes.
  const feedStations = useMemo(() => {
    if (!baseDeck) return [];
    const sources = resolveFeedFilterSources({
      filter: feedFilter,
      taste: baseDeck.taste,
      trending: summary?.trending ?? [],
      popular: popularSource,
      exposure: baseDeck.exposure
    });
    return buildStationFeed({
      ...sources,
      pool: baseDeck.rankedCatalog,
      seed,
      limit: Math.min(FEED_MAX_ITEMS, baseDeck.rankedCatalog.length || FEED_MAX_ITEMS),
      exclude: baseDeck.exclude,
      isLive: baseDeck.isLive,
      // #86 keystone: the pin is passed in EVERY filter branch, so card 0 is the
      // entry/current station whichever chip is active.
      pinFirst: baseDeck.pin
    });
  }, [baseDeck, feedFilter, popularSource, seed, summary]);

  const [visibleIndex, setVisibleIndex] = useState(0);
  const [visibleLimit, setVisibleLimit] = useState(FEED_INITIAL_VISIBLE);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  const kickstartedRef = useRef(false);
  const visibleFeedStations = useMemo(
    () => feedStations.slice(0, Math.min(visibleLimit, feedStations.length)),
    [feedStations, visibleLimit]
  );

  // geoResolver statically pulls d3-geo + topojson-client + a ~107KB countries
  // topology, and today lives only in the lazy Globe chunk. A static import here
  // would drag all of that into the feed chunk, so it is loaded once on mount and
  // the geo line simply appears when it lands.
  const [geoResolve, setGeoResolve] = useState<
    ((station: StationLite) => ResolvedCoords | null) | null
  >(null);
  useEffect(() => {
    let alive = true;
    void import('../lib/geoResolver')
      .then((module) => {
        if (alive) setGeoResolve(() => module.resolveStationCoords);
      })
      .catch(() => {
        // Fail soft: no geo line is the correct degradation, not an error state.
      });
    return () => {
      alive = false;
    };
  }, []);

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
  // per-swipe state churn, one batched write on unmount. It keeps ACCUMULATING
  // across filter changes: clearing it per chip would lose exactly the
  // impressions «Новое для тебя» is built on.
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

  // ⚠ `feedFilter` MUST NOT be a dep here. This effect clears kickstartedRef, and
  // a re-run with nothing playing gives resolveFeedEntry autoplayInitial:true —
  // i.e. a chip tap would start a station. See handleSelectFilter below.
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

  const resolveFeedReturnFocus = useCallback((): HTMLElement | null => {
    if (typeof document === 'undefined') return null;
    const candidates = document.querySelectorAll<HTMLElement>(
      [
        '.home-feed-entry',
        '.app-navigation-mobile .mobile-nav-item:first-child',
        '.app-navigation-desktop .nav-rail-item:first-child',
        '.app-brand-pill'
      ].join(',')
    );
    return (
      Array.from(candidates).find((element) => {
        const style = window.getComputedStyle(element);
        return (
          element.isConnected &&
          !element.hidden &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          element.getClientRects().length > 0
        );
      }) ?? null
    );
  }, []);

  // Accessible modal: focus-trap + Escape-to-close + #root inerting + focus
  // restoration, the project's portal-overlay contract (FullPlayerOverlay /
  // Globe / Library). The scroll-snap pager is unaffected — useDialog only
  // governs Tab / Escape / inert.
  const rootRef = useRef<HTMLDivElement>(null);
  useDialog(rootRef, {
    isOpen: true,
    onClose: handleClose,
    restoreFocusTo: resolveFeedReturnFocus
  });

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

  // Pre-warm the connection to the NEXT card so swiping to it skips the cold
  // DNS/TLS connect (direct streams only; proxied ones already hit the app origin).
  useEffect(() => {
    prewarmStation(visibleFeedStations[visibleIndex + 1]);
  }, [visibleFeedStations, visibleIndex]);

  useEffect(() => {
    cardRefs.current = cardRefs.current.slice(0, visibleFeedStations.length);
  }, [visibleFeedStations.length]);

  const commitLandedIndex = useCallback(
    (landed: number) => {
      const station = feedRef.current[landed];
      if (!station) return;
      setVisibleIndex(landed);
      settler.notify(landed);
      shownIdsRef.current.add(station.stationuuid);
    },
    [settler]
  );

  // IntersectionObserver is the high-accuracy signal below, but some embedded
  // Chromium builds occasionally miss its callback after a CSS snap. A passive
  // scroll fallback derives the same full-height card index from scrollTop. The
  // shared settler still debounces fast swipes to one final play request.
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root || visibleFeedStations.length === 0) return undefined;
    let frame: number | null = null;
    const handleScroll = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const cardHeight = root.clientHeight;
        if (cardHeight <= 0) return;
        const landed = Math.max(
          0,
          Math.min(visibleFeedStations.length - 1, Math.round(root.scrollTop / cardHeight))
        );
        commitLandedIndex(landed);
      });
    };
    root.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      root.removeEventListener('scroll', handleScroll);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [commitLandedIndex, visibleFeedStations.length]);

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
          commitLandedIndex(landed);
        }
      },
      { root, threshold: [0, 0.25, 0.5, 0.6, 0.75, 1] }
    );
    cardRefs.current.forEach((node) => node && observer.observe(node));
    return () => observer.disconnect();
  }, [commitLandedIndex, visibleFeedStations]);

  // #86: A FILTER CHANGE IS NEVER A PLAY REQUEST. The statements below must run
  // SYNCHRONOUSLY, IN THIS ORDER, INSIDE THE CLICK HANDLER. This is the single
  // most fragile invariant in the screen — it is invisible to the type system,
  // and both stationFeed.test.ts and feedAutoplay.test.ts stay green if it
  // breaks. tests/feed-filters.spec.ts is its only regression net.
  //
  // WHY IT IS NEEDED: rebuilding feedStations changes visibleFeedStations'
  // identity, which tears down and re-creates the IntersectionObserver effect
  // above. The NEW observer's initial callback fires immediately →
  // commitLandedIndex → settler.notify. At scroll-top that is harmless (card 0 is
  // pinFirst and onSettle's currentIdRef guard refuses it), but at card 5 index 5
  // in the NEW deck is a DIFFERENT station and the player would switch — an
  // auto-switch nobody swiped for.
  //
  // THE THREE WAYS TO REINTRODUCE THE BUG, all of which look like tidy-ups:
  //   1. moving this into a useEffect (StrictMode double-fires it — the same
  //      reason rerollFeedSeed lives in Home's onClick),
  //   2. adding `feedFilter` to the [seed] effect that clears kickstartedRef,
  //   3. swapping seedPlayed() for reset() (reset drops the played memory).
  //   4. moving the settler calls inside a setFeedFilter(updater) callback —
  //      React invokes updaters twice under StrictMode, and they must stay pure.
  const handleSelectFilter = useCallback(
    (next: FeedFilter) => {
      if (next === feedFilter) return;
      settler.cancel();
      if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
      // Card 0 is pinFirst under every filter, so seeding index 0 is always
      // correct — and it is the ONLY thing that makes the new observer's
      // initial notify(0) a no-op.
      settler.seedPlayed(0);
      setVisibleIndex(0);
      setVisibleLimit(FEED_INITIAL_VISIBLE);
      setFeedFilter(next);
    },
    [feedFilter, settler]
  );

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

  const handleTogglePlayback = (station: StationLite) => {
    settler.cancel();
    if (player.current?.stationuuid === station.stationuuid) {
      void player.toggle();
      return;
    }
    playStation(station, {
      playlist: visibleFeedStations,
      sourceId: FEED_SOURCE_ID,
      sourceLabel
    });
  };

  // Advancing via the peek strip is a DELIBERATE advance, i.e. semantically a
  // swipe — so it goes through the normal scroll → settler path and is #86-legal.
  // It is also the first keyboard route through the pager. `auto`, not `smooth`:
  // smooth scrolling fights CSS snap.
  const handleAdvance = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTop = (visibleIndex + 1) * scroller.clientHeight;
  };

  // The pager's keyboard route, in BOTH directions. «Дальше» only ever goes
  // forward, and native arrow-scrolling reaches the snap container only while
  // focus happens to sit inside it — from the ✕ button or the chips, ArrowDown
  // did nothing at all and there was no «Назад» control anywhere in the tab
  // cycle. Parking on card 5 with no way back up is not a keyboard-operable
  // pager.
  //
  // #86: this SCROLLS and nothing else. The landing still goes through the same
  // scroll → IntersectionObserver → settler path a swipe does, so a key press is
  // exactly as deliberate a play request as a swipe or a «Дальше» tap, and
  // playStation is never called from here.
  const handlePagerKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowDown' || event.key === 'PageDown'
        ? 1
        : event.key === 'ArrowUp' || event.key === 'PageUp'
          ? -1
          : 0;
    if (step === 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    const scroller = scrollerRef.current;
    const height = scroller?.clientHeight ?? 0;
    if (!scroller || height <= 0) return;
    // Without this the browser ALSO scrolls the snap container whenever focus is
    // inside it, and one key press lands two cards away.
    event.preventDefault();
    // Read the position from the scroller, not from `visibleIndex`: that state
    // lands via a rAF-throttled scroll handler, so a second key press within the
    // same frame would compute its step from a stale index.
    const from = Math.round(scroller.scrollTop / height);
    const next = Math.max(0, Math.min(visibleFeedStations.length - 1, from + step));
    scroller.scrollTop = next * height;
  };

  if (typeof document === 'undefined') return null;

  const labels = {
    live: t('feed.live'),
    play: t('common.play'),
    pause: t('common.pause'),
    like: t('feed.like'),
    unlike: t('feed.unlike'),
    addToQueue: t('feed.addToQueue'),
    share: t('feed.share'),
    openPlayer: t('feed.openPlayer')
  };

  const chips: Array<{ id: FeedFilter; label: string }> = [
    { id: 'picks', label: t('feed.filterPicks') },
    // Both conditional chips are absent — never disabled — when the signal
    // behind their label is missing: «Популярное» without a server-sent popular
    // set would be the default mix wearing a popularity label, and «Новое для
    // тебя» on an empty exposure ledger excludes nothing, so it would rebuild
    // the identical deck and read as broken. See lib/feedFilters.
    ...(freshAvailable ? [{ id: 'fresh' as const, label: t('feed.filterFresh') }] : []),
    ...(popularAvailable ? [{ id: 'popular' as const, label: t('feed.filterPopular') }] : [])
  ];
  const activeChip = chips.find((chip) => chip.id === feedFilter);
  const activeChipLabel = activeChip?.label ?? '';
  // A chip tap is otherwise completely silent for a screen-reader user; focus
  // stays on the chip, so the result has to be announced — with a NOUN, because
  // a bare integer («Новое для тебя · 15») does not say 15 of what.
  const statusLine = t('feed.filterStatus', {
    filter: activeChipLabel,
    count: String(feedStations.length)
  });

  const nextStation = visibleFeedStations[visibleIndex + 1] ?? null;
  // A non-default filter that yields nothing but the pinned card is a dead end.
  // Rather than replacing the cards (which would drop card 0 and its #86
  // contract), the peek band becomes the way back.
  //
  // `!activeChip` is the second dead end: if a summary refresh drops the signal
  // behind the ACTIVE filter, its chip unmounts while feedFilter still points at
  // it — nothing shows aria-pressed and there is no way back. Surfacing the same
  // reset band is the fix that costs nothing: it routes through
  // handleSelectFilter, the one #86-safe path. Deliberately NOT an effect that
  // rewrites feedFilter — that would rebuild the deck underneath a parked user,
  // which is the exact auto-switch hazard handleSelectFilter exists to prevent.
  const filterRanDry =
    Boolean(baseDeck) && feedFilter !== 'picks' && (feedStations.length <= 1 || !activeChip);

  const overlay = (
    <div
      ref={rootRef}
      className={`station-feed-overlay ${isMobile ? '' : 'station-feed-overlay--desktop'}`.trim()}
      role="dialog"
      aria-modal="true"
      aria-label={t('feed.title')}
      onKeyDown={handlePagerKeys}
    >
      {/* pointer-events are off on the wrapper so a swipe that starts up here
          still reaches the pager; every control opts back in individually. */}
      <header className="station-feed-topbar" data-filters-open={filtersOpen ? 'true' : 'false'}>
        {/* FIRST IN DOM on purpose: useDialog gives initial focus to the first
            focusable, and that must stay the close button. */}
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
        <button
          type="button"
          className="station-feed-filter-toggle"
          onClick={() => setFiltersOpen((open) => !open)}
          aria-label={t('feed.filters')}
          aria-expanded={filtersOpen}
          aria-controls="station-feed-filters"
        >
          <SlidersIcon />
        </button>
        {/* ⚠ COLLAPSED = NOT RENDERED, not merely hidden. `hidden` + the row's
            `display: none` is NOT enough to leave the tab cycle: useDialog's
            isVisible() inspects each candidate's OWN computed style, and a chip
            inside a display:none parent still computes `display: inline-flex`
            (offsetParent null, getClientRects().length 0 — but nothing it looks
            at says so). getFocusable therefore kept enumerating the chips,
            focus() on a non-rendered element silently no-ops, and nextIndex
            recomputed to the same dead chip forever: measured 8 consecutive Tab
            presses all stuck on the toggle, with the orb, favourite, queue,
            share, expand and peek strip unreachable — a keyboard trap (WCAG
            2.1.2). Not rendering them is the fix that cannot be undone by a
            CSS edit; useDialog's isVisible() has been hardened as well so no
            future descendant of a display:none container can wedge the trap.
            Real buttons with aria-pressed — not role="tab", which would promise
            arrow-key panel switching the pager doesn't have. */}
        <div
          id="station-feed-filters"
          className="station-feed-filters"
          role="group"
          aria-label={t('feed.filters')}
          hidden={!filtersOpen}
        >
          {(filtersOpen ? chips : []).map((chip) => (
            <button
              key={chip.id}
              type="button"
              className="station-feed-chip"
              data-feed-filter={chip.id}
              aria-pressed={feedFilter === chip.id}
              onClick={() => handleSelectFilter(chip.id)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </header>

      <p className="station-feed-status" role="status" aria-live="polite">
        {statusLine}
      </p>

      <div ref={scrollerRef} className="station-feed-scroller">
        {visibleFeedStations.length === 0 ? (
          <div className="station-feed-empty">
            <strong>{summary ? t('feed.emptyTitle') : t('feed.loading')}</strong>
            {summary ? <p>{t('feed.emptyBody')}</p> : null}
          </div>
        ) : (
          visibleFeedStations.map((station, index) => {
            const windowed = Math.abs(index - visibleIndex) <= RENDER_WINDOW;
            const active = index === visibleIndex;
            const isCurrent = player.current?.stationuuid === station.stationuuid;
            const liveTrack = isCurrent && nowPlaying ? nowPlaying.trim() : '';
            const lastTrack = latestTrackForStation(trackHistory, station.stationuuid)?.track ?? '';
            return (
              <section
                key={station.stationuuid}
                className="station-feed-card"
                data-feed-index={index}
                // Makes "the Home hero IS feed card 0" a directly assertable
                // contract (playback-no-auto-switch.spec.ts) rather than
                // something inferred from the rendered station name.
                data-feed-station={station.stationuuid}
                aria-label={station.name}
                ref={(node) => {
                  cardRefs.current[index] = node;
                }}
              >
                {windowed ? (
                  <FeedCard
                    station={station}
                    active={active}
                    isCurrent={isCurrent}
                    isPlaying={isCurrent && player.isPlaying}
                    isLive={Boolean(liveTrack) || (isCurrent && player.isPlaying)}
                    trackLine={liveTrack || lastTrack}
                    geoLine={active ? resolveGeoLine(station, geoResolve) : null}
                    favorite={isFavorite(station.stationuuid)}
                    subscribe={player.subscribeVisualizer}
                    onTogglePlayback={() => handleTogglePlayback(station)}
                    onToggleFavorite={() => toggleFavorite(station)}
                    onEnqueue={() => queue.enqueue(station)}
                    onShare={() => void shareStation(station)}
                    onOpenPlayer={() => handleOpenPlayer(station)}
                    labels={labels}
                  />
                ) : null}
              </section>
            );
          })
        )}
      </div>

      {/* Fixed chrome occupying the band the cards stop short of, so the next card
          "peeks" without the snap unit ever being anything but one viewport —
          .station-feed-card must stay exactly 100svh === scroller.clientHeight,
          which is the divisor in the scroll fallback, the kickstart jump and the
          e2e's own index arithmetic. */}
      {filterRanDry ? (
        <div className="station-feed-next station-feed-next--dry">
          <span className="station-feed-next-label">{t('feed.emptyFilterTitle')}</span>
          <span className="station-feed-next-title">{t('feed.emptyFilterBody')}</span>
          <button
            type="button"
            className="station-feed-next-reset"
            onClick={() => handleSelectFilter('picks')}
          >
            {t('feed.emptyFilterReset')}
          </button>
        </div>
      ) : nextStation ? (
        <button
          type="button"
          className="station-feed-next"
          onClick={handleAdvance}
          aria-label={t('feed.nextUp', { name: normalizeStationName(nextStation.name) })}
        >
          <span className="station-feed-next-label">{t('feed.nextLabel')}</span>
          <span className="station-feed-next-title">
            {normalizeStationName(nextStation.name)}
          </span>
        </button>
      ) : null}
    </div>
  );

  return createPortal(overlay, document.body);
};
