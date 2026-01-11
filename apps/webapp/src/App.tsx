import { useEffect, useState } from 'react';
import { BottomNav, type NavTab } from './components/BottomNav';
import { MiniPlayer } from './components/MiniPlayer';
import { StationDetails } from './components/StationDetails';
import { Toast } from './components/Toast';
import { Explore } from './screens/Explore';
import { Favorites } from './screens/Favorites';
import { Browse } from './screens/Browse';
import { Search } from './screens/Search';
import { Settings } from './screens/Settings';
import { useRadio } from './state/RadioContext';

const TAB_COMPONENTS: Record<NavTab, JSX.Element> = {
  Explore: <Explore />,
  Favorites: <Favorites />,
  Browse: <Browse />,
  Search: <Search />,
  Settings: <Settings />
};

const App = () => {
  const [activeTab, setActiveTab] = useState<NavTab>('Explore');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { loading, error, toast, player } = useRadio();

  useEffect(() => {
    if (!player.current) {
      setDetailsOpen(false);
    }
  }, [player.current]);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <div className="app-title">RadioAtlas</div>
          <div className="app-subtitle">
            Find, favorite, and travel the world by sound.
          </div>
        </div>
        <div className="app-badge">Live</div>
      </header>

      <main>
        {loading && <div className="loading">Loading stations...</div>}
        {error && <div className="error">{error}</div>}
        {TAB_COMPONENTS[activeTab]}
      </main>

      <BottomNav active={activeTab} onChange={setActiveTab} />
      <MiniPlayer onDetails={() => setDetailsOpen(true)} />
      <StationDetails open={detailsOpen} onClose={() => setDetailsOpen(false)} />
      <Toast message={toast} />
    </div>
  );
};

export default App;
