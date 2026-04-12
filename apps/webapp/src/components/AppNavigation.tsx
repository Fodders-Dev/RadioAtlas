import type { AppSection } from '../types';
import { useLocale } from '../state/LocaleContext';

type NavItem = {
  id: AppSection;
  icon: JSX.Element;
};

const NAV_ITEMS: NavItem[] = [
  {
    id: 'home',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3 3 10.2V21h6.3v-6.3h5.4V21H21V10.2L12 3Z" />
      </svg>
    )
  },
  {
    id: 'search',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10.5 4a6.5 6.5 0 1 0 4.05 11.58l4.44 4.44 1.41-1.41-4.44-4.44A6.5 6.5 0 0 0 10.5 4Zm0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Z" />
      </svg>
    )
  },
  {
    id: 'globe',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.9 9h-3.03a15.93 15.93 0 0 0-1.42-5.03A8.03 8.03 0 0 1 18.9 11ZM12 4.05c1.14 1.32 2.24 3.6 2.75 6.95H9.25C9.76 7.65 10.86 5.37 12 4.05ZM9.55 5.97A15.93 15.93 0 0 0 8.13 11H5.1a8.03 8.03 0 0 1 4.45-5.03ZM5.1 13h3.03a15.93 15.93 0 0 0 1.42 5.03A8.03 8.03 0 0 1 5.1 13Zm6.9 6.95c-1.14-1.32-2.24-3.6-2.75-6.95h5.5c-.51 3.35-1.61 5.63-2.75 6.95Zm2.45-1.92A15.93 15.93 0 0 0 15.87 13h3.03a8.03 8.03 0 0 1-4.45 5.03Z" />
      </svg>
    )
  },
  {
    id: 'library',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v2H6.5a.5.5 0 0 0 0 1H18v2H6.5a2.5 2.5 0 0 1-1.5-.5V18a3 3 0 0 0 3 3H20v-2H8a1 1 0 1 1 0-2h10V9H6.5A2.5 2.5 0 0 1 4 6.5v-1Z" />
      </svg>
    )
  }
];

type AppNavigationProps = {
  active: AppSection;
  onChange: (section: AppSection) => void;
  onSettings: () => void;
  onPreload?: (section: AppSection) => void;
};

export const AppNavigation = ({ active, onChange, onSettings, onPreload }: AppNavigationProps) => {
  const { t } = useLocale();

  return (
    <>
      <aside className="app-navigation app-navigation-desktop" aria-label="Primary navigation">
        <div className="nav-brand">
          <div className="nav-brand-mark">R++</div>
          <div>
            <div className="nav-brand-title">{t('app.title')}</div>
            <div className="nav-brand-copy">{t('app.subtitle')}</div>
          </div>
        </div>

        <nav className="nav-list">
          {NAV_ITEMS.map((item) => (
            <button
            key={item.id}
            className={`nav-rail-item ${active === item.id ? 'active' : ''}`}
            type="button"
            onClick={() => onChange(item.id)}
            onMouseEnter={() => onPreload?.(item.id)}
            onFocus={() => onPreload?.(item.id)}
          >
              <span className="nav-rail-icon">{item.icon}</span>
              <span>{t(`nav.${item.id}`)}</span>
            </button>
          ))}
        </nav>

        <button className="nav-utility-btn" type="button" onClick={onSettings}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19.14 12.94c.04-.31.06-.62.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.88 2h-3.76a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.13.54-1.63.94l-2.39-.96a.5.5 0 0 0-.61.22L2.72 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.62-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .61.22l2.39-.96c.5.4 1.05.71 1.63.94l.36 2.54a.5.5 0 0 0 .49.42h3.76a.5.5 0 0 0 .49-.42l.36-2.54c.58-.23 1.13-.54 1.63-.94l2.39.96a.5.5 0 0 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z" />
          </svg>
          <span>{t('nav.settings')}</span>
        </button>
      </aside>

      <nav className="app-navigation-mobile" aria-label="Primary navigation">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`mobile-nav-item ${active === item.id ? 'active' : ''}`}
            type="button"
            onClick={() => onChange(item.id)}
            onTouchStart={() => onPreload?.(item.id)}
            onFocus={() => onPreload?.(item.id)}
          >
            <span className="mobile-nav-icon">{item.icon}</span>
            <span>{t(`nav.${item.id}`)}</span>
          </button>
        ))}
      </nav>
    </>
  );
};
