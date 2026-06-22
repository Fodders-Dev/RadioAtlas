import type { StationBadgeState } from '../lib/stationStatusBadge';
import { useLocale } from '../state/LocaleContext';

// Corner status icon: ⚠ triangle for «нет названий треков», 🚫 no-entry for
// «не работает». Themed via currentColor (the tone class drives the hue).
// Renders nothing for 'none'. Shared across StationTable, the search result
// cards and the home rails so a broken station shows the SAME warning wherever
// it surfaces (Phase B-PR2: broken stations are demoted, not hidden, so every
// surface that can render one must mark it).
export const StationStatusBadge = ({ state }: { state: StationBadgeState }) => {
  const { t } = useLocale();
  if (state === 'none') return null;
  const broken = state === 'broken';
  const label = t(broken ? 'stationTable.badgeBroken' : 'stationTable.badgeNoMetadata');
  return (
    <span
      className={`station-status-badge ${broken ? 'is-broken' : 'is-no-metadata'}`}
      role="img"
      aria-label={label}
      title={label}
    >
      {broken ? (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <line x1="3.9" y1="3.9" x2="12.1" y2="12.1" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 2.2 15 14H1L8 2.2Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <line x1="8" y1="6.6" x2="8" y2="9.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="8" cy="11.7" r="0.85" fill="currentColor" />
        </svg>
      )}
    </span>
  );
};
