import { useEffect, useLayoutEffect, useState } from 'react';
import type { StationLite } from '../types';
import type { CatalogMoodRail } from '../domain/contracts';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import { useLocale } from '../state/LocaleContext';
import { formatCountryLabel, normalizeStationName, stationLocation } from '../lib/stationUtils';
import { StationArtwork } from '../components/StationArtwork';
import { CalmCatalogShelf, type ShelfSnapshot } from './CalmCatalogShelf';
import { CalmCountryPicker } from './CalmCountryPicker';
import { calmGenreGroups } from '../lib/calmDiscoveries';
import road from '../assets/calm/road.svg';
import aurora from '../assets/calm/aurora.svg';
import vinyl from '../assets/calm/vinyl.svg';
import city from '../assets/calm/city.svg';

type Props = {
  station: StationLite;
  stations: StationLite[];
  discoveryStations: StationLite[];
  moodRails: CatalogMoodRail[];
  onPlay: (station: StationLite, playlist: StationLite[], source: string) => void;
  onFeed: (station?: StationLite) => void;
  onSearch: (query: string) => void;
};

type DiscoveryVisit = { seed: number; country?: string; genre?: string; playlist?: string; scrollY?: number; shelves: Map<string, ShelfSnapshot> };
// SPA-only visit memory: public catalogue pages and filter choices, never finds
// or account data. Opening the Feed must not erase Home exploration. A new Home
// session or a page reload drops it; nothing is written to persistent storage.
let discoveryVisit: DiscoveryVisit | undefined;
function resumeDiscovery(seed: number): DiscoveryVisit {
  if (!discoveryVisit || discoveryVisit.seed !== seed) discoveryVisit = { seed, shelves: new Map() };
  return discoveryVisit;
}

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

export function CalmHome({ station, stations, discoveryStations, moodRails, onPlay, onFeed, onSearch }: Props) {
  const { t } = useLocale();
  const { player } = usePlayback();
  const { isFavorite, toggleFavorite, trackHistory, knownStations, favorites, recent, collections, isStationHiddenFromRecommendations } = useLibrary();
  const { setActiveSection, setLibraryTab, homeState } = useShell();
  const [discovery] = useState(() => resumeDiscovery(homeState.sessionSeed));
  useLayoutEffect(() => {
    window.scrollTo({ top: discovery.scrollY || 0, behavior: 'instant' });
    return () => { discovery.scrollY = window.scrollY; };
  }, [discovery]);
  // Freeze this visit. Play/capture never inserts sections or reshuffles offers.
  const [visit] = useState(() => {
    const pool = [...new Map([station, ...discoveryStations, ...stations].map(s => [s.stationuuid, s])).values()]
      .filter(s => !isStationHiddenFromRecommendations(s.stationuuid) && s.lastcheckok !== 0);
    const countries = [...new Set(pool.map(s => s.country.trim()).filter(Boolean))];
    return {
      station, pool, countries, genres: calmGenreGroups(pool),
      playlists: moodRails.map(rail => ({ ...rail, stations: rail.stations.filter(s => !isStationHiddenFromRecommendations(s.stationuuid) && s.lastcheckok !== 0) })).filter(rail => rail.stations.length),
      collections: collections.map(collection => ({ ...collection, stations: collection.stationIds.map(id => knownStations.find(s => s.stationuuid === id)).filter((s): s is StationLite => Boolean(s)) })).filter(collection => collection.stations.length),
      rows: stations.filter(s => s.stationuuid !== station.stationuuid).slice(0, 3),
      personal: [...new Map([...favorites, ...recent].map(s => [s.stationuuid, s])).values()].slice(0, 3),
      finds: trackHistory.slice(0, 3)
    };
  });
  const [country, setCountry] = useState(discovery.country || visit.countries.find(c => c !== station.country) || visit.countries[0] || '');
  const [countryPicker, setCountryPicker] = useState(false);
  const [genre, setGenre] = useState(discovery.genre || visit.genres[0]?.id || '');
  const [playlist, setPlaylist] = useState(discovery.playlist || visit.playlists[0]?.id || '');
  useEffect(() => { Object.assign(discovery, { country, genre, playlist }); }, [discovery, country, genre, playlist]);
  const countryStations = visit.pool.filter(s => s.country.trim() === country);
  const genreGroup = visit.genres.find(group => group.id === genre);
  const selectedPlaylist = visit.playlists.find(group => group.id === playlist);
  const playlistNames: Record<string, string> = { 'mood-late-night': 'home.moodLateNightTitle', 'mood-workout': 'home.moodWorkoutTitle', 'mood-focus': 'home.moodFocusTitle', 'mood-driving': 'home.moodDrivingTitle' };
  const stationShelf = (items: StationLite[], source: string) => <div className="calm-station-shelf">{items.map(s => <button key={s.stationuuid} className="calm-station-tile" data-shelf-station={s.stationuuid} onClick={() => onPlay(s, items, source)}><div><StationArtwork station={s} size="sm" /><i aria-hidden="true">▶</i></div><strong>{normalizeStationName(s.name)}</strong><small>{stationLocation(s)}</small></button>)}</div>;
  const offer = visit.station;
  const playing = (player.current ?? player.pending)?.stationuuid === offer.stationuuid && player.isPlaying;
  const openFinds = () => { setLibraryTab('tracks'); setActiveSection('library'); };
  const moods = [
    { id: 'night', art: road, query: 'synthwave' },
    { id: 'slow', art: aurora, query: 'ambient' },
    { id: 'jazz', art: vinyl, query: 'jazz' }
  ];

  return <div className="calm-home" data-calm-home>
    {countryPicker && <CalmCountryPicker initial={visit.countries} selected={country} onSelect={setCountry} onClose={() => setCountryPicker(false)} />}
    <div className="calm-intro"><span className="calm-brand-mark" aria-hidden="true">◎</span><strong>RadioAtlas</strong></div>
    <article className="calm-hero" data-calm-offer={offer.stationuuid}>
      <img className="calm-hero-scene" src="/images/calm/sound-glass.webp" alt="" />
      <div className="calm-hero-copy"><p className="calm-eyebrow">{t('calm.atlasKicker')}</p><h1>{t('calm.atlasTitle')}</h1></div>
      <div className="calm-offer-bar">
        <StationArtwork station={offer} size="sm" />
        <div className="calm-offer-identity"><small>{t('calm.offer')}</small><h2>{normalizeStationName(offer.name)}</h2><p>{stationLocation(offer)}</p></div>
        <button className="calm-primary" aria-label={t(playing ? 'calm.listening' : 'calm.start')} onClick={() => playing ? onFeed(offer) : onPlay(offer, [offer, ...visit.rows], 'home-calm')}><span aria-hidden="true">{playing ? '↗' : '▶'}</span></button>
      </div>
      <button className="calm-icon calm-favorite" aria-label={t(isFavorite(offer.stationuuid) ? 'stationTable.unfavorite' : 'stationTable.favorite')} aria-pressed={isFavorite(offer.stationuuid)} onClick={() => toggleFavorite(offer)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 5.5c-2-2-5-1.5-8.5 2-3.5-3.5-6.5-4-8.5-2-4 4 2 9 8.5 14 6.5-5 12.5-10 8.5-14Z" /></svg></button>
    </article>

    <div className="calm-discovery-entries">
      <button className="calm-choose" data-home-feed-entry="true" onClick={() => onFeed()}>
        <span className="calm-fan" aria-hidden="true"><img src={aurora} alt="" /><img src={road} alt="" /></span>
        <span><strong>{t('calm.choose')}</strong><small>{t('calm.chooseSub')}</small></span><span aria-hidden="true">↗</span>
      </button>
      <button className="calm-globe-entry" onClick={() => setActiveSection('globe')}><AtlasGrid /><span>{t('calm.globe')} <b aria-hidden="true">↗</b></span></button>
    </div>


    <section className="calm-section calm-playlists"><div className="calm-heading"><div><p>{t('calm.playlistKicker')}</p><h2>{t('calm.moods')}</h2></div></div>
      <div className="calm-moods">{visit.playlists.length ? visit.playlists.map((group, index) => <button key={group.id} aria-pressed={playlist === group.id} onClick={() => setPlaylist(group.id)}><img src={[aurora, road, vinyl, city][index % 4]} alt="" /><span><strong>{t(playlistNames[group.id] || 'calm.moods')}</strong><small>{t('calm.exploreSelection')}</small><i aria-hidden="true">↗</i></span></button>) : moods.map(m => <button key={m.id} onClick={() => onSearch(m.query)}><img src={m.art} alt="" /><span><strong>{t(`calm.${m.id}`)}</strong><small>{t(`calm.${m.id}Sub`)}</small><i aria-hidden="true">↗</i></span></button>)}</div>
      {selectedPlaylist && <div className="calm-playlist-stations"><div className="calm-heading"><h3>{t(playlistNames[selectedPlaylist.id] || 'calm.moods')}</h3><button className="calm-start-playlist" onClick={() => onPlay(selectedPlaylist.stations[0], selectedPlaylist.stations, 'home-calm-playlist')}>▶ {t('calm.listenSelection')}</button></div><CalmCatalogShelf cache={discovery.shelves} key={selectedPlaylist.id} query={{ mood: selectedPlaylist.id }} initial={selectedPlaylist.stations} source="home-calm-playlist" onPlay={onPlay} /></div>}
    </section>

    {country && <section className="calm-section calm-world" data-calm-world>
      <div className="calm-heading"><div><p>{t('calm.worldKicker')}</p><h2>{t('calm.world')}</h2></div><button className="calm-country-select" onClick={() => setCountryPicker(true)}>{t('calm.allCountries')} ↗</button></div>
      <div className="calm-countries" role="group" aria-label={t('calm.country')}>
        {[...visit.countries.slice(0, 8), ...(visit.countries.slice(0, 8).includes(country) ? [] : [country])].map(c => <button key={c} aria-pressed={country === c} onClick={() => setCountry(c)}>{formatCountryLabel(c)}</button>)}
      </div>

      <CalmCatalogShelf cache={discovery.shelves} key={country} query={{ country }} initial={countryStations} source="home-calm-world" onPlay={onPlay} rows />
    </section>}

    {visit.personal.length > 0 && <section className="calm-section"><div className="calm-heading"><h2>{t('calm.yourStations')}</h2><button onClick={() => setActiveSection('library')}>{t('home.seeAll')} ↗</button></div>
      {visit.personal.map(s => <button className="calm-row" key={s.stationuuid} onClick={() => onPlay(s, visit.personal, 'home-calm-personal')}><StationArtwork station={s} size="sm" /><span><strong>{normalizeStationName(s.name)}</strong><small>{stationLocation(s)}</small></span><span aria-hidden="true">▶</span></button>)}
    </section>}



    {visit.genres.length > 0 && <section className="calm-section calm-genres"><div className="calm-heading"><h2>{t('calm.genreTitle')}</h2><button onClick={() => onSearch('')}>{t('home.seeAll')} ↗</button></div>
      <div className="calm-countries" role="group" aria-label={t('calm.genreTitle')}>{visit.genres.map(group => <button key={group.id} aria-pressed={genre === group.id} onClick={() => setGenre(group.id)}>{t(`calm.directions.${group.id}.eyebrow`)}</button>)}</div>
      {genreGroup && <><CalmCatalogShelf cache={discovery.shelves} key={genreGroup.id} query={{ tag: genreGroup.query }} initial={genreGroup.stations} source="home-calm-genre" onPlay={onPlay} /><button className="calm-more" onClick={() => onSearch(genreGroup.query)}>{t('calm.moreDirection')} ↗</button></>}
    </section>}

    {visit.collections.length > 0 && <section className="calm-section"><div className="calm-heading"><h2>{t('calm.yourPlaylists')}</h2><button onClick={() => { setLibraryTab('collections'); setActiveSection('library'); }}>{t('home.seeAll')} ↗</button></div>
      {visit.collections.slice(0, 3).map(group => <div className="calm-personal-playlist" key={group.id}><div className="calm-heading"><h3>{group.name}</h3><button onClick={() => onPlay(group.stations[0], group.stations, 'home-calm-collection')}>▶ {t('calm.listenSelection')}</button></div>{stationShelf(group.stations, 'home-calm-collection')}</div>)}
    </section>}

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
