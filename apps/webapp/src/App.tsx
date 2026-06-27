import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { AppScreenSkeleton } from './components/AppScreenSkeleton';
import { ErrorBoundary, ErrorProbe, ScreenErrorFallback } from './components/ErrorBoundary';
import { reportClientEvent, reportError } from './lib/observability';
import { SettingsSheet } from './components/SettingsSheet';
import { ThemeDecorations } from './components/ThemeDecorations';
import { Toast } from './components/Toast';
import { buildLabel } from './lib/buildInfo';
import { isAiAssistantEnabled } from './lib/aiChat';
import { getDeviceProfile } from './lib/deviceProfile';
import { reportProductEvent } from './lib/productAnalytics';
import { useCompactLayout } from './lib/useCompactLayout';
import { useTelegramViewport } from './lib/useTelegramViewport';
import {
  loadAccountSheet,
  loadGlobeScreen,
  loadHomeScreen,
  loadLibraryScreen,
  loadSearchScreen,
  loadSettingsScreen,
  loadStationDetails
} from './lib/screenLoaders';
import { getStartParam, isInsideTelegramClient, parseStationParam } from './lib/telegram';
import { useLocale } from './state/LocaleContext';
import { useCatalog } from './state/CatalogContext';
import { usePlayback, useShell } from './state/RadioContext';
import { useSession } from './state/SessionContext';
import type { AppSection, LibraryTab } from './types';

const HomeScreen = lazy(loadHomeScreen);
const SearchScreen = lazy(loadSearchScreen);
const GlobeScreenLazy = lazy(loadGlobeScreen);
const LibraryScreen = lazy(loadLibraryScreen);
const SettingsScreen = lazy(loadSettingsScreen);
const AppNavigationLazy = lazy(() =>
  import('./components/AppNavigation').then((mod) => ({ default: mod.AppNavigation }))
);
const MiniPlayerDockLazy = lazy(() =>
  import('./components/MiniPlayerDock').then((mod) => ({ default: mod.MiniPlayerDock }))
);
const AccountSheetLazy = lazy(loadAccountSheet);
const StationDetailsLazy = lazy(loadStationDetails);
const LitePlayerOverlayLazy = lazy(() =>
  import('./components/LitePlayerOverlay').then((mod) => ({ default: mod.LitePlayerOverlay }))
);
const FullPlayerOverlayLazy = lazy(() =>
  import('./components/FullPlayerOverlay').then((mod) => ({ default: mod.FullPlayerOverlay }))
);
const ThemeStudioSheetLazy = lazy(() =>
  import('./components/ThemeStudio').then((mod) => ({ default: mod.ThemeStudioSheet }))
);
// «Лира» chat — lifted to the shell so the central nav button opens it from ANY
// screen. Lazy so AI-off bundles never pull it in.
const ChatSheetLazy = lazy(() =>
  import('./components/ChatSheet').then((mod) => ({ default: mod.ChatSheet }))
);

const SECTION_COMPONENTS: Record<AppSection, ComponentType> = {
  home: HomeScreen,
  search: SearchScreen,
  globe: GlobeScreenLazy,
  library: LibraryScreen
};

const App = () => {
  const { t } = useLocale();
  const { accountSheetOpen, closeAccountSheet, openAccountSheet, status: sessionStatus } = useSession();
  const { summary, fetchStationById } = useCatalog();
  const { player, nowPlaying, nowPlayingState, queue, playStation } = usePlayback();
  const {
    toast,
    winamp,
    activeSection,
    setActiveSection,
    playerPresentation,
    setLibraryTab,
    detailsOpen,
    setDetailsOpen,
    skinLabOpen,
    setSkinLabOpen
  } = useShell();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // «Лира» chat lives at the shell level so the central nav button opens it from
  // any screen. Gated on VITE_AI_ENABLED (same flag as the rest of the feature).
  const aiAssistantEnabled = isAiAssistantEnabled();
  const [chatOpen, setChatOpen] = useState(false);
  const [sectionMotionTick, setSectionMotionTick] = useState(0);
  const startHandledRef = useRef(false);
  // T_deeplink_lifecycle_fix: the deep-link effect runs once on mount (deps []),
  // so it can't read fresh handler identities through its closure. Mirror them in
  // a ref updated every render and read ref.current at point of use — fetch at
  // call time, playStation + t at play time (so the label uses the loaded
  // dictionary).
  const deepLinkHandlersRef = useRef({ fetchStationById, playStation, t });
  deepLinkHandlersRef.current = { fetchStationById, playStation, t };
  const activeSectionRef = useRef(activeSection);
  const brandGestureRef = useRef({ count: 0, startedAt: 0 });
  const sessionStartedAtRef = useRef(Date.now());
  const sessionDurationReportedRef = useRef(false);
  const versionLabel = buildLabel();
  const isCompactLayout = useCompactLayout();
  // PR-2: keep the CSS shell in sync with the live Telegram webview viewport +
  // safe-area (and visualViewport outside Telegram) so nothing overlaps when the
  // header/keyboard resize the usable height after mount.
  useTelegramViewport();
  const lowPowerShell = useMemo(() => getDeviceProfile().lowPower, []);
  const legacyWinampQuery = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('winamp') === '1';
  }, []);
  const [legacyWinampUnlocked, setLegacyWinampUnlocked] = useState(false);
  const legacyWinampOverlay = legacyWinampQuery || legacyWinampUnlocked;

  useEffect(() => {
    activeSectionRef.current = activeSection;
  }, [activeSection]);

  useEffect(() => {
    const viewportWidth = typeof window === 'undefined' ? 0 : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight;
    reportProductEvent(
      'app_opened',
      {
        initialSection: activeSectionRef.current,
        compact: isCompactLayout,
        lowPower: lowPowerShell,
        viewportWidth,
        viewportHeight,
        telegram: isInsideTelegramClient()
      },
      {
        dedupeKey: 'app_opened',
        dedupeMs: 60_000
      }
    );

    const reportDuration = () => {
      if (sessionDurationReportedRef.current) return;
      sessionDurationReportedRef.current = true;
      reportProductEvent(
        'session_duration',
        {
          durationMs: Date.now() - sessionStartedAtRef.current,
          lastSection: activeSectionRef.current
        },
        {
          dedupeKey: `session_duration:${sessionStartedAtRef.current}`
        }
      );
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        reportDuration();
      }
    };
    window.addEventListener('pagehide', reportDuration);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', reportDuration);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      reportDuration();
    };
  }, [isCompactLayout, lowPowerShell]);

  useEffect(() => {
    if (!player.current && detailsOpen) {
      setDetailsOpen(false);
    }
  }, [detailsOpen, player.current, setDetailsOpen]);

  useEffect(() => {
    if (winamp.expanded) {
      setSettingsOpen(false);
    }
  }, [winamp.expanded]);

  useEffect(() => {
    setSectionMotionTick((value) => value + 1);
  }, [activeSection]);

  useEffect(() => {
    // T_deeplink_lifecycle_fix: run ONCE on mount (deps []) and never cancel the
    // in-flight play. Telemetry (PR #41) proved the bug: deeplink_enter fired but
    // deeplink_play/error never did → the async play hit a cancelled
    // guard. The old effect depended on [fetchStationById, playStation, t]; those
    // handler identities change during boot (session-auth/summary/theme
    // re-renders), so the effect re-ran, its cleanup set cancelled=true on the
    // in-flight fetch, and the re-run bailed via startHandledRef without
    // restarting → the play was permanently abandoned. With [] + handlers read
    // from a ref, re-renders can't re-invoke or cancel it. We also keep NO
    // cancelling cleanup: the play is a one-shot guarded by startHandledRef, and
    // a StrictMode dev remount (or a genuine teardown) must not abandon it — a
    // late playStation on an unmounting App root is a harmless no-op.
    if (startHandledRef.current) return;
    startHandledRef.current = true;

    const startParam = getStartParam();
    // T_deeplink_telemetry (lean funnel): enter (a real deep-link open) -> play
    // {stationId} on success; deeplink_error{reason} on a terminal fail so a
    // broken Story-widget deep link stays visible. No start param = a normal app
    // open (indistinguishable from a lost-param tap), so it emits nothing.
    if (!startParam) return;

    // T_share_4: ref_<inviterId> (referral) and link_<code> (account link) deep
    // links are consumed SERVER-SIDE during auth — the client has no station to
    // play. Skip the station-play effect (and the deeplink_* funnel) for them so
    // a referral open never fires a bogus deeplink_error{not_found}.
    if (startParam.startsWith('ref_') || startParam.startsWith('link_')) return;

    reportClientEvent('deeplink_enter', { dedupeKey: 'deeplink_enter' });

    const stationId = parseStationParam(startParam);
    if (!stationId) {
      reportClientEvent('deeplink_error', {
        dedupeKey: 'deeplink_error',
        meta: { reason: 'parse_failed' }
      });
      return;
    }

    void (async () => {
      const handlers = deepLinkHandlersRef.current;
      try {
        // The by-id lookup now retries the transient cold-boot 5xx for ALL
        // playbacks (see fetchStationById), so a shared station resolves and
        // plays instead of silently bailing.
        const station = await handlers.fetchStationById(stationId);
        if (!station) {
          reportClientEvent('deeplink_error', {
            dedupeKey: 'deeplink_error',
            meta: { reason: 'not_found' }
          });
          return;
        }
        reportClientEvent('deeplink_play', {
          dedupeKey: 'deeplink_play',
          meta: { stationId }
        });
        // Read playStation + t from the ref at PLAY time (latest identities; the
        // dictionary is loaded by now, so the label is translated).
        deepLinkHandlersRef.current.playStation(station, {
          sourceId: 'deep-link',
          sourceLabel: deepLinkHandlersRef.current.t('radio.deepLink')
        });
      } catch {
        reportClientEvent('deeplink_error', {
          dedupeKey: 'deeplink_error',
          meta: { reason: 'fetch_failed' }
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sectionMeta = useMemo(
    () => ({
      home: {
        // T2.20: Home density pass — the topbar kicker/subtitle were decorative
        // copy that pushed the first tile down. Blank them (the "Главная" title
        // and topbar height stay) so the feed starts higher.
        title: t('nav.home'),
        subtitle: '',
        context: ''
      },
      search: {
        title: t('nav.search'),
        subtitle: t('search.topbarSubtitle'),
        context: isCompactLayout ? '' : t('search.kicker')
      },
      globe: {
        title: t('nav.globe'),
        subtitle: t('explore.globeSubtitle'),
        context: isCompactLayout ? '' : t('globe.heroSubtitle')
      },
      library: {
        title: t('nav.library'),
        subtitle: t('library.topbarSubtitle'),
        context: t('library.kicker')
      }
    }),
    [isCompactLayout, t]
  );

  const ActiveScreen = SECTION_COMPONENTS[activeSection];
  const meta = sectionMeta[activeSection];
  const screenFallback = <AppScreenSkeleton section={activeSection} />;
  const liveStatusLabel = player.current
    ? nowPlaying
      ? `${t('app.nowPlayingLabel')}: ${nowPlaying}`
      : player.failure
        ? `${t('app.playbackIssue')}: ${player.failure.message}`
        : nowPlayingState.status === 'loading'
          ? t('common.loading')
          : t('app.metadataUnavailable')
    : t('app.queueCount', { count: queue.items.length });
  const primaryActionTitle =
    sessionStatus === 'authenticated' ? t('account.title') : t('account.signInAndSync');
  const topbarSignalLabel = queue.items.length
    ? t('playlist.title')
    : player.current
      ? t('app.liveBadge')
      : t('nav.search');
  const topbarSignalValue = queue.items.length
    ? t('app.queueCount', { count: queue.items.length })
    : player.current
      ? nowPlaying || player.current.name || t('dock.liveNow')
      : t('app.catalogCount', { count: summary?.counts.stations || 0 });

  const openLibraryTab = (tab: LibraryTab) => {
    setLibraryTab(tab);
    setActiveSection('library');
  };
  const handleSectionChange = (section: AppSection) => {
    if (section === 'library') {
      setLibraryTab('favorites');
    }
    setActiveSection(section);
  };
  const handleBrandGesture = () => {
    const now = Date.now();
    const previous = brandGestureRef.current;
    const count = now - previous.startedAt > 2_400 ? 1 : previous.count + 1;
    brandGestureRef.current = {
      count,
      startedAt: count === 1 ? now : previous.startedAt
    };
    if (count < 5) return;
    brandGestureRef.current = { count: 0, startedAt: 0 };
    setLegacyWinampUnlocked(true);
    winamp.setExpanded(true);
  };

  return (
    <div
      className="app-shell-v2"
      data-low-power={lowPowerShell ? 'true' : 'false'}
      data-player-presentation={playerPresentation}
      data-winamp-expanded={winamp.expanded ? 'true' : 'false'}
      data-active-section={activeSection}
    >
      <ThemeDecorations />
      <Suspense fallback={null}>
        <AppNavigationLazy
          active={activeSection}
          onChange={handleSectionChange}
          onSettings={() => setSettingsOpen(true)}
          onOpenChat={aiAssistantEnabled ? () => setChatOpen(true) : undefined}
          onPreload={(section) => {
            if (section === 'home') void loadHomeScreen();
            if (section === 'search') void loadSearchScreen();
            if (section === 'globe') void loadGlobeScreen();
            if (section === 'library') void loadLibraryScreen();
          }}
        />
      </Suspense>

      <div className="app-content-shell">
        <header className={`glass-card app-topbar-v2 ${lowPowerShell ? '' : 'motion-rise'}`.trim()}>
          <div className="app-topbar-copy">
            <div className="app-topbar-brandline">
              <button
                className="app-brand-pill"
                data-winamp-easter-egg-trigger="brand"
                onClick={handleBrandGesture}
                title={`${t('app.title')} • ${versionLabel}`}
                type="button"
              >
                <span className="app-brand-mark">R++</span>
                <span>{t('app.title')}</span>
              </button>
            </div>
            <div className="app-topbar-main-row">
              <div
                className="app-topbar-title-stack"
                data-winamp-easter-egg-trigger="title"
                onClick={handleBrandGesture}
              >
                <div className="shell-kicker">{meta.context}</div>
                <div className="app-topbar-title">{meta.title}</div>
              </div>
              <div className="app-topbar-utility-row">
                <button
                  className={`app-topbar-status-chip ${player.current ? 'is-live' : ''}`}
                  type="button"
                  onClick={() => {
                    if (queue.items.length) {
                      openLibraryTab('queue');
                      return;
                    }
                    if (player.current) {
                      void player.toggle();
                      return;
                    }
                    setActiveSection('search');
                  }}
                  title={liveStatusLabel}
                >
                  <span>{topbarSignalLabel}</span>
                  <strong>{topbarSignalValue}</strong>
                </button>
              </div>
            </div>
          </div>
          <div className="app-topbar-actions">
            <button
              className="nav-utility-btn nav-utility-btn-icon mobile-settings-trigger"
              type="button"
              aria-label={t('nav.settings')}
              onMouseEnter={() => void loadSettingsScreen()}
              onFocus={() => void loadSettingsScreen()}
              onClick={() => setSettingsOpen(true)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M19.14 12.94c.04-.31.06-.62.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.88 2h-3.76a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.13.54-1.63.94l-2.39-.96a.5.5 0 0 0-.61.22L2.72 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.62-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .61.22l2.39-.96c.5.4 1.05.71 1.63.94l.36 2.54a.5.5 0 0 0 .49.42h3.76a.5.5 0 0 0 .49-.42l.36-2.54c.58-.23 1.13-.54 1.63-.94l2.39.96a.5.5 0 0 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z" />
              </svg>
              <span>{t('nav.settings')}</span>
            </button>
            <button
              className={`nav-utility-btn nav-utility-btn-icon app-topbar-action app-topbar-primary-cta ${
                sessionStatus === 'authenticated' ? 'is-live' : ''
              }`}
              type="button"
              aria-label={primaryActionTitle}
              onMouseEnter={() => void loadAccountSheet()}
              onFocus={() => void loadAccountSheet()}
              onClick={openAccountSheet}
              title={primaryActionTitle}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-3.45 0-7 1.73-7 4.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1.5c0-2.77-3.55-4.5-7-4.5Z" />
              </svg>
              <span>{primaryActionTitle}</span>
            </button>
          </div>
        </header>

        <main className="app-stage-v2">
          <div
            className={`app-screen-frame ${
              lowPowerShell ? '' : sectionMotionTick % 2 === 0 ? 'page-enter-a' : 'page-enter-b'
            }`.trim()}
          >
            <ErrorBoundary
              key={activeSection}
              onError={(error, info) =>
                reportError(error, info, { boundary: 'screen', section: activeSection })
              }
              fallback={(retry) => (
                <ScreenErrorFallback onRetry={retry} onHome={() => setActiveSection('home')} />
              )}
            >
              <ErrorProbe />
              <Suspense fallback={screenFallback}>
                <ActiveScreen />
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>

      <Suspense fallback={null}>
        <MiniPlayerDockLazy />
      </Suspense>
      {detailsOpen ? (
        <Suspense fallback={null}>
          <StationDetailsLazy open={detailsOpen} onClose={() => setDetailsOpen(false)} />
        </Suspense>
      ) : null}
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <Suspense fallback={<AppScreenSkeleton section={activeSection} scope="sheet" />}>
          <SettingsScreen />
        </Suspense>
      </SettingsSheet>
      {skinLabOpen ? (
        <Suspense fallback={null}>
          <ThemeStudioSheetLazy open={skinLabOpen} onClose={() => setSkinLabOpen(false)} />
        </Suspense>
      ) : null}
      {accountSheetOpen ? (
        <Suspense fallback={null}>
          <AccountSheetLazy open={accountSheetOpen} onClose={closeAccountSheet} />
        </Suspense>
      ) : null}
      {aiAssistantEnabled ? (
        <Suspense fallback={null}>
          <ChatSheetLazy open={chatOpen} onClose={() => setChatOpen(false)} />
        </Suspense>
      ) : null}
      {winamp.expanded ? (
        <Suspense fallback={<AppScreenSkeleton section={activeSection} scope="overlay" />}>
          {legacyWinampOverlay ? (
            <LitePlayerOverlayLazy onDetails={() => setDetailsOpen(true)} />
          ) : (
            <FullPlayerOverlayLazy onDetails={() => setDetailsOpen(true)} />
          )}
        </Suspense>
      ) : null}
      <Toast message={toast} />
    </div>
  );
};

export default App;
