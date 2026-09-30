import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { UserCollection } from '../domain/contracts';
import { normalizeStationName, stationLocation } from '../lib/stationUtils';
import { stationGenreSlug } from '../lib/stationGenre';
import { useDialog } from '../lib/useDialog';
import { useCatalog } from '../state/CatalogContext';
import { useLocale } from '../state/LocaleContext';
import type { StationLite } from '../types';
import { StationArtwork } from './StationArtwork';
import './CollectionStationPicker.css';

type Props = {
  collection: UserCollection;
  suggestions: StationLite[];
  onAdd: (station: StationLite) => void;
  onClose: () => void;
};

export function CollectionStationPicker({ collection, suggestions, onAdd, onClose }: Props) {
  const { t } = useLocale();
  const { searchStations } = useCatalog();
  const rootRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const inputId = useId();
  const requestVersion = useRef(0);
  const browseSeed = useRef(Math.floor(Math.random() * 2_147_483_646) + 1);
  const addedHere = useRef(new Set<string>());
  const [mode, setMode] = useState<'library' | 'catalog'>(suggestions.length ? 'library' : 'catalog');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<StationLite[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [notice, setNotice] = useState('');
  useDialog(rootRef, { isOpen: true, onClose });

  useEffect(() => {
    const version = ++requestVersion.current;
    setItems([]);
    setCursor(null);
    setError(false);
    setLoading(mode === 'catalog');
    if (mode !== 'catalog') return;
    const timer = window.setTimeout(() => {
      void searchStations({ q: query.trim(), seed: browseSeed.current, limit: 24, allowFallback: false })
        .then((result) => {
          if (requestVersion.current !== version) return;
          setItems(result.items);
          setCursor(result.nextCursor);
        })
        .catch(() => {
          if (requestVersion.current === version) setError(true);
        })
        .finally(() => {
          if (requestVersion.current === version) setLoading(false);
        });
    }, query.trim() ? 300 : 0);
    return () => {
      window.clearTimeout(timer);
      ++requestVersion.current;
    };
  }, [mode, query, retry, searchStations]);

  const loadMore = async () => {
    if (!cursor || loading) return;
    const version = requestVersion.current;
    setLoading(true);
    setError(false);
    try {
      const result = await searchStations({ q: query.trim(), seed: browseSeed.current, cursor, limit: 24, allowFallback: false });
      if (requestVersion.current !== version) return;
      setItems((previous) => {
        const ids = new Set(previous.map((station) => station.stationuuid));
        return [...previous, ...result.items.filter((station) => {
          if (ids.has(station.stationuuid)) return false;
          ids.add(station.stationuuid);
          return true;
        })];
      });
      setCursor(result.nextCursor);
    } catch {
      if (requestVersion.current === version) setError(true);
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  };

  const stationIds = new Set([...collection.stationIds, ...addedHere.current]);
  const full = stationIds.size >= 128;
  const needle = query.trim().toLocaleLowerCase();
  const rows = mode === 'catalog' ? items : suggestions.filter((station) =>
    `${station.name} ${stationLocation(station)} ${station.tags || ''}`.toLocaleLowerCase().includes(needle)
  );
  const add = (station: StationLite) => {
    if (stationIds.has(station.stationuuid) || full) return;
    addedHere.current.add(station.stationuuid);
    onAdd(station);
    setNotice(t('library.collectionAdded', {
      station: normalizeStationName(station.name), collection: collection.name
    }));
  };
  const changeQuery = (value: string) => {
    // Invalidate immediately, before the debounce/effect: an old result must
    // never become clickable underneath a newly typed query.
    ++requestVersion.current;
    setItems([]);
    setCursor(null);
    setQuery(value);
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div ref={rootRef} className="collection-station-picker" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button className="collection-station-picker-scrim" type="button" aria-label={t('common.close')} onClick={onClose} data-dialog-backdrop />
      <div className="collection-station-picker-card">
        <header className="collection-station-picker-head">
          <div>
            <span className="collection-station-picker-kicker">{t('library.addStationsToCollection')}</span>
            <h2 id={titleId}>{collection.name}</h2>
            <span className="collection-station-picker-count">{stationIds.size} / 128</span>
          </div>
          <button className="collection-station-picker-close" type="button" onClick={onClose} aria-label={t('common.close')} data-dialog-initial-focus>×</button>
        </header>
        <div className="collection-station-picker-tools">
          <div className="collection-station-picker-modes">
            {(['library', 'catalog'] as const).map((value) => (
              <button key={value} type="button" aria-pressed={mode === value} onClick={() => {
                if (value === mode) return;
                ++requestVersion.current;
                setMode(value);
              }}>
                {t(value === 'library' ? 'library.pickerLibrary' : 'library.pickerCatalog')}
              </button>
            ))}
          </div>
          <label className="collection-station-picker-search" htmlFor={inputId}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg>
            <input id={inputId} type="search" value={query} onChange={(event) => changeQuery(event.target.value)} placeholder={t('library.pickerSearch')} aria-label={t('library.pickerSearch')} autoComplete="off" />
          </label>
        </div>
        <div className="collection-station-picker-results" aria-busy={loading}>
          <ul role="list">
            {rows.map((station) => {
              const added = stationIds.has(station.stationuuid);
              const genre = stationGenreSlug(station);
              const meta = [stationLocation(station), genre ? t(`genre.${genre}`) : ''].filter(Boolean).join(' · ');
              return <li key={station.stationuuid}>
                <StationArtwork station={station} size="sm" />
                <div className="collection-station-picker-copy">
                  <strong>{normalizeStationName(station.name)}</strong>
                  <span>{meta}</span>
                </div>
                <button type="button" className={added ? 'is-added' : ''} aria-disabled={added || full} onClick={() => add(station)} aria-label={added ? t('library.pickerAddedStation', { station: normalizeStationName(station.name) }) : t('library.addStationToCollection', { station: normalizeStationName(station.name) })}>
                  <span aria-hidden="true">{added ? '✓' : '+'}</span>
                </button>
              </li>;
            })}
          </ul>
          {loading ? <p role="status">{t('library.pickerLoading')}</p> : null}
          {!loading && !error && !rows.length ? <p>{t('library.pickerEmpty')}</p> : null}
          {error ? <div className="collection-station-picker-error">
            <p>{t('library.pickerError')}</p>
            <button type="button" onClick={() => items.length && cursor ? void loadMore() : setRetry((value) => value + 1)}>{t('library.pickerRetry')}</button>
          </div> : null}
          {mode === 'catalog' && cursor && !error ? <button className="collection-station-picker-more" type="button" disabled={loading} onClick={() => void loadMore()}>{t('library.pickerMore')}</button> : null}
        </div>
        <footer className="collection-station-picker-foot">
          <span role="status" aria-live="polite">{full ? t('library.collectionFull') : notice}</span>
          <button type="button" onClick={onClose}>{t('library.pickerDone')}</button>
        </footer>
      </div>
    </div>, document.body
  );
}
