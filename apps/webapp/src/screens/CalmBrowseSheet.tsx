import { useEffect, useRef } from 'react';
import type { StationLite } from '../types';
import { useLocale } from '../state/LocaleContext';
import { CalmCatalogShelf, type ShelfSnapshot } from './CalmCatalogShelf';
import { CalmPoster } from './CalmPoster';
import type { PosterArt } from './calmStories';
import { CalmStationRow } from './CalmStationRow';

// A story or a country opened as a sheet: the poster, a few loaded sources to
// start with, then the SAME query paged from the full catalogue («Ещё
// станции»). Browsing never plays; ▶ on a row does.
export function CalmBrowseSheet({ title, kicker, copy, art, word, query, picks, cache, source, onPlay, onSource, onClose }: {
  title: string; kicker?: string; copy?: string; art?: PosterArt; word?: string;
  query: { country?: string; tag?: string; mood?: string };
  picks: StationLite[]; cache: Map<string, ShelfSnapshot>; source: string;
  onPlay: (station: StationLite, playlist: StationLite[], source: string) => void;
  onSource: (station: StationLite) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { t } = useLocale();
  useEffect(() => { dialog.current?.showModal(); }, []);
  const starters = picks.slice(0, 3);
  return <dialog ref={dialog} className="calm-sheet calm-browse-sheet" aria-labelledby="calm-browse-title" onClose={onClose} data-calm-browse={query.country || query.mood || query.tag}>
    <div className="calm-sheet-handle" aria-hidden="true" />
    <div className="calm-sheet-head"><div>{kicker && <span className="calm-eyebrow">{kicker}</span>}<h2 id="calm-browse-title">{title}</h2></div><button className="calm-icon" onClick={() => dialog.current?.close()} aria-label={t('common.close')}>×</button></div>
    {art && <CalmPoster art={art} word={word} />}
    {copy && <p className="calm-browse-copy">{copy}</p>}
    {starters.length > 0 && <>
      <p className="calm-eyebrow">{t('journal.startHere')}</p>
      <div className="calm-rows">{starters.map((station) => <CalmStationRow key={station.stationuuid} station={station} onPlay={() => onPlay(station, starters, source)} onOpen={() => onSource(station)} />)}</div>
      <h3 className="calm-continue-title">{t('journal.continueTitle')}</h3>
    </>}
    <CalmCatalogShelf cache={cache} query={query} initial={picks.slice(3)} source={source} onPlay={onPlay} rows autoLoad={picks.length === 0} />
  </dialog>;
}
