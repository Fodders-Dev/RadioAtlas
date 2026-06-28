import { useLocale } from '../state/LocaleContext';
import type { AppSection } from '../types';

type AppScreenSkeletonProps = {
  section: AppSection;
  scope?: 'screen' | 'sheet' | 'overlay' | 'home-hero';
};

const SKELETON_ROWS: Record<AppSection, number> = {
  home: 4,
  feed: 3,
  search: 5,
  globe: 4,
  library: 4
};

export const AppScreenSkeleton = ({
  section,
  scope = 'screen'
}: AppScreenSkeletonProps) => {
  const { t } = useLocale();
  const rows = SKELETON_ROWS[section];

  if (scope === 'home-hero') {
    return (
      <section
        className="screen-skeleton screen-skeleton-home-hero"
        aria-label={t('common.loading')}
        aria-busy="true"
      >
        <div className="glass-card screen-skeleton-card screen-skeleton-home-hero-card">
          <div className="screen-skeleton-lines">
            <span className="screen-skeleton-line short" />
            <span className="screen-skeleton-line title" />
            <span className="screen-skeleton-line medium" />
          </div>
          <div className="screen-skeleton-chip-row">
            <span className="screen-skeleton-chip" />
            <span className="screen-skeleton-chip long" />
          </div>
        </div>
        <div className="glass-card screen-skeleton-card screen-skeleton-home-ribbon">
          <span className="screen-skeleton-avatar" />
          <div className="screen-skeleton-lines">
            <span className="screen-skeleton-line medium" />
            <span className="screen-skeleton-line short" />
          </div>
          <span className="screen-skeleton-pill" />
        </div>
      </section>
    );
  }

  return (
    <section
      className={`screen screen-skeleton screen-skeleton-${scope}`}
      aria-label={t('common.loading')}
      aria-busy="true"
    >
      <div className="glass-card screen-skeleton-card screen-skeleton-hero">
        <div className="screen-skeleton-lines">
          <span className="screen-skeleton-line short" />
          <span className="screen-skeleton-line title" />
          <span className="screen-skeleton-line medium" />
        </div>
        <div className="screen-skeleton-chip-row">
          <span className="screen-skeleton-chip" />
          <span className="screen-skeleton-chip" />
          <span className="screen-skeleton-chip long" />
        </div>
      </div>

      <div className="screen-skeleton-grid">
        <div className="glass-card screen-skeleton-card">
          <div className="screen-skeleton-lines">
            <span className="screen-skeleton-line medium" />
            <span className="screen-skeleton-line short" />
          </div>
          <div className="screen-skeleton-list">
            {Array.from({ length: rows }).map((_, index) => (
              <div key={`row-${section}-${index}`} className="screen-skeleton-row">
                <span className="screen-skeleton-avatar" />
                <div className="screen-skeleton-lines">
                  <span className="screen-skeleton-line medium" />
                  <span className="screen-skeleton-line short" />
                </div>
                <span className="screen-skeleton-pill" />
              </div>
            ))}
          </div>
        </div>

        {scope === 'screen' ? (
          <div className="glass-card screen-skeleton-card screen-skeleton-side">
            <div className="screen-skeleton-lines">
              <span className="screen-skeleton-line short" />
              <span className="screen-skeleton-line medium" />
            </div>
            <div className="screen-skeleton-chip-grid">
              <span className="screen-skeleton-chip" />
              <span className="screen-skeleton-chip" />
              <span className="screen-skeleton-chip" />
              <span className="screen-skeleton-chip long" />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
};
