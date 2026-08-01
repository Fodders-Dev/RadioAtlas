import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from 'react';
import { normalizeStationName, stationLocation, stationTags } from '../lib/stationUtils';
import { stationLocalTime } from '../lib/stationClock';
import { buildMusicServiceLinks } from '../lib/musicServiceLinks';
import { formatListenerLine } from '../lib/listenerPresence';
import { useListenerPresence } from '../lib/useListenerPresence';
import { useDialog } from '../lib/useDialog';
import { SLEEP_TIMER_PRESETS_MIN, formatSleepRemaining } from '../lib/sleepTimer';
import { SleepTimerDial } from './SleepTimerDial';
import {
  canShareToStory,
  openLinkOrFallback,
  openStationRecording,
  shareStationToStory,
  triggerHaptic
} from '../lib/telegram';
import { resolveNowPlayingTrust } from '../lib/trackTrust';
import { useLocale } from '../state/LocaleContext';
import { latestTrackForStation } from '../state/radio/helpers';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import type { StationLite } from '../types';
import { StationBackdrop } from './StationBackdrop';
import { StationPlaceCard } from './StationPlaceCard';
import { FullPlayerVisualizer } from './FullPlayerVisualizer';
import { StationArtwork } from './StationArtwork';
import { ThemeActionIcon } from './ThemeActionIcon';
import './FullPlayerOverlay.css';

type FullPlayerOverlayProps = {
  onDetails?: () => void;
};

const actionIcon = {
  close: (
    <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6 6.4 5Z" />
  ),
  collapse: <path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6 1.4-1.4Z" />,
  more: (
    <path d="M12 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z" />
  ),
  queue: (
    <path d="M3 6h12v2H3V6Zm0 5h12v2H3v-2Zm0 5h8v2H3v-2Zm16-2.55V6h2v9.5a3.25 3.25 0 1 1-2-3.05ZM17.75 19a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z" />
  ),
  previous: <path d="M7 6h2v12H7V6Zm3 6 8 6V6l-8 6Z" />,
  volume: (
    <path d="M5 9v6h4l5 4V5l-5 4H5Zm11.5 3a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12Zm1.5 0c0 2.42-1.18 4.56-3 5.88v-1.95a5.49 5.49 0 0 0 0-7.86V6.12c1.82 1.32 3 3.46 3 5.88Z" />
  ),
  mute: (
    <path d="M15 12a5.5 5.5 0 0 1-.96 3.12l1.43 1.43A7.45 7.45 0 0 0 17 12c0-1.78-.62-3.42-1.66-4.7l-1.42 1.42A5.5 5.5 0 0 1 15 12ZM3.27 2 2 3.27 6.73 8H5v8h4l5 4v-6.73L18.73 18 20 16.73 3.27 2ZM12 8.83v6.34l-2.8-2.24-.57-.46H7V10h1.63l.57-.46L12 8.83Z" />
  ),
  play: <path d="M8 5v14l11-7L8 5Z" />,
  pause: <path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z" />,
  next: <path d="M6 6v12l8.5-6L6 6Zm9 0v12h2V6h-2Z" />,
  like: (
    <path d="M12 21.2l-1.4-1.3C5.4 15.4 2 12.3 2 8.4 2 5.6 4.2 3.5 7 3.5c1.6 0 3.2.7 4.2 2 1-1.3 2.6-2 4.2-2 2.8 0 5 2.1 5 4.9 0 3.9-3.4 7-8.6 11.4L12 21.2Z" />
  ),
  share: (
    <path d="M18 16.1c-.76 0-1.44.3-1.96.77L8.9 12.7c.06-.23.1-.46.1-.7s-.04-.47-.1-.7l7.06-4.12A2.99 2.99 0 1 0 15 5c0 .24.04.47.1.7L8.04 9.82A3 3 0 1 0 8.04 14.2l7.13 4.18c-.05.2-.08.41-.08.62A2.91 2.91 0 1 0 18 16.1Z" />
  ),
  external: (
    <path d="M19 19H5V5h7V3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7ZM14 3v2h3.6l-9.8 9.8 1.4 1.4L19 6.4V10h2V3h-7Z" />
  ),
  details: (
    <path d="M11 17h2v-6h-2v6Zm1-14a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 16a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm-1-9h2V7h-2v3Z" />
  ),
  hide: (
    <path d="M12 5c5 0 8.5 4.5 9.7 6.2.22.3.22.7 0 1C20.5 14 17 18.5 12 18.5S3.5 14 2.3 12.2a.86.86 0 0 1 0-1C3.5 9.5 7 5 12 5Zm0 2C8.5 7 5.8 9.7 4.4 11.7 5.8 13.8 8.5 16.5 12 16.5s6.2-2.7 7.6-4.8C18.2 9.7 15.5 7 12 7Zm0 1.5a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4Z" />
  ),
  copy: (
    <path d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10V1Zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H10V7h9v14Z" />
  ),
  up: <path d="M7 14.5 12 9l5 5.5-1.5 1.4L12 12l-3.5 3.9L7 14.5Z" />,
  down: <path d="m7 9.5 1.5-1.4L12 12l3.5-3.9L17 9.5 12 15 7 9.5Z" />,
  remove: (
    <path d="M7 6V4h10v2h4v2h-2v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8H3V6h4Zm0 2v11h10V8H7Zm2 2h2v7H9v-7Zm4 0h2v7h-2v-7Z" />
  ),
  record: <circle cx="12" cy="12" r="6" />,
  sleep: <path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z" />
};

const Icon = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {children}
  </svg>
);

// Joined from the parts that exist: stationLocation now returns '' when the
// catalogue has no place for a station, and a naive template left a dangling
// « · » in front of the tags.
const formatStationMeta = (station: StationLite | null, fallback: string) =>
  station
    ? [stationLocation(station), stationTags(station)].filter(Boolean).join(' · ') || fallback
    : fallback;

// PR-6: the player has two render branches. ≤720px gets the mobile-first stage
// (fixed now-playing + bottom sheets); >720px keeps the previous desktop DOM
// byte-identical (2-col .full-player-now + inline panels). The breakpoint
// matches the CSS @media (max-width: 720px) block exactly so the JS branch and
// the stylesheet can never disagree.
const MOBILE_PLAYER_QUERY = '(max-width: 720px)';

const useMobilePlayerLayout = () => {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(MOBILE_PLAYER_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia(MOBILE_PLAYER_QUERY);
    const update = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    setIsMobile(mediaQuery.matches);
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, []);

  return isMobile;
};

type FullPlayerSheetProps = {
  open: boolean;
  onClose: () => void;
  kicker: string;
  title: string;
  children: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
};

// PR-6: bottom-anchored sheet for the mobile player (queue / overflow actions).
// Reuses the SettingsSheet React contract (useDialog scrim + focus trap, mounted
// only while open) with its own bottom-sheet CSS. Rendered as a SIBLING of the
// overlay root, not a child: useDialog's focus trap listens on its own root and
// inerts siblings, so nesting one dialog root inside another would double-handle
// every Tab. As a sibling (the StationDetails pattern) the sheet inerts the
// overlay underneath and restores focus to the control that opened it on close.
const FullPlayerSheet = ({
  open,
  onClose,
  kicker,
  title,
  children,
  initialFocusRef
}: FullPlayerSheetProps) => {
  const { t } = useLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialog(rootRef, { isOpen: open, onClose });

  useEffect(() => {
    if (!open || !initialFocusRef) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const target = initialFocusRef.current;
      if (!target) return;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ behavior: 'auto', block: 'start', inline: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialFocusRef, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      ref={rootRef}
      className="full-player-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        className="full-player-sheet-scrim"
        type="button"
        onClick={onClose}
        aria-label={t('common.close')}
        data-dialog-backdrop
      />
      <div className="full-player-sheet-card">
        <span className="full-player-sheet-handle" aria-hidden="true" />
        <div className="full-player-sheet-head">
          <div>
            <div className="full-player-sheet-kicker">{kicker}</div>
            <div className="full-player-sheet-title" id={titleId}>
              {title}
            </div>
          </div>
          <button
            className="full-player-icon-btn full-player-sheet-close"
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <Icon>{actionIcon.collapse}</Icon>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

export const FullPlayerOverlay = ({ onDetails }: FullPlayerOverlayProps) => {
  const { t, locale } = useLocale();
  const {
    player,
    queue,
    nowPlaying,
    nowPlayingStatus,
    playPrevious,
    playNext,
    playLast,
    copyTrack,
    openExternal,
    shareStation,
    sleepTimer,
    startSleepTimer,
    cancelSleepTimer
  } = usePlayback();
  const {
    playbackHistory,
    trackHistory,
    toggleFavorite,
    isFavorite,
    hideStationFromRecommendations,
    unhideStationFromRecommendations,
    isStationHiddenFromRecommendations
  } = useLibrary();
  const { setActiveSection, setLibraryTab, winamp } = useShell();
  const rootRef = useRef<HTMLDivElement>(null);
  const recentPanelRef = useRef<HTMLDivElement>(null);
  const isMobileLayout = useMobilePlayerLayout();

  const [actionsSheetOpen, setActionsSheetOpen] = useState(false);
  const [queueSheetTarget, setQueueSheetTarget] = useState<'queue' | 'recent' | null>(null);
  const [sleepSheetOpen, setSleepSheetOpen] = useState(false);
  const [trackSheetOpen, setTrackSheetOpen] = useState(false);
  // The station clock must not go stale while someone stares at it. One tick a
  // minute, only while the overlay is mounted.
  const [clockTick, setClockTick] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setClockTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const [dialMinutes, setDialMinutes] = useState(30);
  const sleepLabel = sleepTimer.active ? formatSleepRemaining(sleepTimer.remainingMs) : t('settings.off');
  // Mounted only while open (App.tsx gates on winamp.expanded), so isOpen
  // is true for the hook's lifetime; close routes through setExpanded.
  // The dock that opened this unmounts while the overlay is up, so restore
  // focus to its re-mounted artwork trigger rather than the gone original.
  useDialog(rootRef, {
    isOpen: true,
    onClose: () => winamp.setExpanded(false),
    restoreFocusTo: () =>
      document.querySelector<HTMLElement>('.player-dock-artwork-trigger')
  });

  const current = player.current;
  // Live co-listeners, counted by us. Renders only at 2+ (see formatListenerLine):
  // at 1 the only listener is the viewer, which is not information.
  const liveListeners = useListenerPresence(current, player.isPlaying);
  const listenerLine = formatListenerLine(liveListeners);
  const liked = current ? isFavorite(current.stationuuid) : false;
  const stationHidden = current ? isStationHiddenFromRecommendations(current.stationuuid) : false;
  const queueLabel = queue.sourceLabel || t('radio.queueDefault');
  const activeQueueIndex =
    queue.currentIndex >= 0
      ? queue.currentIndex
      : current
        ? queue.items.findIndex((station) => station.stationuuid === current.stationuuid)
        : -1;
  const canResume = Boolean(current || queue.items.length || playbackHistory.length);
  const canCopyTrack = Boolean(nowPlaying?.trim());
  const trust = resolveNowPlayingTrust({
    station: current,
    track: nowPlaying,
    metadataStatus: nowPlayingStatus,
    playerStatus: player.status,
    failure: player.failure
  });
  // Last-heard fallback: when the live metadata has RESOLVED EMPTY (not just
  // loading) and there's no trusted live track, surface the most recent recorded
  // track for this station — dimmed + labeled, never treated as live (copy stays
  // disabled, bound to the live nowPlaying only). 'loading' shows neither so a
  // real title can still arrive without a flash.
  const lastHeard = useMemo(
    () =>
      nowPlayingStatus === 'unavailable' && !trust.track && current
        ? latestTrackForStation(trackHistory, current.stationuuid)
        : null,
    [nowPlayingStatus, trust.track, current, trackHistory]
  );
  const isLastHeard = !trust.track && Boolean(lastHeard);
  // The real metadata, before the "no title yet" placeholder is substituted for
  // display. Anything that SEARCHES must use this one — searching a service for
  // the words «Название трека пока недоступно» is worse than offering nothing.
  const realTrack = trust.track || lastHeard?.track || '';
  const displayTrack =
    realTrack || (current ? t('dock.currentTrackUnavailable') : t('winamp.noStation'));
  const queuePreview = useMemo(() => {
    if (!queue.items.length) return [];
    const start = Math.max(activeQueueIndex, 0);
    return queue.items.slice(start, start + 13);
  }, [activeQueueIndex, queue.items]);
  const nextQueueIndex = queue.items.length
    ? activeQueueIndex >= 0
      ? activeQueueIndex + 1
      : 0
    : -1;
  const nextQueueStation = queue.items[nextQueueIndex] || null;
  const recentTracks = useMemo(
    () =>
      (current
        ? trackHistory.filter((item) => item.stationId === current.stationuuid)
        : trackHistory
      )
        .filter((item) => item.track.trim())
        .slice(0, 4),
    [current, trackHistory]
  );

  // PR-6: live pill on the mobile identity block — same status derivation as the
  // dock (buffering with recent transport failures reads as a reconnect).
  const recordAvailable = Boolean(import.meta.env.VITE_TG_BOT);
  const livePillState =
    current && player.status === 'buffering'
      ? {
          tone: 'warning' as const,
          label:
            player.transport.recentFailures.length > 0
              ? t('dock.reconnecting')
              : t('dock.buffering')
        }
      : current && player.isPlaying
        ? { tone: 'live' as const, label: t('app.liveBadge') }
        : null;

  const handlePrimary = () => {
    if (current) {
      void player.toggle();
      return;
    }
    playLast();
  };

  const handleDetails = () => {
    if (!current || !onDetails) return;
    onDetails();
  };

  const handleHideStation = () => {
    if (!current) return;
    if (stationHidden) {
      unhideStationFromRecommendations(current);
    } else {
      hideStationFromRecommendations(current);
    }
  };

  const openLibraryQueue = () => {
    setLibraryTab('queue');
    setActiveSection('library');
    winamp.setExpanded(false);
  };

  const openActionsSheet = () => setActionsSheetOpen(true);
  const openQueueSheet = () => {
    setActionsSheetOpen(false);
    setQueueSheetTarget('queue');
  };
  const openRecentTracksSheet = () => {
    setActionsSheetOpen(false);
    setQueueSheetTarget('recent');
  };

  const renderQueueItem = (station: StationLite, index: number) => {
    const absoluteIndex = Math.max(activeQueueIndex, 0) + index;
    const active = current?.stationuuid === station.stationuuid;
    const canMoveUp = !active && absoluteIndex > Math.max(activeQueueIndex + 1, 0);
    const canMoveDown = !active && absoluteIndex < queue.items.length - 1;
    return (
      <article
        className={`full-player-queue-item ${active ? 'active' : ''}`}
        key={`${station.stationuuid}-${absoluteIndex}`}
        data-full-player-queue-item={station.stationuuid}
        data-queue-index={absoluteIndex}
      >
        <StationArtwork station={station} size="sm" />
        <button
          className="full-player-queue-main"
          type="button"
          onClick={() => queue.playAtIndex(absoluteIndex)}
          aria-label={`${active ? t('queue.nowPlaying') : t('common.play')}: ${normalizeStationName(station.name)}`}
        >
          <strong>{normalizeStationName(station.name)}</strong>
          <small>{stationLocation(station)}</small>
          {active ? <em>{t('queue.nowPlaying')}</em> : null}
        </button>
        <span className="full-player-queue-actions">
          <button
            className="full-player-queue-btn"
            type="button"
            onClick={() => queue.moveAtIndex(absoluteIndex, -1)}
            disabled={!canMoveUp}
            data-queue-action="move-up"
            aria-label={`${t('queue.moveUp')}: ${normalizeStationName(station.name)}`}
          >
            <Icon>{actionIcon.up}</Icon>
          </button>
          <button
            className="full-player-queue-btn"
            type="button"
            onClick={() => queue.moveAtIndex(absoluteIndex, 1)}
            disabled={!canMoveDown}
            data-queue-action="move-down"
            aria-label={`${t('queue.moveDown')}: ${normalizeStationName(station.name)}`}
          >
            <Icon>{actionIcon.down}</Icon>
          </button>
          <button
            className="full-player-queue-btn danger"
            type="button"
            onClick={() => queue.removeAtIndex(absoluteIndex)}
            data-queue-action="remove"
            aria-label={`${t('queue.remove')}: ${normalizeStationName(station.name)}`}
          >
            <Icon>{actionIcon.remove}</Icon>
          </button>
        </span>
      </article>
    );
  };

  // Shared verbatim pieces — used by both layout branches so the desktop DOM
  // stays byte-identical while mobile recomposes around them.
  // "It is 21:47 in Tokyo right now" — the one thing a radio app can say that a
  // playlist cannot. stationLocalTime returns null for any country with more than
  // one timezone, so the line simply disappears rather than printing a clock that
  // is wrong for most of that country. Re-rendered once a minute while open.
  const stationClock = useMemo(
    () => stationLocalTime(current?.country, new Date(clockTick), locale === 'en' ? 'en-GB' : 'ru-RU'),
    [current?.country, clockTick, locale]
  );

  /**
   * The best idea in the reference mockup, and the data was already here: what
   * this station played, with the time. The recurring radio frustration is
   * hearing something good, getting distracted, and losing it forever.
   *
   * The timestamp is when THIS device observed the track, so it is formatted in
   * the listener's own timezone — "you heard this at 21:28" — not the station's.
   */
  const renderRecentOnAir = () => {
    if (!current || recentTracks.length === 0) return null;
    return (
      <section className="full-player-recent-air" aria-label={t('winamp.recentOnAir')}>
        <span className="full-player-section-label">{t('winamp.recentOnAir')}</span>
        <ul>
          {recentTracks.slice(0, 3).map((item) => (
            <li key={item.id}>
              <span className="full-player-recent-air-track">{item.track}</span>
              <time
                className="full-player-recent-air-time"
                dateTime={new Date(item.timestamp).toISOString()}
              >
                {new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ru-RU', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false
                }).format(new Date(item.timestamp))}
              </time>
            </li>
          ))}
        </ul>
      </section>
    );
  };

  // Search links are pure url-building (lib/musicServiceLinks) — no network, no
  // assistant round trip, so the sheet opens instantly and works offline.
  const trackServiceLinks = useMemo(() => buildMusicServiceLinks(realTrack), [realTrack]);

  const renderTrackButton = () => (
    <button
      className="full-player-track"
      type="button"
      disabled={!canCopyTrack && trackServiceLinks.length === 0}
      onClick={() => {
        // Tapping used to copy silently, with nothing on screen saying so.
        // It now opens the track sheet, where copying is one visible row next
        // to "open in your music service".
        if (canCopyTrack || trackServiceLinks.length > 0) {
          triggerHaptic();
          setTrackSheetOpen(true);
        }
      }}
      data-full-player-track
      data-last-heard={isLastHeard ? 'true' : undefined}
    >
      <span>{displayTrack}</span>
      {isLastHeard ? <span className="full-player-track-tag">{t('dock.lastHeard')}</span> : null}
      {trackServiceLinks.length > 0 ? (
        <Icon>{actionIcon.external}</Icon>
      ) : canCopyTrack ? (
        <Icon>{actionIcon.copy}</Icon>
      ) : null}
    </button>
  );

  const renderTransport = () => (
    <section className="full-player-controls" aria-label={t('dock.ready')}>
      <button
        className="full-player-icon-btn"
        type="button"
        onClick={() => {
          triggerHaptic();
          playPrevious();
        }}
        disabled={!canResume}
        aria-label={t('common.previous')}
      >
        <ThemeActionIcon name="prev">{actionIcon.previous}</ThemeActionIcon>
      </button>
      <button
        className={`full-player-primary-btn ${player.isPlaying ? 'active' : ''}`}
        type="button"
        onClick={() => {
          triggerHaptic();
          handlePrimary();
        }}
        disabled={!canResume}
        aria-label={player.isPlaying ? t('common.pause') : t('common.play')}
      >
        <ThemeActionIcon name={player.isPlaying ? 'pause' : 'play'}>
          {player.isPlaying ? actionIcon.pause : actionIcon.play}
        </ThemeActionIcon>
      </button>
      <button
        className="full-player-icon-btn"
        type="button"
        onClick={() => {
          triggerHaptic();
          playNext();
        }}
        disabled={!canResume}
        aria-label={t('common.next')}
      >
        <ThemeActionIcon name="next">{actionIcon.next}</ThemeActionIcon>
      </button>
    </section>
  );

  // Volume lives here now. The mini dock dropped its volume button so the
  // station name could have the width (the owner: «область под трек теперь очень
  // маленькая»), and the full player had NO volume control at all — so without
  // this row the app would simply have lost in-app loudness control.
  const renderVolume = () => (
    <section className="full-player-volume" aria-label={t('dock.volume')}>
      <button
        className="full-player-volume-toggle"
        type="button"
        onClick={() => {
          triggerHaptic();
          player.setVolume(player.volume > 0.01 ? 0 : 0.8);
        }}
        aria-label={t('dock.volume')}
      >
        {/* Plain svg, not ThemeActionIcon: that component's `name` is a closed
            union of the themable transport glyphs and volume is not one. */}
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {player.volume > 0.01 ? actionIcon.volume : actionIcon.mute}
        </svg>
      </button>
      <input
        className="full-player-volume-range"
        type="range"
        min={0}
        max={100}
        value={Math.round(player.volume * 100)}
        onChange={(event) => player.setVolume(Number(event.target.value) / 100)}
        aria-label={t('dock.volume')}
      />
      <span className="full-player-volume-value">{Math.round(player.volume * 100)}%</span>
    </section>
  );

  const renderLikeChip = () => (
    <button
      className={`full-player-action-chip ${liked ? 'active' : ''}`}
      type="button"
      onClick={() => {
        if (current) {
          triggerHaptic();
          toggleFavorite(current);
        }
      }}
      disabled={!current}
      aria-label={liked ? t('stationTable.unfavorite') : t('stationTable.favorite')}
      aria-pressed={liked}
    >
      <ThemeActionIcon name="like">{actionIcon.like}</ThemeActionIcon>
      <span>{liked ? t('stationTable.unfavorite') : t('stationTable.favorite')}</span>
    </button>
  );

  const renderShareChip = () => (
    <button
      className="full-player-action-chip"
      type="button"
      onClick={() => current && shareStation(current)}
      disabled={!current}
      aria-label={t('common.share')}
    >
      <Icon>{actionIcon.share}</Icon>
      <span>{t('common.share')}</span>
    </button>
  );

  // Recording PR2 (+PR-6 rehome): deep-links to the bot's /record flow for the
  // current station. The gate is unchanged — the record UI exists only when the
  // bot is configured; on mobile it owns the third face slot, otherwise that
  // slot shows the queue chip instead.
  const renderRecordChip = () => (
    <button
      className="full-player-action-chip"
      type="button"
      onClick={() => {
        if (current) {
          triggerHaptic();
          openStationRecording(current.stationuuid);
        }
      }}
      disabled={!current}
      aria-label={t('winamp.record')}
    >
      <Icon>{actionIcon.record}</Icon>
      <span>{t('winamp.record')}</span>
    </button>
  );

  const renderQueuePanel = () => (
    <div className="full-player-panel" data-full-player-queue>
      <div className="full-player-panel-head">
        <h3>{t('winamp.upNext')}</h3>
        <span>{t('winamp.queueCount', { count: queue.items.length })}</span>
      </div>
      <div className="full-player-queue-toolbar">
        <button
          className="full-player-small-chip"
          type="button"
          onClick={queue.clearUpcoming}
          disabled={activeQueueIndex < 0 || activeQueueIndex >= queue.items.length - 1}
        >
          {t('queue.clearUpcoming')}
        </button>
        <button className="full-player-small-chip" type="button" onClick={openLibraryQueue}>
          {t('queue.openLibrary')}
        </button>
      </div>
      <div className="full-player-queue-list">
        {queuePreview.length ? (
          queuePreview.map(renderQueueItem)
        ) : (
          <div className="full-player-empty">{t('winamp.buildQueue')}</div>
        )}
      </div>
    </div>
  );

  const renderRecentPanel = () => (
    <div
      ref={recentPanelRef}
      className="full-player-panel"
      data-full-player-recent
      tabIndex={-1}
    >
      <div className="full-player-panel-head">
        <h3>{t('winamp.recentTracks')}</h3>
        <span>{current ? current.country || t('common.unknown') : t('common.unknown')}</span>
      </div>
      <div className="full-player-track-list">
        {recentTracks.length ? (
          recentTracks.map((item) => (
            <div className="full-player-track-row" key={item.id}>
              <strong>{item.track}</strong>
              <span>{item.stationName}</span>
            </div>
          ))
        ) : (
          <div className="full-player-empty">{t('details.recentTracksEmpty')}</div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <div
        ref={rootRef}
        className="full-player-overlay fullscreen-ui"
        data-full-player-overlay
        role="dialog"
        aria-modal="true"
        aria-label={normalizeStationName(current?.name) || t('dock.ready')}
      >
        <StationBackdrop
          station={current}
          active={player.visualizer.active}
          subscribe={player.subscribeVisualizer}
          tone="stage"
        />
        {isMobileLayout ? (
          <>
            <header className="full-player-header full-player-header--stage">
              <button
                className="full-player-icon-btn"
                type="button"
                onClick={() => winamp.setExpanded(false)}
                aria-label={t('details.close')}
              >
                <Icon>{actionIcon.collapse}</Icon>
              </button>
              {livePillState ? (
                <span className="full-player-live-pill" data-tone={livePillState.tone}>
                  <span className="full-player-live-dot" aria-hidden="true" />
                  {livePillState.label}
                </span>
              ) : (
                <span className="full-player-kicker">{queueLabel}</span>
              )}
              <div className="full-player-header-actions">
                <button
                  className={`full-player-icon-btn ${liked ? 'active' : ''}`}
                  type="button"
                  onClick={() => {
                    if (current) {
                      triggerHaptic();
                      toggleFavorite(current);
                    }
                  }}
                  disabled={!current}
                  aria-pressed={liked}
                  aria-label={liked ? t('stationTable.unfavorite') : t('stationTable.favorite')}
                >
                  <ThemeActionIcon name="like">{actionIcon.like}</ThemeActionIcon>
                </button>
                <button
                  className="full-player-icon-btn"
                  type="button"
                  onClick={() => current && shareStation(current)}
                  disabled={!current}
                  aria-label={t('common.share')}
                >
                  <Icon>{actionIcon.share}</Icon>
                </button>
              </div>
            </header>

            <main
              className="full-player-main full-player-main--stage"
              data-has-next={nextQueueStation ? 'true' : 'false'}
            >
              {/* The generated scene already fills the whole overlay behind us
                  (StationBackdrop), so a second small square of the same artwork
                  was both redundant and the single biggest consumer of a stage
                  that does not fit a phone. The photo IS the hero now. */}
              <section className="full-player-identity" aria-label={t('winamp.currentStation')}>
                <h1>{normalizeStationName(current?.name) || t('winamp.noStation')}</h1>
                <p className="full-player-place">
                  {current ? stationLocation(current) : t('winamp.buildQueue')}
                  {stationClock ? <span className="full-player-clock"> · {stationClock}</span> : null}
                </p>
              </section>

              <FullPlayerVisualizer
                active={player.visualizer.active}
                subscribe={player.subscribeVisualizer}
              />

              <section className="full-player-onair" aria-label={t('winamp.onAirNow')}>
                <span className="full-player-section-label">{t('winamp.onAirNow')}</span>
                {renderTrackButton()}
                {current ? <p className="full-player-onair-tags">{stationTags(current)}</p> : null}
              </section>

              {/* Fills the band that used to be dead space above the transport,
                  with the one fact only a radio atlas can offer. Renders nothing
                  when we have no country geometry, and the layout closes up. */}
              <StationPlaceCard station={current} label={t('winamp.onAirFrom')} />

              {renderRecentOnAir()}

              {renderTransport()}
              {renderVolume()}

              <section className="full-player-stage-pills" aria-label={t('common.actions')}>
                <button
                  className="full-player-stage-pill"
                  type="button"
                  onClick={openQueueSheet}
                  aria-label={t('winamp.queue')}
                >
                  <Icon>{actionIcon.queue}</Icon>
                  <span>{t('winamp.queue')}</span>
                </button>
                <button
                  className={`full-player-stage-pill ${sleepTimer.active ? 'active' : ''}`}
                  type="button"
                  onClick={() => {
                    triggerHaptic();
                    setSleepSheetOpen(true);
                  }}
                  aria-label={t('settings.sleepTimerLabel')}
                >
                  <Icon>{actionIcon.sleep}</Icon>
                  <span>{sleepTimer.active ? sleepLabel : t('settings.sleepTimerLabel')}</span>
                </button>
              </section>

              <div className="full-player-stage-foot">
                <span className="full-player-queue-count">
                  {t('winamp.inQueue')}: {queue.items.length}
                </span>
                <button
                  className="full-player-stage-foot-btn"
                  type="button"
                  onClick={openActionsSheet}
                  aria-label={t('dock.more')}
                >
                  <Icon>{actionIcon.more}</Icon>
                </button>
              </div>
            </main>
          </>
        ) : (
          <>
            <header className="full-player-header">
              <div>
                <span className="full-player-kicker">{queueLabel}</span>
                <h2>{normalizeStationName(current?.name) || t('dock.emptyTitle')}</h2>
              </div>
              <button
                className="full-player-icon-btn"
                type="button"
                onClick={() => winamp.setExpanded(false)}
                aria-label={t('details.close')}
              >
                <Icon>{actionIcon.close}</Icon>
              </button>
            </header>

            <main className="full-player-main">
              <section className="full-player-now" aria-label={t('winamp.currentStation')}>
                <div className="full-player-artwork-wrap">
                  <StationArtwork station={current} size="card" className="full-player-artwork" />
                </div>
                <div className="full-player-copy">
                  <p>{formatStationMeta(current, t('winamp.buildQueue'))}</p>
                  <h1>{normalizeStationName(current?.name) || t('winamp.noStation')}</h1>
                  {renderTrackButton()}
                  {listenerLine ? (
                    <p className="full-player-listeners" data-live-listeners={liveListeners}>
                      {listenerLine}
                    </p>
                  ) : null}
                </div>
              </section>

              <FullPlayerVisualizer
                active={player.visualizer.active}
                subscribe={player.subscribeVisualizer}
              />

              {renderTransport()}
              {renderVolume()}

              <section className="full-player-actions" aria-label={t('common.actions')}>
                {renderLikeChip()}
                {renderShareChip()}
                {canShareToStory() && (
                  <button
                    className="full-player-action-chip"
                    type="button"
                    onClick={() => current && shareStationToStory(current)}
                    disabled={!current}
                    aria-label={t('common.shareStory')}
                  >
                    <Icon>{actionIcon.share}</Icon>
                    <span>{t('common.shareStory')}</span>
                  </button>
                )}
                {recordAvailable && renderRecordChip()}
                <button
                  className="full-player-action-chip"
                  type="button"
                  onClick={() => current && openExternal(current)}
                  disabled={!current?.url_resolved}
                  aria-label={t('common.openBrowser')}
                >
                  <Icon>{actionIcon.external}</Icon>
                  <span>{t('common.openBrowser')}</span>
                </button>
                <button
                  className="full-player-action-chip"
                  type="button"
                  onClick={handleDetails}
                  disabled={!current || !onDetails}
                  aria-label={t('winamp.stationDetails')}
                >
                  <Icon>{actionIcon.details}</Icon>
                  <span>{t('winamp.stationDetails')}</span>
                </button>
                <button
                  className={`full-player-action-chip ${stationHidden ? 'active' : ''}`}
                  type="button"
                  onClick={handleHideStation}
                  disabled={!current}
                  aria-label={stationHidden ? t('details.showInRecommendations') : t('details.hideFromRecommendations')}
                >
                  <Icon>{actionIcon.hide}</Icon>
                  <span>{stationHidden ? t('details.showInRecommendations') : t('details.hideFromRecommendations')}</span>
                </button>
              </section>

              <section className="full-player-content-grid">
                {renderQueuePanel()}
                {renderRecentPanel()}
              </section>
            </main>
          </>
        )}
      </div>

      {isMobileLayout ? (
        <FullPlayerSheet
          open={actionsSheetOpen}
          onClose={() => setActionsSheetOpen(false)}
          kicker={queueLabel}
          title={t('common.actions')}
        >
          <div className="full-player-sheet-rows">
            <button
              className="full-player-action-row"
              type="button"
              onClick={openQueueSheet}
            >
              <Icon>{actionIcon.queue}</Icon>
              <span>{t('playlist.title')}</span>
              <em>{t('winamp.queueCount', { count: queue.items.length })}</em>
            </button>
            <button
              className={`full-player-action-row ${sleepTimer.active ? 'active' : ''}`}
              type="button"
              onClick={() => {
                setActionsSheetOpen(false);
                setSleepSheetOpen(true);
              }}
            >
              <Icon>{actionIcon.sleep}</Icon>
              <span>{t('settings.sleepTimerLabel')}</span>
              <em>{sleepLabel}</em>
            </button>
            {canShareToStory() && (
              <button
                className="full-player-action-row"
                type="button"
                onClick={() => {
                  if (current) shareStationToStory(current);
                  setActionsSheetOpen(false);
                }}
                disabled={!current}
              >
                <Icon>{actionIcon.share}</Icon>
                <span>{t('common.shareStory')}</span>
              </button>
            )}
            <button
              className="full-player-action-row"
              type="button"
              onClick={() => {
                if (current) openExternal(current);
                setActionsSheetOpen(false);
              }}
              disabled={!current?.url_resolved}
            >
              <Icon>{actionIcon.external}</Icon>
              <span>{t('common.openBrowser')}</span>
            </button>
            <button
              className="full-player-action-row"
              type="button"
              onClick={() => {
                setActionsSheetOpen(false);
                handleDetails();
              }}
              disabled={!current || !onDetails}
            >
              <Icon>{actionIcon.details}</Icon>
              <span>{t('winamp.stationDetails')}</span>
            </button>
            <button
              className={`full-player-action-row ${stationHidden ? 'active' : ''}`}
              type="button"
              onClick={() => {
                handleHideStation();
                setActionsSheetOpen(false);
              }}
              disabled={!current}
            >
              <Icon>{actionIcon.hide}</Icon>
              <span>{stationHidden ? t('details.showInRecommendations') : t('details.hideFromRecommendations')}</span>
            </button>
            <button
              className="full-player-action-row"
              type="button"
              onClick={openRecentTracksSheet}
            >
              <Icon>{actionIcon.copy}</Icon>
              <span>{t('winamp.recentTracks')}</span>
            </button>
          </div>
        </FullPlayerSheet>
      ) : null}

      {isMobileLayout ? (
        <FullPlayerSheet
          open={queueSheetTarget !== null}
          onClose={() => setQueueSheetTarget(null)}
          kicker={queueLabel}
          title={
            queueSheetTarget === 'recent' ? t('winamp.recentTracks') : t('playlist.title')
          }
          initialFocusRef={queueSheetTarget === 'recent' ? recentPanelRef : undefined}
        >
          <div className="full-player-sheet-panels">
            {renderQueuePanel()}
            {renderRecentPanel()}
          </div>
        </FullPlayerSheet>
      ) : null}

      {/* "I like this track" is a thought you have WHILE it plays. Reaching these
          links through the assistant meant opening a chat and asking; they are
          pure search urls, so the sheet needs no network at all. */}
      {isMobileLayout ? (
        <FullPlayerSheet
          open={trackSheetOpen}
          onClose={() => setTrackSheetOpen(false)}
          kicker={normalizeStationName(current?.name) || t('winamp.currentStation')}
          title={displayTrack}
        >
          <div className="full-player-sheet-rows">
            {trackServiceLinks.length > 0 ? (
              <>
                <div className="full-player-sheet-label">{t('details.openInService')}</div>
                {trackServiceLinks.map((link) => (
                  <button
                    key={link.service}
                    className="full-player-action-row"
                    type="button"
                    onClick={() => {
                      triggerHaptic();
                      openLinkOrFallback(link.url);
                      setTrackSheetOpen(false);
                    }}
                  >
                    <Icon>{actionIcon.external}</Icon>
                    <span>{link.label}</span>
                  </button>
                ))}
              </>
            ) : null}
            {canCopyTrack ? (
              <button
                className="full-player-action-row"
                type="button"
                onClick={() => {
                  triggerHaptic();
                  void copyTrack();
                  setTrackSheetOpen(false);
                }}
              >
                <Icon>{actionIcon.copy}</Icon>
                <span>{t('details.copyTrack')}</span>
              </button>
            ) : null}
          </div>
        </FullPlayerSheet>
      ) : null}

      {isMobileLayout ? (
        <FullPlayerSheet
          open={sleepSheetOpen}
          onClose={() => setSleepSheetOpen(false)}
          kicker={t('settings.sleepTitle')}
          title={t('settings.sleepTimerLabel')}
        >
          <div className="full-player-sleep-sheet">
            <SleepTimerDial
              minutes={dialMinutes}
              onChange={setDialMinutes}
              active={sleepTimer.active}
              remainingMs={sleepTimer.remainingMs}
              totalMs={(sleepTimer.minutes || dialMinutes) * 60000}
              centerLabel={
                sleepTimer.active ? formatSleepRemaining(sleepTimer.remainingMs) : `${dialMinutes}:00`
              }
            />
            {!sleepTimer.active ? (
              <div className="full-player-sleep-presets">
                {SLEEP_TIMER_PRESETS_MIN.map((min) => (
                  <button
                    key={min}
                    className={`full-player-small-chip ${dialMinutes === min ? 'active' : ''}`}
                    type="button"
                    onClick={() => setDialMinutes(min)}
                  >
                    {min} {t('settings.sleepMin')}
                  </button>
                ))}
              </div>
            ) : null}
            <button
              className="full-player-sleep-start"
              type="button"
              onClick={() => (sleepTimer.active ? cancelSleepTimer() : startSleepTimer(dialMinutes))}
            >
              {sleepTimer.active ? t('settings.sleepStop') : t('settings.sleepStart')}
            </button>
          </div>
        </FullPlayerSheet>
      ) : null}
    </>
  );
};
