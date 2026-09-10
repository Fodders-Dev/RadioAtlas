import { useState } from 'react';
import type { StationLite } from '../types';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import { useLocale } from '../state/LocaleContext';
import { formatCountryLabel, normalizeStationName, stationLocation } from '../lib/stationUtils';
import { StationArtwork } from '../components/StationArtwork';
import { calmDiscoveries } from '../lib/calmDiscoveries';
import road from '../assets/calm/road.svg';
import aurora from '../assets/calm/aurora.svg';
import vinyl from '../assets/calm/vinyl.svg';

type Props = {
  station: StationLite;
  stations: StationLite[];
  discoveryStations: StationLite[];
  onPlay: (station: StationLite, playlist: StationLite[], source: string) => void;
  onFeed: (station?: StationLite) => void;
  onSearch: (query: string) => void;
};

// Decorative atlas grid: no invented stations or listener activity.
function AtlasGrid() {
  return <svg className="calm-atlas-grid" viewBox="0 0 320 240" fill="none" aria-hidden="true">
    <circle cx="160" cy="120" r="105" />
    <ellipse cx="160" cy="120" rx="65" ry="105" />
    <ellipse cx="160" cy="120" rx="25" ry="105" />
    <ellipse cx="160" cy="120" rx="105" ry="38" />
    <path d="M55 120h210M70 67h180M70 173h180" />
  </svg>;
}

export function CalmHome({ station, stations, discoveryStations, onPlay, onFeed, onSearch }: Props) {
  const { t } = useLocale();
  const { player } = usePlayback();
  const { isFavorite, toggleFavorite, trackHistory, knownStations, isStationHiddenFromRecommendations } = useLibrary();
  const { setActiveSection, setLibraryTab } = useShell();
  // Freeze this visit. Play/capture never inserts sections or reshuffles offers.
  const [visit] = useState(() => {
    const pool = [...new Map([station, ...discoveryStations, ...stations].map(s => [s.stationuuid, s])).values()]
      .filter(s => !isStationHiddenFromRecommendations(s.stationuuid) && s.lastcheckok !== 0);
    const countries = [...new Set(pool.map(s => s.country.trim()).filter(Boolean))].slice(0, 6);
    return {
      station, pool, countries, discoveries: calmDiscoveries(pool),
      rows: stations.filter(s => s.stationuuid !== station.stationuuid).slice(0, 3),
      finds: trackHistory.slice(0, 3)
    };
  });
  const [country, setCountry] = useState(visit.countries.find(c => c !== station.country) || visit.countries[0] || '');
  const destinations = visit.pool.filter(s => s.country.trim() === country).slice(0, 3);
  const offer = visit.station;
  const playing = (player.current ?? player.pending)?.stationuuid === offer.stationuuid && player.isPlaying;
  const openFinds = () => { setLibraryTab('tracks'); setActiveSection('library'); };
  const moods = [
    { id: 'night', art: road, query: 'synthwave' },
    { id: 'slow', art: aurora, query: 'ambient' },
    { id: 'jazz', art: vinyl, query: 'jazz' }
  ];

  return <div className="calm-home" data-calm-home>
    <div className="calm-intro"><span>RadioAtlas</span><h1>{t('calm.title')}</h1></div>
    <article className="calm-hero" data-calm-offer={offer.stationuuid}>
      <img className="calm-hero-scene" src={aurora} alt="" />
      <div className="calm-tuning" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
      <div className="calm-hero-copy">
        <p className="calm-eyebrow">{t('calm.offer')}</p>
        <div className="calm-offer-identity"><StationArtwork station={offer} size="sm" />
          <div><h2>{normalizeStationName(offer.name)}</h2><p>{stationLocation(offer)}</p></div>
        </div>
        <p className="calm-offer-sound">{offer.description || offer.tags.split(',').slice(0, 3).join(' · ')}</p>
        <div className="calm-hero-actions">
          <button className="calm-primary" onClick={() => playing ? onFeed(offer) : onPlay(offer, [offer, ...visit.rows], 'home-calm')}>
            <span aria-hidden="true">{playing ? '↗' : '▶'}</span>{t(playing ? 'calm.listening' : 'calm.start')}
          </button>
          <button className="calm-icon calm-favorite" aria-label={t(isFavorite(offer.stationuuid) ? 'stationTable.unfavorite' : 'stationTable.favorite')} aria-pressed={isFavorite(offer.stationuuid)} onClick={() => toggleFavorite(offer)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 5.5c-2-2-5-1.5-8.5 2-3.5-3.5-6.5-4-8.5-2-4 4 2 9 8.5 14 6.5-5 12.5-10 8.5-14Z" /></svg>
          </button>
        </div>
      </div>
    </article>

    <div className="calm-discovery-entries">
      <button className="calm-choose" data-home-feed-entry="true" onClick={() => onFeed()}>
        <span className="calm-fan" aria-hidden="true"><img src={aurora} alt="" /><img src={road} alt="" /></span>
        <span><strong>{t('calm.choose')}</strong><small>{t('calm.chooseSub')}</small></span><span aria-hidden="true">↗</span>
      </button>
      <button className="calm-globe-entry" onClick={() => setActiveSection('globe')}><AtlasGrid /><span>{t('calm.globe')} <b aria-hidden="true">↗</b></span></button>
    </div>

    {visit.discoveries.length > 0 && <section className="calm-section calm-discoveries"><div className="calm-heading"><h2>{t('calm.dig')}</h2></div>
      <div className="calm-discovery-cards">{visit.discoveries.map((pick, index) => <article className="calm-discovery-card" key={pick.id} data-direction={pick.id}>
        <img className="calm-discovery-art" src={index % 3 === 0 ? road : index % 3 === 1 ? vinyl : aurora} alt="" />
        <div className="calm-discovery-copy"><span>{t(`calm.directions.${pick.id}.eyebrow`)}</span><h3>{t(`calm.directions.${pick.id}.title`)}</h3><p>{t(`calm.directions.${pick.id}.copy`)}</p>
          <button className="calm-discovery-listen" onClick={() => onPlay(pick.station, [pick.station], 'home-calm-direction')}><StationArtwork station={pick.station} size="sm" /><span><strong>{normalizeStationName(pick.station.name)}</strong><small>{stationLocation(pick.station)}</small></span><b aria-hidden="true">▶</b></button>
          <button className="calm-discovery-search" onClick={() => onSearch(pick.query)}>{t('calm.moreDirection')} ↗</button>
        </div>
      </article>)}</div>
    </section>}

    {destinations.length > 0 && <section className="calm-section calm-world" data-calm-world>
      <div className="calm-heading"><h2>{t('calm.world')}</h2></div>
      <div className="calm-countries" role="group" aria-label={t('calm.country')}>
        {visit.countries.map(c => <button key={c} aria-pressed={country === c} onClick={() => setCountry(c)}>{formatCountryLabel(c)}</button>)}
      </div>
      <div className="calm-destinations">
        {destinations.map(s => <button className="calm-destination" key={s.stationuuid} data-discovery-station={s.stationuuid} onClick={() => onPlay(s, destinations, 'home-calm-world')}>
          <StationArtwork station={s} size="sm" />
          <span><small>{stationLocation(s)}</small><strong>{normalizeStationName(s.name)}</strong><em>{s.tags.split(',').map(tag => tag.trim()).filter(Boolean).slice(0, 3).join(' · ')}</em></span>
          <i aria-hidden="true">▶</i>
        </button>)}
      </div>
    </section>}

    <section className="calm-section"><div className="calm-heading"><h2>{t('calm.moods')}</h2><button onClick={() => onSearch('')}>{t('home.seeAll')}</button></div>
      <div className="calm-moods">{moods.map(m => <button key={m.id} onClick={() => onSearch(m.query)}><img src={m.art} alt="" /><strong>{t(`calm.${m.id}`)}</strong><small>{t(`calm.${m.id}Sub`)}</small></button>)}</div>
    </section>

    <section className="calm-section"><div className="calm-heading"><h2>{t('calm.finds')}</h2><button onClick={openFinds}>{t('home.seeAll')}</button></div>
      {visit.finds.map(find => {
        const source = knownStations.find(s => s.stationuuid === find.stationId);
        return <article className="calm-saved-find" key={find.id}>
          <span className="calm-find-mark" aria-hidden="true">↳</span>
          <div><strong>{find.track}</strong><small>{find.stationName}</small>
            {source && <button onClick={() => onPlay(source, [source], 'home-calm-find-source')}>{t('calm.source')} ↗</button>}
          </div>
        </article>;
      })}
      <button className="calm-row calm-find" onClick={openFinds}><img src={vinyl} alt="" /><span><strong>{t(visit.finds.length ? 'calm.openFinds' : 'calm.keep')}</strong><small>{t(visit.finds.length ? 'calm.openFindsSub' : 'calm.keepSub')}</small></span><span aria-hidden="true">↗</span></button>
    </section>
  </div>;
}
