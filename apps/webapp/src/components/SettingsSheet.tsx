import { useId, useRef, type ReactNode } from 'react';
import { useLocale } from '../state/LocaleContext';
import { useDialog } from '../lib/useDialog';

type SettingsSheetProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  kicker?: string;
  title?: string;
};

// Shared dialog shell — also the root for AccountSheet and ThemeStudio,
// so wiring useDialog here covers all three. (T1.4)
export const SettingsSheet = ({ open, onClose, children, kicker, title }: SettingsSheetProps) => {
  const { t } = useLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialog(rootRef, { isOpen: open, onClose });

  if (!open) {
    return null;
  }

  return (
    <div
      ref={rootRef}
      className="settings-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        className="settings-sheet-backdrop"
        type="button"
        onClick={onClose}
        aria-label={t('common.close')}
      />
      <div className="settings-sheet-card">
        <div className="settings-sheet-head">
          <div>
            <div className="settings-sheet-kicker">{kicker || t('nav.settings')}</div>
            <div className="settings-sheet-title" id={titleId}>
              {title || t('settings.generalTitle')}
            </div>
          </div>
          <button className="chip" type="button" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};
