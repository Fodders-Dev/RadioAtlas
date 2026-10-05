import type { CSSProperties } from 'react';
import type { UserCollection } from '../domain/contracts';
import type { TrackHistoryItem } from '../state/radio/types';
import type { LibraryTab, StationLite } from '../types';
import { StationArtwork } from '../components/StationArtwork';
import { hashArtworkSeed } from '../lib/artwork';
import './LibraryCollectionHome.css';

type Props = {
  favorites: StationLite[];
  collections: UserCollection[];
  stationFor: (id: string) => StationLite | undefined;
  finds: TrackHistoryItem[];
  queueCount: number;
  recent?: StationLite[];
  queueStations?: StationLite[];
  queueCurrentIndex?: number;
  search: string;
  searchResults: { station: StationLite; source: string }[];
  createOpen: boolean;
  createName: string;
  onSearch: (value: string) => void;
  onPlaySearchStation: (station: StationLite) => void;
  onCreateName: (value: string) => void;
  onSaveCreate: () => void;
  onCancelCreate: () => void;
  onAccount: () => void;
  onSettings: () => void;
  onCreate: () => void;
  onBrowse: (tab: LibraryTab) => void;
  onOpenCollection: (id: string) => void;
  onPlayCollection: (collection: UserCollection) => void;
  onShuffleCollection: (collection: UserCollection) => void;
  onPlayFavorites: () => void;
  onShuffleFavorites: () => void;
  labels: {
    title: string;
    search: string;
    account: string;
    settings: string;
    create: string;
    favorites: string;
    favoritesEmpty: string;
    playlists: string;
    finds: string;
    queue: string;
    recent: string;
    play: string;
    shuffle: string;
    open: string;
    all: string;
    stationCount: (count: number) => string;
    empty: string;
    namePrompt: string;
    save: string;
    cancel: string;
  };
};

const sleevePalettes = [
  { paper: '#d8bda0', ink: '#3f3028', accent: '#8b5546' },
  { paper: '#b8c1a8', ink: '#273126', accent: '#68754f' },
  { paper: '#d8c78f', ink: '#3a321e', accent: '#927040' },
  { paper: '#c7b6bd', ink: '#392c36', accent: '#7e5c71' }
];

export const CollectionSleeve = ({ collection, stations, className = '' }: { collection: UserCollection; stations: StationLite[]; className?: string }) => {
  const hash = hashArtworkSeed(collection.id || collection.name);
  const palette = sleevePalettes[hash % sleevePalettes.length] ?? sleevePalettes[0]!;
  return (
    <span className={`library-sleeve ${className}`} style={{ '--sleeve-paper': palette.paper, '--sleeve-ink': palette.ink, '--sleeve-accent': palette.accent } as CSSProperties} aria-hidden="true">
      <span className={`library-sleeve-motif motif-${(hash >>> 5) % 3}`} />
      <span className="library-sleeve-title">{collection.name}</span>
      <span className="library-sleeve-label">RADIO ATLAS</span>
      {stations.slice(0, 3).length ? <span className="library-sleeve-logos">{stations.slice(0, 3).map((station) => <StationArtwork key={station.stationuuid} station={station} size="sm" />)}</span> : null}
    </span>
  );
};

export const LibraryCollectionHome = (props: Props) => {
  const {
    favorites, collections, stationFor, finds, queueCount, recent = [], queueStations = [], queueCurrentIndex = -1, search, searchResults, createOpen, createName,
    onSearch, onPlaySearchStation, onCreateName, onSaveCreate, onCancelCreate, onAccount, onSettings, onCreate, onBrowse,
    onOpenCollection, onPlayCollection, onShuffleCollection, onPlayFavorites, onShuffleFavorites, labels
  } = props;
  const firstFilled = collections.find((collection) => collection.stationIds.some((id) => stationFor(id)));
  const firstFilledStations = firstFilled?.stationIds.map(stationFor).filter(Boolean) as StationLite[] | undefined;
  const recentFind = finds[0];
  const queuePreview = queueStations.slice(Math.max(0, queueCurrentIndex), Math.max(0, queueCurrentIndex) + 3);

  return (
    <div className="library-preview" data-library-home>
      <header className="library-preview-header">
        <h1>{labels.title}</h1>
        <div className="library-preview-header-actions">
          {collections.length ? <button className="library-preview-icon library-preview-create" type="button" onClick={onCreate} aria-label={labels.create} title={labels.create}><span aria-hidden="true">＋</span></button> : null}
          <button className="library-preview-icon" type="button" onClick={onSettings} aria-label={labels.settings} title={labels.settings}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>
          </button>
          <button className="library-preview-icon" type="button" onClick={onAccount} aria-label={labels.account} title={labels.account}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /></svg>
          </button>
        </div>
      </header>
      <label className="library-preview-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 4a6.5 6.5 0 1 0 4.05 11.58l4.44 4.44 1.41-1.41-4.44-4.44A6.5 6.5 0 0 0 10.5 4Zm0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Z" /></svg>
        <input type="search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder={labels.search} aria-label={labels.search} />
      </label>
      {search.trim() ? <section className="library-preview-search-results" aria-label={labels.search}>
        {searchResults.length ? searchResults.map(({ station, source }) => <button key={station.stationuuid} type="button" onClick={() => onPlaySearchStation(station)}><span><strong>{station.name}</strong><small>{source}</small></span><span>{labels.play}</span></button>) : <p>{labels.empty}</p>}
      </section> : null}
      {createOpen ? <form className="library-preview-create-form" onSubmit={(event) => { event.preventDefault(); onSaveCreate(); }}>
        <input autoFocus value={createName} onChange={(event) => onCreateName(event.target.value)} placeholder={labels.namePrompt} aria-label={labels.namePrompt} />
        <button className="library-preview-primary" type="submit" disabled={!createName.trim()}>{labels.save}</button>
        <button type="button" onClick={onCancelCreate}>{labels.cancel}</button>
      </form> : null}
      {!search.trim() ? <>
        <div className="library-preview-destinations" data-library-destinations>
          <section className="library-preview-favorites" data-library-destination="favorites" aria-label={labels.favorites}>
            <button className="library-preview-favorite-open" type="button" onClick={() => onBrowse('favorites')} aria-label={labels.favorites}>
              <span className="library-preview-destination-head"><span>{labels.favorites}</span><span>{favorites.length} <span aria-hidden="true">↗</span></span></span>
              <span className="library-preview-favorite-stack" aria-hidden="true">{favorites.length ? favorites.slice(0, 4).map(station => <StationArtwork key={station.stationuuid} station={station} size="sm" />) : <svg viewBox="0 0 24 24"><path d="M12 20 4 12a4.5 4.5 0 0 1 6.4-6.4L12 7l1.6-1.4A4.5 4.5 0 0 1 20 12Z" /></svg>}</span>
            </button>
            {favorites.length ? <div className="library-preview-actions"><button className="library-preview-primary" onClick={onPlayFavorites} type="button">{labels.play}</button><button onClick={onShuffleFavorites} type="button" aria-label={labels.shuffle} title={labels.shuffle}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h3l10 12h3M17 15l3 3-3 3M4 18h3l10-12h3M17 3l3 3-3 3" /></svg></button></div> : <small>{labels.empty}</small>}
          </section>
          <button className="library-preview-find" data-library-destination="tracks" type="button" onClick={() => onBrowse('tracks')} aria-label={labels.finds}>
            <span className="library-preview-destination-head"><span>{labels.finds}</span><span>{finds.length} <span aria-hidden="true">↗</span></span></span>
            <svg className="library-preview-find-mark" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="19" /><circle cx="24" cy="24" r="13" /><circle cx="24" cy="24" r="6" /><path d="M29 11v13a4 4 0 1 1-3-4V11l8-2v5" /></svg>
            {recentFind ? <><strong>{recentFind.track}</strong><small>{recentFind.stationName}</small></> : <strong>{labels.empty}</strong>}
          </button>
          <button className="library-preview-queue" data-library-destination="queue" type="button" onClick={() => onBrowse('queue')} aria-label={labels.queue}>
            <span className="library-preview-destination-head"><span>{labels.queue}</span><span>{queueCount} <span aria-hidden="true">↗</span></span></span>
            <span className="library-preview-queue-strip" aria-hidden="true">{queuePreview.length ? queuePreview.map(station => <StationArtwork key={station.stationuuid} station={station} size="sm" />) : <svg viewBox="0 0 24 24"><path d="M4 6h14M4 11h14M4 16h8M17 14l4 3-4 3Z" /></svg>}</span>
            <strong>{queuePreview[0]?.name || (queueCount ? labels.open : labels.empty)}</strong>
          </button>
          <button className="library-preview-recent" data-library-destination="recent" type="button" onClick={() => onBrowse('recent')} aria-label={labels.recent}>
            <span className="library-preview-destination-head"><span>{labels.recent}</span><span aria-hidden="true">↗</span></span>
            <span className="library-preview-recent-art" aria-hidden="true">{recent[0] ? <StationArtwork station={recent[0]} size="sm" /> : <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></svg>}</span>
            <strong>{recent[0]?.name || labels.empty}</strong>
            {recent[0]?.country ? <small>{recent[0].country}</small> : null}
          </button>
        </div>
        {!collections.length ? (
          <section className="library-preview-empty-collections">
            <div><span className="library-preview-overline">{labels.playlists}</span><h2>{labels.empty}</h2></div>
            <button className="library-preview-primary" type="button" onClick={onCreate}>＋ {labels.create}</button>
          </section>
        ) : <div className="library-preview-a-layout">
          {firstFilled ? <section className="library-preview-featured" aria-label={labels.playlists}>
            <button className="library-preview-feature-art" type="button" onClick={() => onOpenCollection(firstFilled.id)} aria-label={`${labels.open}: ${firstFilled.name}`}>
              <CollectionSleeve collection={firstFilled} stations={firstFilledStations ?? []} className="library-preview-artwork" /><span className="library-preview-sleeve-edge" aria-hidden="true" />
            </button>
            <div className="library-preview-feature-copy">
              <span className="library-preview-overline">{labels.playlists}</span><h2>{firstFilled.name}</h2>
              <span className="library-preview-count">{labels.stationCount(firstFilled.stationIds.length)}</span>
              <div className="library-preview-actions"><button className="library-preview-primary" type="button" onClick={() => onPlayCollection(firstFilled)}>{labels.play}</button><button type="button" onClick={() => onShuffleCollection(firstFilled)}>{labels.shuffle}</button></div>
            </div>
          </section> : null}
          <section className="library-preview-playlists">
            <div className="library-preview-section-head"><h2>{labels.playlists}</h2><button type="button" onClick={() => onBrowse('collections')}>{labels.all}</button></div>
            {collections.filter((collection) => collection.id !== firstFilled?.id).slice(0, 4).map((collection) => {
              const stations = collection.stationIds.map(stationFor).filter(Boolean) as StationLite[];
              return <article key={collection.id} className="library-preview-cover-row">
                <button className="library-preview-cover-open" type="button" onClick={() => onOpenCollection(collection.id)} aria-label={`${labels.open}: ${collection.name}`}>
                  <span className="library-preview-cover"><CollectionSleeve collection={collection} stations={stations} className="library-preview-artwork" /><span className="library-preview-sleeve-edge" aria-hidden="true" /></span>
                  <span className="library-preview-cover-copy"><strong>{collection.name}</strong><small>{labels.stationCount(collection.stationIds.length)}</small></span>
                </button>
                {stations.length ? <button className="library-preview-row-play" type="button" onClick={() => onPlayCollection(collection)} aria-label={`${labels.play}: ${collection.name}`}>▶</button> : null}
              </article>;
            })}
          </section>
        </div>}
      </> : null}
    </div>
  );
};
