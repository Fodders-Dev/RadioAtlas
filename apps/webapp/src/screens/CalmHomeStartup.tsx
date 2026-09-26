import { useLocale } from '../state/LocaleContext';
import './calm-home-startup.css';

type CalmHomeStartupProps = {
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onSearch: () => void;
};

export const CalmHomeStartup = ({ loading, error, onRetry, onSearch }: CalmHomeStartupProps) => {
  const { t } = useLocale();
  return <div className="calm-home calm-journal calm-home-startup" data-calm-home-startup aria-busy={loading}>
    <header className="calm-journal-heading">
      <h1>{t('journal.heading')}</h1>
      {loading && <div>
        <button className="calm-icon calm-glass" aria-label={t('journal.search')} onClick={onSearch}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="7.5" /><path d="m16 16 5 5" /></svg>
        </button>
      </div>}
    </header>
    {loading ? <section className="calm-startup-loading" aria-label={t('calm.loading')}>
      <div className="calm-startup-stage" aria-hidden="true"><span /><i /><b /><span /></div>
      <div className="calm-startup-heading" aria-hidden="true"><i /><span /></div>
      <div className="calm-startup-cards" aria-hidden="true"><i /><i /><i /></div>
      <p role="status">{t('calm.loading')}</p>
    </section> : <section className="calm-startup-recovery" role={error ? 'alert' : 'status'}>
      <p>{t(error ? 'calm.loadError' : 'calm.emptySelection')}</p>
      <div>
        <button className="calm-startup-action" onClick={onRetry}>{t('calm.retry')}</button>
        <button className="calm-startup-search" onClick={onSearch}>{t('journal.search')}</button>
      </div>
    </section>}
  </div>;
};
