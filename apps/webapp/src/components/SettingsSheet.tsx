import type { ReactNode } from 'react';
import { useLocale } from '../state/LocaleContext';

type SettingsSheetProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
};

export const SettingsSheet = ({ open, onClose, children }: SettingsSheetProps) => {
  const { t } = useLocale();

  if (!open) {
    return null;
  }

  return (
    <div className="settings-sheet" role="dialog" aria-modal="true">
      <button
        className="settings-sheet-backdrop"
        type="button"
        onClick={onClose}
        aria-label={t('common.close')}
      />
      <div className="settings-sheet-card">
        <div className="settings-sheet-head">
          <div>
            <div className="settings-sheet-kicker">{t('nav.settings')}</div>
            <div className="settings-sheet-title">{t('settings.generalTitle')}</div>
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
