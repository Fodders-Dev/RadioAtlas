import type { CSSProperties } from 'react';
import type { UserCollection } from '../domain/contracts';
import type { TrackHistoryItem } from '../state/radio/types';
import type { LibraryTab, StationLite } from '../types';
import { StationArtwork } from '../components/StationArtwork';
import { hashArtworkSeed } from '../lib/artwork';
import './LibraryCollectionPreview.css';

export type LibraryPreviewDesign = 'a' | 'b';

type Props = {
  design: LibraryPreviewDesign;
  favorites: StationLite[];
  collections: UserCollection[];
  stationFor: (id: string) => StationLite | undefined;
  finds: TrackHistoryItem[];
  queueCount: number;
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
  onCreate: () => void;
  onExit: () => void;
  onChooseDesign: (design: LibraryPreviewDesign) => void;
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
    create: string;
    favorites: string;
    favoritesEmpty: string;
    playlists: string;
    finds: string;
    queue: string;
    play: string;
    shuffle: string;
    open: string;
    all: string;
    regular: string;
    stationCount: (count: number) => string;
    empty: string;
    namePrompt: string;
    save: string;
    cancel: string;
    variant: string;
    tabFavorites: string;
    tabCollections: string;
    tabFinds: string;
    tabRecent: string;
    tabQueue: string;
  };
};

const sleevePalettes = [
  { paper: '#d8bda0', ink: '#3f3028', accent: '#8b5546' },
  { paper: '#b8c1a8', ink: '#273126', accent: '#68754f' },
  { paper: '#d8c78f', ink: '#3a321e', accent: '#927040' },
  { paper: '#c7b6bd', ink: '#392c36', accent: '#7e5c71' }
];

export const CollectionSleeve = ({ collection, stations, className = '', compact = false }: { collection: UserCollection; stations: StationLite[]; className?: string; compact?: boolean }) => {
  const hash = hashArtworkSeed(collection.id || collection.name);
  const palette = sleevePalettes[hash % sleevePalettes.length] ?? sleevePalettes[0]!;
  return (
    <span className={`library-sleeve ${compact ? 'library-sleeve-compact' : ''} ${className}`} style={{ '--sleeve-paper': palette.paper, '--sleeve-ink': palette.ink, '--sleeve-accent': palette.accent } as CSSProperties} aria-hidden="true">
      <span className={`library-sleeve-motif motif-${(hash >>> 5) % 3}`} />
      <span className="library-sleeve-title">{collection.name}</span>
      <span className="library-sleeve-label">RADIO ATLAS</span>
      {stations.slice(0, 3).length ? <span className="library-sleeve-logos">{stations.slice(0, 3).map((station) => <StationArtwork key={station.stationuuid} station={station} size="sm" />)}</span> : null}
    </span>
  );
};

export const LibraryCollectionPreview = (props: Props) => {
  const {
    design, favorites, collections, stationFor, finds, queueCount, search, searchResults, createOpen, createName,
    onSearch, onPlaySearchStation, onCreateName, onSaveCreate, onCancelCreate, onAccount, onCreate, onExit, onChooseDesign, onBrowse,
    onOpenCollection, onPlayCollection, onShuffleCollection, onPlayFavorites,
    onShuffleFavorites, labels
  } = props;
  const firstFilled = collections.find((collection) => collection.stationIds.some((id) => stationFor(id)));
  const firstFilledStations = firstFilled?.stationIds.map(stationFor).filter(Boolean) as StationLite[] | undefined;
  const recentFind = finds[0];
  const playlists = design === 'a' ? collections : [...collections].sort((a, b) => b.updatedAt - a.updatedAt);
  const availableTabs: { id: LibraryTab; label: string }[] = [
    { id: 'favorites', label: labels.tabFavorites },
    { id: 'collections', label: labels.tabCollections },
    { id: 'tracks', label: labels.tabFinds },
    { id: 'recent', label: labels.tabRecent },
    { id: 'queue', label: labels.tabQueue }
  ];

  return (
    <div className={`library-preview library-preview-${design}`} data-library-design={design}>
      <header className="library-preview-header">
        <div>
          <h1>{labels.title}</h1>
        </div>
        <div className="library-preview-header-actions">
          <div className="library-preview-switch" role="group" aria-label={labels.variant}>
            <button type="button" aria-pressed={design === 'a'} className={design === 'a' ? 'active' : ''} onClick={() => onChooseDesign('a')}>A</button>
            <button type="button" aria-pressed={design === 'b'} className={design === 'b' ? 'active' : ''} onClick={() => onChooseDesign('b')}>B</button>
          </div>
          <button className="library-preview-icon" type="button" onClick={onAccount} aria-label={labels.account} title={labels.account}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /></svg>
          </button>
          <button className="library-preview-icon library-preview-exit" type="button" onClick={onExit}>{labels.regular}</button>
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

      {!search.trim() && design === 'a' ? (
        <>
          {!collections.length ? (
            <section className="library-preview-empty-collections">
              <div>
                <span className="library-preview-overline">{labels.playlists}</span>
                <h2>{labels.empty}</h2>
              </div>
              <button className="library-preview-primary" type="button" onClick={onCreate}>＋ {labels.create}</button>
            </section>
          ) : <div className="library-preview-a-layout">
            {firstFilled ? (
              <section className="library-preview-featured" aria-label={labels.playlists}>
                <button className="library-preview-feature-art" type="button" onClick={() => onOpenCollection(firstFilled.id)} aria-label={`${labels.open}: ${firstFilled.name}`}>
                  <CollectionSleeve collection={firstFilled} stations={firstFilledStations ?? []} className="library-preview-artwork" />
                  <span className="library-preview-sleeve-edge" aria-hidden="true" />
                </button>
                <div className="library-preview-feature-copy">
                  <span className="library-preview-overline">{labels.playlists}</span>
                  <h2>{firstFilled.name}</h2>
                  <span className="library-preview-count">{labels.stationCount(firstFilled.stationIds.length)}</span>
                  <div className="library-preview-actions">
                    <button className="library-preview-primary" type="button" onClick={() => onPlayCollection(firstFilled)}>{labels.play}</button>
                    <button type="button" onClick={() => onShuffleCollection(firstFilled)}>{labels.shuffle}</button>
                  </div>
                </div>
              </section>
            ) : null}
            <section className="library-preview-playlists">
              <div className="library-preview-section-head"><h2>{labels.playlists}</h2><button type="button" onClick={() => onBrowse('collections')}>{labels.all}</button></div>
              {playlists.filter((collection) => collection.id !== firstFilled?.id).slice(0, 4).map((collection) => {
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
          <div className="library-preview-support-row">
            <section className="library-preview-favorites">
              <div className="library-preview-section-head"><h2>{labels.favorites}</h2><button type="button" onClick={() => onBrowse('favorites')}>{labels.all}</button></div>
              {favorites.length ? <div className="library-preview-actions"><button className="library-preview-primary" onClick={onPlayFavorites} type="button">{labels.play}</button><button onClick={onShuffleFavorites} type="button">{labels.shuffle}</button></div> : <button className="library-preview-inline-link" type="button" onClick={() => onBrowse('favorites')}>{labels.favoritesEmpty}</button>}
            </section>
            <button className="library-preview-find" type="button" onClick={() => onBrowse('tracks')}>
              <span className="library-preview-overline">{labels.finds}</span>
              {recentFind ? <><strong>{recentFind.track}</strong><small>{recentFind.stationName}</small></> : <strong>{labels.empty}</strong>}
            </button>
            {queueCount > 0 ? <button className="library-preview-queue" type="button" onClick={() => onBrowse('queue')}>
              <span className="library-preview-overline">{labels.queue}</span><strong>{queueCount}</strong><span>{labels.open}</span>
            </button> : null}
          </div>
          {collections.length ? <button className="library-preview-create" type="button" onClick={onCreate}>＋ {labels.create}</button> : null}
        </>
      ) : !search.trim() ? (
        <>
          <nav className="library-preview-segments" aria-label={labels.all}>
            {availableTabs.map(({ id, label }) => <button type="button" key={id} onClick={() => onBrowse(id)}>{label}<span>{id === 'favorites' ? favorites.length : id === 'collections' ? collections.length : id === 'tracks' ? finds.length : id === 'queue' ? queueCount : ''}</span></button>)}
          </nav>
          <div className="library-preview-b-layout">
            <section className="library-preview-b-list">
              <div className="library-preview-section-head"><h2>{labels.playlists}</h2><button type="button" onClick={onCreate}>{labels.create}</button></div>
              {playlists.length ? playlists.map((collection) => {
                const stations = collection.stationIds.map(stationFor).filter(Boolean) as StationLite[];
                return <article key={collection.id} className="library-preview-b-row">
                  <button className="library-preview-cover" type="button" onClick={() => onOpenCollection(collection.id)} aria-label={`${labels.open}: ${collection.name}`}><CollectionSleeve collection={collection} stations={stations} compact className="library-preview-artwork" /><span className="library-preview-sleeve-edge" aria-hidden="true" /></button>
                  <button className="library-preview-b-copy" type="button" onClick={() => onOpenCollection(collection.id)}><strong>{collection.name}</strong><small>{labels.stationCount(collection.stationIds.length)}</small></button>
                  {stations.length ? <button className="library-preview-row-play" type="button" onClick={() => onPlayCollection(collection)} aria-label={`${labels.play}: ${collection.name}`}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg></button> : <button className="library-preview-row-play" type="button" onClick={() => onOpenCollection(collection.id)} aria-label={`${labels.open}: ${collection.name}`}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8v2H8zM6 7h12v13H6z" /></svg></button>}
                </article>;
              }) : <div className="library-preview-empty-row"><p>{labels.empty}</p><button type="button" onClick={onCreate}>{labels.create}</button></div>}
            </section>
            <aside className="library-preview-b-rail">
              <div className="library-preview-b-tools">
                <div className="library-preview-b-tool"><button type="button" onClick={() => onBrowse('favorites')}><span>{labels.favorites}</span><strong>{favorites.length}</strong></button>{favorites.length ? <button className="library-preview-tool-action" type="button" aria-label={`${labels.shuffle}: ${labels.favorites}`} onClick={onShuffleFavorites}>{labels.shuffle}</button> : null}</div>
                <button className="library-preview-b-tool" type="button" onClick={() => onBrowse('tracks')}><span>{labels.finds}</span><strong>{finds.length ? finds[0]?.track : labels.empty}</strong></button>
                <button className="library-preview-b-tool" type="button" onClick={() => onBrowse('queue')}><span>{labels.queue}</span><strong>{queueCount}</strong></button>
              </div>
            </aside>
          </div>
        </>
      ) : null}
    </div>
  );
};
