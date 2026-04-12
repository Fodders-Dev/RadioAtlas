import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType } from 'react';
import { AppNavigation } from './components/AppNavigation';
import { AppScreenSkeleton } from './components/AppScreenSkeleton';
import { MiniPlayerDock } from './components/MiniPlayerDock';
import { SettingsSheet } from './components/SettingsSheet';
import { Toast } from './components/Toast';
import { buildLabel } from './lib/buildInfo';
import {
  loadAccountSheet,
  loadGlobeScreen,
  loadHomeScreen,
  loadLibraryScreen,
  loadSearchScreen,
  loadSettingsScreen,
  loadStationDetails,
  loadWinampPlayerShell
} from './lib/screenLoaders';
import { useLocale } from './state/LocaleContext';
import { useRadio } from './state/RadioContext';
import { useSession } from './state/SessionContext';
import type { AppSection } from './types';

const HomeScreen = lazy(loadHomeScreen);
const SearchScreen = lazy(loadSearchScreen);
const GlobeScreenLazy = lazy(loadGlobeScreen);
const LibraryScreen = lazy(loadLibraryScreen);
const SettingsScreen = lazy(loadSettingsScreen);
const AccountSheetLazy = lazy(loadAccountSheet);
const StationDetailsLazy = lazy(loadStationDetails);
const WinampPlayerShellLazy = lazy(loadWinampPlayerShell);

const SECTION_COMPONENTS: Record<AppSection, ComponentType> = {
  home: HomeScreen,
  search: SearchScreen,
  globe: GlobeScreenLazy,
  library: LibraryScreen
};

const App = () => {
  const { t } = useLocale();
  const { accountSheetOpen, closeAccountSheet } = useSession();
  const {
    loading,
    error,
    toast,
    player,
    nowPlaying,
    nowPlayingState,
    stations,
    favorites,
    queue,
    winamp,
    activeSection,
    setActiveSection,
    playerPresentation,
    detailsOpen,
    setDetailsOpen
  } = useRadio();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sectionMotionTick, setSectionMotionTick] = useState(0);
  const versionLabel = buildLabel();

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

  const sectionMeta = useMemo(
    () => ({
      home: {
        title: t('nav.home'),
        subtitle: t('home.topbarSubtitle'),
        context: t('home.topbarContext')
      },
      search: {
        title: t('nav.search'),
        subtitle: t('search.topbarSubtitle'),
        context: t('search.kicker')
      },
      globe: {
        title: t('nav.globe'),
        subtitle: t('explore.globeSubtitle'),
        context: t('globe.heroSubtitle')
      },
      library: {
        title: t('nav.library'),
        subtitle: t('library.topbarSubtitle'),
        context: t('library.kicker')
      }
    }),
    [t]
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

  return (
    <div
      className="app-shell-v2"
      data-player-presentation={playerPresentation}
      data-winamp-expanded={winamp.expanded ? 'true' : 'false'}
      data-active-section={activeSection}
    >
      <AppNavigation
        active={activeSection}
        onChange={setActiveSection}
        onSettings={() => setSettingsOpen(true)}
        onPreload={(section) => {
          if (section === 'home') void loadHomeScreen();
          if (section === 'search') void loadSearchScreen();
          if (section === 'globe') void loadGlobeScreen();
          if (section === 'library') void loadLibraryScreen();
        }}
      />

      <div className="app-content-shell">
        <header className="glass-card app-topbar-v2 motion-rise">
          <div className="app-topbar-copy">
            <div className="app-topbar-brandline">
              <div className="app-brand-pill" title={t('app.title')}>
                <span className="app-brand-mark">R++</span>
                <span>{t('app.title')}</span>
              </div>
              <div className="app-topbar-context">{meta.context}</div>
            </div>
            <div className="app-topbar-title">{meta.title}</div>
            <div className="app-topbar-subtitle">{meta.subtitle}</div>
            <div className="app-topbar-meta-row">
              <div className="app-topbar-stat">{t('app.catalogCount', { count: stations.length })}</div>
              <div className="app-topbar-stat">{t('app.favoritesCount', { count: favorites.length })}</div>
              <div
                className={`app-topbar-stat ${player.current ? 'active' : ''}`}
                title={player.current ? liveStatusLabel : t('app.queueCount', { count: queue.items.length })}
              >
                {player.current ? liveStatusLabel : t('app.queueCount', { count: queue.items.length })}
              </div>
            </div>
          </div>
          <div className="app-topbar-actions">
            {player.current ? (
              <button className="nav-utility-btn app-topbar-action" type="button" onClick={() => setDetailsOpen(true)}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M11 10h2v7h-2v-7Zm0-4h2v2h-2V6Zm1 16a10 10 0 1 1 0-20 10 10 0 0 1 0 20Zm0-18a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z" />
                </svg>
                <span>{t('common.info')}</span>
              </button>
            ) : null}
            <div className="app-build-pill" title={versionLabel}>
              {versionLabel}
            </div>
            <button
              className="nav-utility-btn mobile-settings-trigger"
              type="button"
              onMouseEnter={() => void loadSettingsScreen()}
              onFocus={() => void loadSettingsScreen()}
              onClick={() => setSettingsOpen(true)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M19.14 12.94c.04-.31.06-.62.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.88 2h-3.76a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.13.54-1.63.94l-2.39-.96a.5.5 0 0 0-.61.22L2.72 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.62-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .61.22l2.39-.96c.5.4 1.05.71 1.63.94l.36 2.54a.5.5 0 0 0 .49.42h3.76a.5.5 0 0 0 .49-.42l.36-2.54c.58-.23 1.13-.54 1.63-.94l2.39.96a.5.5 0 0 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z" />
              </svg>
              <span>{t('nav.settings')}</span>
            </button>
          </div>
        </header>

        <main className="app-stage-v2">
          {error ? <div className="error">{error}</div> : null}
          {loading ? (
            screenFallback
          ) : (
            <div
              className={`app-screen-frame ${sectionMotionTick % 2 === 0 ? 'page-enter-a' : 'page-enter-b'}`}
            >
              <Suspense fallback={screenFallback}>
                <ActiveScreen />
              </Suspense>
            </div>
          )}
        </main>
      </div>

      <MiniPlayerDock />
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
      {accountSheetOpen ? (
        <Suspense fallback={null}>
          <AccountSheetLazy open={accountSheetOpen} onClose={closeAccountSheet} />
        </Suspense>
      ) : null}
      {winamp.expanded ? (
        <Suspense fallback={<AppScreenSkeleton section={activeSection} scope="overlay" />}>
          <WinampPlayerShellLazy onDetails={() => setDetailsOpen(true)} />
        </Suspense>
      ) : null}
      <Toast message={toast} />
    </div>
  );
};

export default App;
