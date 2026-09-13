import { useEffect, useRef, useState } from 'react';
import { useCatalog } from '../state/CatalogContext';
import { useLocale } from '../state/LocaleContext';
import { useLibrary } from '../state/RadioContext';
import { localizedCountry } from '../lib/countryName';
import type { StationLite } from '../types';
import { CalmStationRow } from './CalmStationRow';

export type Crossroad = { country?: string; tag?: string; tagExact?: boolean };
const sounds = ['jazz', 'ambient', 'electronic', 'folk', 'rock', 'soul'];

// The intersection, not another random shelf: the same sound in another
// country. Fetch only as this part of Home comes into view. Selection is
// exploration; only the separate row Play can change the current audio.
export function CalmCrossroads({ memory, countries, onOpen, onPlay, onSource, onMap }: {
  memory: { country: string; tag: string; countries?: string[] };
  countries: string[];
  onOpen: (query: Crossroad, title: string, picks: StationLite[]) => void;
  onPlay: (station: StationLite, list: StationLite[], source: string) => void;
  onSource: (station: StationLite) => void;
  onMap: (country: string) => void;
}) {
  const { t, locale } = useLocale();
  const { searchStations } = useCatalog();
  const { isStationHiddenFromRecommendations } = useLibrary();
  const [country, setCountry] = useState(memory.country);
  const [tag, setTag] = useState(memory.tag);
  const [options, setOptions] = useState(memory.countries || countries);
  const [items, setItems] = useState<StationLite[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [enabled, setEnabled] = useState(false);
  const [retry, setRetry] = useState(0);
  const host = useRef<HTMLElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setEnabled(true); observer.disconnect(); }
    }, { rootMargin: '200px' });
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setStatus('loading'); setItems([]); setTotal(null);
    void searchStations({ country: country || undefined, tag, tagExact: true, limit: 6, allowFallback: false }).then(result => {
      if (!alive) return;
      setItems(result.items.filter(s => s.lastcheckok !== 0));
      setTotal(result.total); setStatus('ready');
      // The unfiltered-country query supplies all catalogue destinations for
      // this sound; changing country must not shrink the selector to itself.
      if (!country) {
        memory.countries = result.facets.countries.filter(name => name && name !== 'All');
        setOptions(memory.countries);
      }
    }).catch(() => { if (alive) setStatus('error'); });
    return () => { alive = false; };
  }, [enabled, country, tag, retry, memory, searchStations]);
  // Library callbacks change with playback and captures. Apply this small
  // local filter at render time; those updates must never restart the query.
  const visibleItems = items.filter(s => !isStationHiddenFromRecommendations(s.stationuuid));
  const title = `${t(`journal.crossroads.sounds.${tag}`)} · ${country ? localizedCountry({ country }, locale) : t('journal.crossroads.world')}`;
  return <section ref={host} className="calm-section calm-crossroads" data-calm-crossroads>
    <div className="calm-crossroads-cover">
      <span className="calm-eyebrow">{t('journal.crossroads.kicker')}</span>
      <h2>{t('journal.crossroads.title')}</h2>
      <p>{t('journal.crossroads.copy')}</p>
      <label>{t('journal.crossroads.destination')}
        <select value={country} onChange={e => { memory.country = e.target.value; setCountry(e.target.value); }}>
          <option value="">{t('journal.crossroads.world')}</option>
          {[...new Set([...options, ...countries, ...(country ? [country] : [])])].map(name => <option key={name} value={name}>{localizedCountry({ country: name }, locale)}</option>)}
        </select>
      </label>
    </div>
    <div className="calm-crossroads-body">
      <div className="calm-crossroads-sounds" aria-label={t('journal.crossroads.sound')}>
        {sounds.map(sound => <button key={sound} aria-pressed={tag === sound} onClick={() => { memory.tag = sound; setTag(sound); }}>{t(`journal.crossroads.sounds.${sound}`)}</button>)}
      </div>
      <div className="calm-crossroads-result" aria-live="polite" aria-busy={status === 'loading'}>
        <small>{status === 'loading' ? t('calm.loading') : status === 'error' ? t('calm.loadError') : t('calm.catalogTotal', { count: total ?? 0 })}</small>
        {status === 'error' && <button className="calm-text" onClick={() => setRetry(n => n + 1)}>{t('calm.retry')}</button>}
        {visibleItems.slice(0, 2).map(s => <CalmStationRow key={s.stationuuid} station={s} onOpen={() => onSource(s)} onPlay={() => onPlay(s, visibleItems, 'home-crossroads')} />)}
        {status === 'ready' && !visibleItems.length && <p>{t('journal.crossroads.empty')}</p>}
      </div>
      <div className="calm-row-actions">
        <button className="calm-text" onClick={() => onOpen({ country: country || undefined, tag, tagExact: true }, title, visibleItems)}>{t('journal.crossroads.continue')} →</button>
        {country && <button className="calm-text" onClick={() => onMap(country)}>{t('journal.mapAll')} ↗</button>}
      </div>
    </div>
  </section>;
}
