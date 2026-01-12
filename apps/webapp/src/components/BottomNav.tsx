export type NavTab = 'Explore' | 'Favorites' | 'Browse' | 'Search' | 'Settings';

type NavItem = {
  id: NavTab;
  label: string;
};

const NAV_ITEMS: NavItem[] = [
  { id: 'Explore', label: 'Explore' },
  { id: 'Favorites', label: 'Favorites' },
  { id: 'Browse', label: 'Random' },
  { id: 'Search', label: 'Search' },
  { id: 'Settings', label: 'Settings' }
];

export const BottomNav = ({
  active,
  onChange
}: {
  active: NavTab;
  onChange: (tab: NavTab) => void;
}) => (
  <nav className="bottom-nav">
    {NAV_ITEMS.map((item) => (
      <button
        key={item.id}
        className={`nav-item ${active === item.id ? 'active' : ''}`}
        onClick={() => onChange(item.id)}
        type="button"
      >
        <span className="nav-dot" />
        <span>{item.label}</span>
      </button>
    ))}
  </nav>
);
