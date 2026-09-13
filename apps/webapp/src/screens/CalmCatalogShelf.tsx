import { useEffect, useRef, useState } from 'react';
import type { StationLite } from '../types';
import { useCatalog } from '../state/CatalogContext';
import { useLibrary } from '../state/RadioContext';
import { useLocale } from '../state/LocaleContext';
import { StationArtwork } from '../components/StationArtwork';
import { normalizeStationName, stationLocation } from '../lib/stationUtils';

type Props = {
  cache: Map<string, ShelfSnapshot>;
  query: { country?: string; tag?: string; mood?: string; tagExact?: boolean };
  initial: StationLite[];
  source: string;
  onPlay: (station: StationLite, playlist: StationLite[], source: string) => void;
  rows?: boolean;
};

export type ShelfSnapshot = { items: StationLite[]; cursor: string | null | undefined; total: number | null; seed: number; scrollLeft: number };

// Parent keys this by filter. A late response cannot enter another country's shelf.
export function CalmCatalogShelf({ query, initial, source, onPlay, rows = false, cache, autoLoad = false }: Props & { autoLoad?: boolean }) {
  const { searchStations } = useCatalog();
  const { isStationHiddenFromRecommendations } = useLibrary();
  const { t } = useLocale();
  const cacheKey = JSON.stringify(query);
  const [snapshot] = useState(() => cache.get(cacheKey));
  const [items, setItems] = useState(() => snapshot?.items || initial.slice(0, rows ? 6 : 12));
  const [cursor, setCursor] = useState<string | null | undefined>(snapshot?.cursor);
  const [total, setTotal] = useState<number | null>(snapshot?.total ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [seed] = useState(() => snapshot?.seed || Date.now());
  const alive = useRef(true);
  const busy = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const scrollLeft = useRef(snapshot?.scrollLeft || 0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // A shelf opened with nothing loaded (a country with no located stations)
  // fetches its first page itself instead of showing an empty state under a
  // button; a shelf with picks still waits for «Ещё станции».
  useEffect(() => {
    if (autoLoad && items.length === 0 && cursor === undefined) void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { list.current?.scrollTo({ left: snapshot?.scrollLeft || 0 }); }, [snapshot]);
  useEffect(() => {
    return () => { cache.set(cacheKey, { items, cursor, total, seed, scrollLeft: scrollLeft.current }); };
  }, [cache, cacheKey, items, cursor, total, seed]);

  const loadMore = async () => {
    if (busy.current || cursor === null) return;
    busy.current = true; setLoading(true); setError(false);
    try {
      const result = await searchStations({ ...query, limit: 30, cursor, seed, allowFallback: false });
      if (!alive.current) return;
      setItems(previous => [...new Map([
        ...(cursor === undefined ? [] : previous), ...result.items
      ].map(station => [station.stationuuid, station])).values()]);
      setTotal(result.total); setCursor(result.nextCursor);
      if (cursor === undefined) list.current?.scrollTo({ left: 0 });
    } catch {
      if (alive.current) setError(true);
    } finally {
      busy.current = false;
      if (alive.current) setLoading(false);
    }
  };
  const visible = items.filter(station => station.lastcheckok !== 0 && !isStationHiddenFromRecommendations(station.stationuuid));

  return <div className="calm-catalog-shelf" data-catalog-query={query.country || query.mood || query.tag}>
    <div ref={list} onScroll={event => { scrollLeft.current = event.currentTarget.scrollLeft; }} className={rows ? 'calm-destinations' : 'calm-station-shelf'} aria-busy={loading}>
      {visible.map((station, index) => rows ?
        <button className="calm-destination" key={station.stationuuid} data-discovery-station={station.stationuuid} onClick={() => onPlay(station, visible, source)}>
          <span className="calm-station-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><StationArtwork station={station} size="sm" />
          <span><strong>{normalizeStationName(station.name)}</strong><small>{stationLocation(station)}</small><em>{station.tags.split(',').map(tag => tag.trim()).filter(Boolean).slice(0, 3).join(' · ')}</em></span><i aria-hidden="true">▶</i>
        </button> :
        <button key={station.stationuuid} className="calm-station-tile" data-shelf-station={station.stationuuid} onClick={() => onPlay(station, visible, source)}>
          <div><StationArtwork station={station} size="sm" /><i aria-hidden="true">▶</i></div><strong>{normalizeStationName(station.name)}</strong><small>{stationLocation(station)}</small>
        </button>)}
    </div>
    <div className="calm-shelf-footer">
      <span role="status">{error ? t('calm.loadError') : total !== null ? t('calm.catalogTotal', { count: total }) : t('calm.catalogPreview')}</span>
      {cursor !== null && <button className="calm-more" aria-disabled={loading} onClick={() => void loadMore()}>{t(loading ? 'calm.loading' : error ? 'calm.retry' : 'calm.moreStations')} <span aria-hidden="true">{rows ? '↓' : '→'}</span></button>}
    </div>
    {!loading && !visible.length && <p className="calm-empty">{t('calm.emptySelection')}</p>}
  </div>;
}
