import { useLocale } from '../state/LocaleContext';

export type NavTab = 'Explore' | 'Favorites' | 'Discover' | 'Playlist' | 'Settings';

type NavItem = {
  id: NavTab;
};

export const NAV_ITEMS: NavItem[] = [
  { id: 'Explore' },
  { id: 'Favorites' },
  { id: 'Discover' },
  { id: 'Playlist' },
  { id: 'Settings' }
];

export const BottomNav = ({
  active,
  onChange
}: {
  active: NavTab;
  onChange: (tab: NavTab) => void;
}) => {
  const { t } = useLocale();

  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          className={`nav-item ${active === item.id ? 'active' : ''}`}
          onClick={() => onChange(item.id)}
          type="button"
        >
          <span className="nav-dot" />
          <span>{t(`nav.${item.id}`)}</span>
        </button>
      ))}
    </nav>
  );
};
