import { useState } from 'react';
import type { StationLite } from '../types';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import { useLocale } from '../state/LocaleContext';
import { normalizeStationName, stationLocation } from '../lib/stationUtils';
import { StationArtwork } from '../components/StationArtwork';
import city from '../assets/calm/city.svg';
import road from '../assets/calm/road.svg';
import aurora from '../assets/calm/aurora.svg';
import vinyl from '../assets/calm/vinyl.svg';

type Props = {
  station: StationLite;
  stations: StationLite[];
  onPlay: (station: StationLite, playlist: StationLite[], source: string) => void;
  onFeed: () => void;
  onSearch: (query: string) => void;
};

export function CalmHome({ station, stations, onPlay, onFeed, onSearch }: Props) {
  const { t } = useLocale();
  const { player } = usePlayback();
  const { isFavorite, toggleFavorite } = useLibrary();
  const { setActiveSection, setLibraryTab, winamp } = useShell();
  // Freeze this visit's offer and rows. Playing/saving must not rewrite Home.
  const [visit] = useState(() => ({ station, rows: stations.filter(s => s.stationuuid !== station.stationuuid).slice(0, 3) }));
  const offer = visit.station;
  const selected = (player.current ?? player.pending)?.stationuuid === offer.stationuuid;
  const playing = selected && player.isPlaying;
  const name = normalizeStationName(offer.name);
  const moods = [
    { id: 'night', art: road, query: 'synthwave' },
    { id: 'slow', art: aurora, query: 'ambient' },
    { id: 'jazz', art: vinyl, query: 'jazz' }
  ];
  return <div className="calm-home" data-calm-home>
    <div className="calm-intro"><span>{t('calm.kicker')}</span><h1>{t('calm.title')}</h1></div>
    <article className="calm-hero" data-calm-offer={offer.stationuuid}>
      <img className="calm-hero-art" src={city} alt="" />
      <div className="calm-hero-copy"><p className="calm-eyebrow">{t('calm.offer')}</p>
        <h2>{name}</h2><p>{stationLocation(offer)}</p>
        <div className="calm-hero-actions">
          <button className="calm-primary" onClick={() => playing ? winamp.setExpanded(true) : onPlay(offer, [offer, ...visit.rows], 'home-calm')}>
            <span aria-hidden="true">{playing ? '↗' : '▶'}</span>{t(playing ? 'calm.listening' : 'calm.start')}
          </button>
          <button className="calm-icon calm-favorite" aria-label={t(isFavorite(offer.stationuuid) ? 'stationTable.unfavorite' : 'stationTable.favorite')} aria-pressed={isFavorite(offer.stationuuid)} onClick={() => toggleFavorite(offer)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 5.5c-2-2-5-1.5-8.5 2-3.5-3.5-6.5-4-8.5-2-4 4 2 9 8.5 14 6.5-5 12.5-10 8.5-14Z" /></svg>
          </button>
        </div>
      </div>
    </article>
    <button className="calm-choose" data-home-feed-entry="true" onClick={onFeed}><span className="calm-fan" aria-hidden="true"><img src={aurora} alt=""/><img src={road} alt=""/></span><span>{t('calm.choose')}</span><span aria-hidden="true">↗</span></button>
    <section className="calm-section"><div className="calm-heading"><h2>{t('calm.moods')}</h2><button onClick={() => onSearch('')}>{t('home.seeAll')}</button></div>
      <div className="calm-moods">{moods.map(m => <button key={m.id} onClick={() => onSearch(m.query)}><img src={m.art} alt=""/><strong>{t(`calm.${m.id}`)}</strong><small>{t(`calm.${m.id}Sub`)}</small></button>)}</div>
    </section>
    {visit.rows.length > 0 && <section className="calm-section"><div className="calm-heading"><h2>{t('calm.moreAir')}</h2></div>
      {visit.rows.map(s => <button className="calm-row" key={s.stationuuid} onClick={() => onPlay(s, visit.rows, 'home-calm-rows')}><StationArtwork station={s} size="sm"/><span><strong>{normalizeStationName(s.name)}</strong><small>{stationLocation(s)}</small></span><span aria-hidden="true">▶</span></button>)}
    </section>}
    <section className="calm-section"><div className="calm-heading"><h2>{t('calm.finds')}</h2></div>
      <button className="calm-row calm-find" onClick={() => { setLibraryTab('tracks'); setActiveSection('library'); }}><img src={vinyl} alt=""/><span><strong>{t('calm.keep')}</strong><small>{t('calm.keepSub')}</small></span><span aria-hidden="true">↗</span></button>
    </section>
  </div>;
}
