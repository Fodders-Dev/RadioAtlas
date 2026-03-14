import { useEffect, useMemo, useRef, useState, type TouchEventHandler } from 'react';
import { BottomNav, NAV_ITEMS, type NavTab } from './components/BottomNav';
import { WinampPlayerShell } from './components/WinampPlayerShell';
import { StationDetails } from './components/StationDetails';
import { Toast } from './components/Toast';
import { Explore } from './screens/Explore';
import { Favorites } from './screens/Favorites';
import { Discover } from './screens/Search';
import { Playlist } from './screens/Playlist';
import { Settings } from './screens/Settings';
import { useRadio } from './state/RadioContext';
import { useLocale } from './state/LocaleContext';
import { buildLabel } from './lib/buildInfo';

const TAB_COMPONENTS: Record<NavTab, () => JSX.Element> = {
  Explore: () => <Explore />,
  Favorites: () => <Favorites />,
  Discover: () => <Discover />,
  Playlist: () => <Playlist />,
  Settings: () => <Settings />
};

const MOBILE_SWIPE_MAX_WIDTH = 720;
const SWIPE_THRESHOLD = 56;
const SWIPE_DOMINANCE_RATIO = 1.25;
const SWIPE_TRANSITION_MS = 280;
const SWIPE_IGNORE_SELECTOR = [
  'input',
  'select',
  'textarea',
  'button',
  'a',
  '.globe-wrap',
  '.station-table',
  '.browse-card',
  '.browse-list-item',
  '.pick-item',
  '.track-card',
  '.settings-card',
  '.winamp-compact',
  '.bottom-nav',
  '[role="dialog"]'
].join(', ');

type SwipeTransitionState = {
  direction: -1 | 1;
};

const App = () => {
  const [activeTab, setActiveTab] = useState<NavTab>('Explore');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [swipeTransition, setSwipeTransition] = useState<SwipeTransitionState | null>(null);
  const { loading, error, toast, player, winamp } = useRadio();
  const { t } = useLocale();
  const versionLabel = buildLabel();
  const mainRef = useRef<HTMLElement | null>(null);
  const swipeTransitionTimeoutRef = useRef<number | null>(null);
  const swipeRef = useRef({
    blocked: false,
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0
  });
  const tabOrder = useMemo(() => NAV_ITEMS.map((item) => item.id), []);

  useEffect(() => {
    if (!player.current) {
      setDetailsOpen(false);
    }
  }, [player.current]);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [activeTab]);

  useEffect(() => {
    return () => {
      if (swipeTransitionTimeoutRef.current !== null) {
        window.clearTimeout(swipeTransitionTimeoutRef.current);
      }
    };
  }, []);

  const changeTab = (nextTab: NavTab, animateSwipe = false) => {
    if (nextTab === activeTab && !swipeTransition) return;

    const currentIndex = tabOrder.indexOf(activeTab);
    const nextIndex = tabOrder.indexOf(nextTab);
    const direction =
      currentIndex !== -1 && nextIndex !== -1 && nextIndex < currentIndex ? -1 : 1;

    if (swipeTransitionTimeoutRef.current !== null) {
      window.clearTimeout(swipeTransitionTimeoutRef.current);
      swipeTransitionTimeoutRef.current = null;
    }

    if (animateSwipe) {
      setSwipeTransition({
        direction
      });
      swipeTransitionTimeoutRef.current = window.setTimeout(() => {
        setSwipeTransition(null);
        swipeTransitionTimeoutRef.current = null;
      }, SWIPE_TRANSITION_MS);
    } else {
      setSwipeTransition(null);
    }

    setActiveTab(nextTab);
    mainRef.current?.scrollTo({ top: 0, behavior: animateSwipe ? 'auto' : 'smooth' });
  };

  const goToAdjacentTab = (direction: -1 | 1) => {
    if (swipeTransition) return;
    const currentIndex = tabOrder.indexOf(activeTab);
    if (currentIndex === -1) return;
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= tabOrder.length) return;
    changeTab(tabOrder[nextIndex], true);
  };

  const handleTouchStart: TouchEventHandler<HTMLElement> = (event) => {
    const touch = event.touches[0];
    if (!touch) return;
    const target = event.target as HTMLElement | null;
    swipeRef.current = {
      blocked:
        window.innerWidth > MOBILE_SWIPE_MAX_WIDTH ||
        Boolean(target?.closest(SWIPE_IGNORE_SELECTOR)),
      startX: touch.clientX,
      startY: touch.clientY,
      endX: touch.clientX,
      endY: touch.clientY
    };
  };

  const handleTouchMove: TouchEventHandler<HTMLElement> = (event) => {
    const touch = event.touches[0];
    if (!touch || swipeRef.current.blocked) return;
    swipeRef.current.endX = touch.clientX;
    swipeRef.current.endY = touch.clientY;
  };

  const handleTouchEnd: TouchEventHandler<HTMLElement> = () => {
    const swipe = swipeRef.current;
    if (swipe.blocked || window.innerWidth > MOBILE_SWIPE_MAX_WIDTH) return;
    const deltaX = swipe.endX - swipe.startX;
    const deltaY = swipe.endY - swipe.startY;
    if (Math.abs(deltaX) < SWIPE_THRESHOLD) return;
    if (Math.abs(deltaX) <= Math.abs(deltaY) * SWIPE_DOMINANCE_RATIO) return;
    goToAdjacentTab(deltaX < 0 ? 1 : -1);
  };

  const transitionDirectionClass =
    swipeTransition?.direction === -1 ? 'swipe-dir-prev' : 'swipe-dir-next';
  const ActiveScreen = TAB_COMPONENTS[activeTab];

  return (
    <div
      className="app"
      data-winamp-expanded={winamp.expanded ? 'true' : 'false'}
      data-active-tab={activeTab}
    >
      <header className="app-header">
        <div>
          <div className="app-title">{t('app.title')}</div>
          <div className="app-subtitle">{t('app.subtitle')}</div>
        </div>
        <div className="app-badge" title={versionLabel}>
          {t('app.liveBadge')} | {versionLabel}
        </div>
      </header>

      <div className="app-shell">
        <main
          className="app-main"
          ref={mainRef}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {loading && <div className="loading">Loading stations...</div>}
          {error && <div className="error">{error}</div>}
          <div
            className={`tab-stage ${swipeTransition ? `transitioning ${transitionDirectionClass}` : ''}`}
          >
            <div className="tab-pane tab-pane-active">
              <ActiveScreen />
            </div>
          </div>
        </main>

        <aside className="app-rail" aria-label="Player rail">
          <WinampPlayerShell onDetails={() => setDetailsOpen(true)} />
        </aside>
      </div>

      <BottomNav active={activeTab} onChange={(tab) => changeTab(tab)} />
      <StationDetails open={detailsOpen} onClose={() => setDetailsOpen(false)} />
      <Toast message={toast} />
    </div>
  );
};

export default App;
