import { useId, useRef, type ReactNode } from 'react';
import { useLocale } from '../state/LocaleContext';
import { useDialog } from '../lib/useDialog';

type SettingsSheetProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  kicker?: string;
  title?: string;
  // PR-4b: opt-in card modifier (e.g. `settings-sheet-card--bottom` for the
  // mobile Theme Studio form). The base card is shared with AccountSheet, so
  // restyles must ride a modifier instead of the shared class.
  cardClassName?: string;
};

// Shared dialog shell — also the root for AccountSheet and ThemeStudio,
// so wiring useDialog here covers all three. (T1.4)
export const SettingsSheet = ({
  open,
  onClose,
  children,
  kicker,
  title,
  cardClassName
}: SettingsSheetProps) => {
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
        data-dialog-backdrop
      />
      <div className={cardClassName ? `settings-sheet-card ${cardClassName}` : 'settings-sheet-card'}>
        <div className="settings-sheet-head">
          <div>
            <div className="settings-sheet-kicker">{kicker || t('nav.settings')}</div>
            <div className="settings-sheet-title" id={titleId}>
              {title || t('settings.generalTitle')}
            </div>
          </div>
          <button className="chip" type="button" onClick={onClose} data-dialog-initial-focus>
            {t('common.close')}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};
