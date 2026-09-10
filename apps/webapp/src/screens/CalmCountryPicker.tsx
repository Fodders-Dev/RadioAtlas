import { useEffect, useRef, useState } from 'react';
import { useCatalog } from '../state/CatalogContext';
import { useLocale } from '../state/LocaleContext';
import { formatCountryLabel } from '../lib/stationUtils';

export function CalmCountryPicker({ initial, selected, onSelect, onClose }: {
  initial: string[]; selected: string; onSelect: (country: string) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { searchStations } = useCatalog();
  const { t } = useLocale();
  const [countries, setCountries] = useState(initial);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let alive = true;
    setStatus('loading');
    void searchStations({ limit: 1, seed: 1, allowFallback: false }).then(result => {
      if (alive) { setCountries(result.facets.countries); setStatus('ready'); }
    }).catch(() => { if (alive) setStatus('error'); });
    return () => { alive = false; };
  }, [searchStations, attempt]);
  const matching = countries.filter(country => `${country} ${formatCountryLabel(country)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <dialog ref={dialog} className="calm-country-dialog" aria-labelledby="calm-country-title" onClose={onClose}>
    <div className="calm-country-head"><h2 id="calm-country-title">{t('calm.allCountries')}</h2><button onClick={() => dialog.current?.close()} aria-label={t('common.close')}>×</button></div>
    <input type="search" autoFocus aria-label={t('calm.country')} placeholder={t('calm.country')} value={query} onChange={event => setQuery(event.target.value)} />
    <p role="status">{status === 'loading' ? t('calm.loading') : status === 'error' ? t('calm.loadError') : ''}</p>
    {status === 'error' && <button className="calm-more" onClick={() => setAttempt(value => value + 1)}>{t('calm.retry')}</button>}
    <div className="calm-country-options">{matching.map(country => <button key={country} aria-pressed={selected === country} onClick={() => { onSelect(country); dialog.current?.close(); }}>{formatCountryLabel(country)}<span aria-hidden="true">{selected === country ? '✓' : '›'}</span></button>)}</div>
  </dialog>;
}
