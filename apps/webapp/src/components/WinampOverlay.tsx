import type { ReactNode } from 'react';

type WinampOverlayProps = {
  open: boolean;
  title: string;
  subtitle: string;
  onCollapse: () => void;
  headerActions?: ReactNode;
  children: ReactNode;
  footerActions?: ReactNode;
};

export const WinampOverlay = ({
  open,
  title,
  subtitle,
  onCollapse,
  headerActions,
  children,
  footerActions
}: WinampOverlayProps) => {
  if (!open) return null;

  return (
    <div className="winamp-overlay" role="dialog" aria-modal="true">
      <button
        className="winamp-overlay-backdrop"
        type="button"
        onClick={onCollapse}
        aria-label="Collapse player"
      />
      <div className="winamp-overlay-panel">
        <div className="winamp-overlay-header">
          <div>
            <div className="winamp-overlay-title">{title}</div>
            <div className="winamp-overlay-subtitle">{subtitle}</div>
          </div>
          <div className="winamp-overlay-header-actions">
            {headerActions}
            <button className="chip active" type="button" onClick={onCollapse}>
              Collapse
            </button>
          </div>
        </div>

        <div className="winamp-overlay-host">{children}</div>

        {footerActions && <div className="winamp-overlay-footer">{footerActions}</div>}
      </div>
    </div>
  );
};
