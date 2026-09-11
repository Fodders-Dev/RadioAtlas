import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type MouseEvent } from 'react';
import type { StationLite } from '../types';
import { useCatalog } from '../state/CatalogContext';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import { useLocale } from '../state/LocaleContext';
import { isAiAssistantEnabled } from '../lib/aiChat';
import { resolveNowPlayingTrust } from '../lib/trackTrust';
import { formatCountryLabel, normalizeStationName, stationLocation } from '../lib/stationUtils';
import { stationGenreSlug } from '../lib/stationGenre';
import { GENRE_FAMILIES } from '../domain/contracts';
import {
  countryCounts,
  countryTarget,
  filterPoints,
  finitePoints,
  nextPanelSize,
  orderPoints,
  pluralForm,
  pointColor,
  pointsInBounds,
  type ExplorerPoint,
  type LatLon,
  type PanelSize
} from '../lib/globeExplorer';
import { ExplorerMap, type ExplorerArea, type ExplorerFlight, type ExplorerMapHandle } from '../components/globe/ExplorerMap';
import { StationArtwork } from '../components/StationArtwork';
import { CalmCountryPicker } from './CalmCountryPicker';
import { CalmBrowseSheet } from './CalmBrowseSheet';
import { CalmSourceSheet } from './CalmSourceSheet';
import type { ShelfSnapshot } from './CalmCatalogShelf';
import './globeExplorer.css';

// The calm Globe (A4 «Журнал»). Stations are SOURCES on a map; the find — track
// plus source plus moment — is caught in the player, not here. Exploring the
// map, selecting a source, saving it or asking Лира never changes what is on
// air: playback starts only from an explicit Play.

const WORLD: LatLon = { lat: 25, lon: 0 };
const WORLD_ZOOM = 0.8;
const COUNTRY_ZOOM = 3.1;
const STATION_ZOOM = 6.1;
const PAGE = 20;

type Scope = 'country' | 'world' | 'area';
type ListTitle = 'nearby' | 'inArea' | null;

type Visit = {
  country: string;
  scope: Scope;
  areaIds: string[] | null;
  listTitle: ListTitle;
  query: string;
  selectedId: string | null;
  panelSize: PanelSize;
  mapAll: boolean;
  camera: { center: LatLon; zoom: number } | null;
};

// SPA-session memory so that opening the Feed from the mini player and coming
// back lands on the same country, list and selected source. Public catalogue
// state only; dropped by reload.
let lastVisit: Visit | null = null;

const icon = {
  globe: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm6.9 8h-3a14 14 0 0 0-1.3-5.2A7 7 0 0 1 18.9 11ZM12 5c.9 1.2 1.7 3.3 1.9 6h-3.8c.2-2.7 1-4.8 1.9-6ZM5.1 13h3a14 14 0 0 0 1.3 5.2A7 7 0 0 1 5.1 13Zm3-2h-3a7 7 0 0 1 4.3-5.2A14 14 0 0 0 8.1 11ZM12 19c-.9-1.2-1.7-3.3-1.9-6h3.8c-.2 2.7-1 4.8-1.9 6Zm2.6-.8a14 14 0 0 0 1.3-5.2h3a7 7 0 0 1-4.3 5.2Z" />,
  search: <path d="M10 3a7 7 0 1 0 4.4 12.4l4.6 4.6 1.4-1.4-4.6-4.6A7 7 0 0 0 10 3Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z" />,
  down: <path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6 1.4-1.4Z" />,
  back: <path d="m15 5 1.4 1.4L10.8 12l5.6 5.6L15 19l-7-7 7-7Z" />,
  play: <path d="M8 5v14l11-7L8 5Z" />,
  pause: <path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z" />,
  heart: <path d="M12 20.4 4.9 13.3a4.2 4.2 0 0 1 6-6l1.1 1.1 1.1-1.1a4.2 4.2 0 0 1 6 6L12 20.4Z" />,
  spark: <path d="M12 2.5 14 9l6.5 2-6.5 2-2 6.5-2-6.5L5.5 11 12 9l2-6.5Z" />,
  bookmark: <path d="M6 3h12v18l-6-4-6 4V3Z" />,
  close: <path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4Z" />,
  list: <path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z" />
};

const Icon = ({ name }: { name: keyof typeof icon }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {icon[name]}
  </svg>
);

// A list row / card before the catalogue answers: enough for a name, a place and
// an artwork fallback. Never played or saved — playback resolves the real row.
const stubStation = (point: ExplorerPoint): StationLite => ({
  stationuuid: point.id,
  name: point.name || point.id,
  url_resolved: '',
  homepage: '',
  favicon: '',
  country: point.country,
  state: point.state || '',
  tags: '',
  geo_lat: point.lat,
  geo_long: point.lon
});

export const GlobeExplorer = () => {
  const { t, locale } = useLocale();
  const { fetchPoints, fetchStationById, summary } = useCatalog();
  const { favorites, recent, isFavorite, toggleFavorite, trackHistory } = useLibrary();
  const { player, playStation, nowPlaying, nowPlayingStatus, copyTrack } = usePlayback();
  const {
    globeFocusRegionId,
    setGlobeFocusRegionId,
    globeFocusStationId,
    setGlobeFocusStationId,
    requestChat,
    notify,
    setSearchDraft,
    setActiveSection
  } = useShell();
  const aiEnabled = isAiAssistantEnabled();

  const [points, setPoints] = useState<ExplorerPoint[] | null>(null);
  // Stations the catalogue knows for a country but cannot place: the map never
  // invents a position for them, so the LIST carries them instead (a sparse
  // country like Mongolia has nine stations and not one located).
  const [unlocated, setUnlocated] = useState<Map<string, number>>(() => new Map());
  const [countrySheet, setCountrySheet] = useState(false);
  const [source, setSource] = useState<StationLite | null>(null);
  const shelves = useRef(new Map<string, ShelfSnapshot>());
  const [pointsError, setPointsError] = useState(false);
  const [pointsAttempt, setPointsAttempt] = useState(0);
  // An explicit request (a country tile on Home, «показать на карте») starts a
  // fresh journey; only a plain return to the tab restores the previous one.
  const restored = useRef(globeFocusRegionId || globeFocusStationId ? null : lastVisit);
  const [country, setCountry] = useState(restored.current?.country || '');
  const [scope, setScope] = useState<Scope>(restored.current?.scope || 'country');
  const [areaIds, setAreaIds] = useState<string[] | null>(restored.current?.areaIds || null);
  const [listTitle, setListTitle] = useState<ListTitle>(restored.current?.listTitle || null);
  const [query, setQuery] = useState(restored.current?.query || '');
  const [limit, setLimit] = useState(PAGE);
  const [selectedId, setSelectedId] = useState<string | null>(restored.current?.selectedId || null);
  const [panelSize, setPanelSize] = useState<PanelSize>(restored.current?.panelSize || 'normal');
  // After the listener moved the map the marker layer shows every country, so
  // neighbours are reachable; the list waits for an explicit «Искать здесь».
  const [mapAll, setMapAll] = useState(restored.current?.mapAll || false);
  const [moved, setMoved] = useState(Boolean(restored.current?.mapAll && restored.current.scope === 'country'));
  const [flight, setFlight] = useState<ExplorerFlight | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [countryPicker, setCountryPicker] = useState(false);
  // Stations resolved through the catalogue, keyed by id. A ref plus a version
  // counter: the map must not re-render its layers for every lookup.
  const stationsRef = useRef(new Map<string, StationLite>());
  const [, setStationVersion] = useState(0);
  const mapHandle = useRef<ExplorerMapHandle | null>(null);
  const cameraRef = useRef<Visit['camera']>(restored.current?.camera || null);
  const flightKey = useRef(0);
  const flownRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const queryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    setPointsError(false);
    void fetchPoints()
      .then((response) => {
        if (!alive) return;
        const located = finitePoints(response.items);
        const placed = new Set(located.map((point) => point.id));
        const rest = new Map<string, number>();
        for (const item of response.items) {
          if (placed.has(item.id) || !item.country) continue;
          rest.set(item.country, (rest.get(item.country) || 0) + 1);
        }
        setUnlocated(rest);
        setPoints(located);
      })
      .catch(() => {
        if (alive) setPointsError(true);
      });
    return () => {
      alive = false;
    };
  }, [fetchPoints, pointsAttempt]);

  const counts = useMemo(() => (points ? countryCounts(points) : []), [points]);
  const countries = useMemo(() => counts.map(([name]) => name), [counts]);
  const pointsById = useMemo(() => new Map((points || []).map((point) => [point.id, point])), [points]);

  const fly = useCallback((center: LatLon, zoom: number) => {
    flightKey.current += 1;
    setFlight({ center, zoom, key: flightKey.current });
  }, []);

  const resolveStation = useCallback(
    async (id: string): Promise<StationLite | null> => {
      const cached = stationsRef.current.get(id);
      if (cached) return cached;
      const station = await fetchStationById(id).catch(() => null);
      if (station) {
        stationsRef.current.set(id, station);
        setStationVersion((value) => value + 1);
      }
      return station;
    },
    [fetchStationById]
  );

  const select = useCallback(
    (id: string, focus: boolean) => {
      const point = pointsById.get(id);
      if (!point) return;
      setSelectedId(id);
      setPanelSize('normal');
      if (focus) fly(point, Math.max(mapHandle.current?.zoom() ?? 0, STATION_ZOOM));
      void resolveStation(id).then((station) => {
        if (!station) notify(t('mapExplorer.stationUnavailable'));
      });
    },
    [fly, notify, pointsById, resolveStation, t]
  );

  const jumpToCountry = useCallback(
    (name: string) => {
      if (!points) return;
      setCountry(name);
      setScope('country');
      setAreaIds(null);
      setListTitle(null);
      setQuery('');
      setLimit(PAGE);
      setSelectedId(null);
      setPanelSize('normal');
      setMapAll(false);
      setMoved(false);
      fly(countryTarget(points, name), COUNTRY_ZOOM);
    },
    [fly, points]
  );

  // Arrival, once the map and the points are both here. Where the journey starts:
  // a requested station lands on its own dot when it has real coordinates and on
  // its country otherwise; a requested country flies there; a return from the
  // Feed restores the camera; a cold open picks the station on air, then the
  // listener's own history, then the largest located country. Nothing plays.
  useEffect(() => {
    if (!mapReady || !points || flownRef.current) return;
    flownRef.current = true;
    const hasCountry = (name?: string | null) => Boolean(name && points.some((point) => point.country === name));
    const requestedStation = globeFocusStationId;
    const requestedRegion = globeFocusRegionId?.trim() || '';
    if (requestedStation || requestedRegion) {
      setGlobeFocusStationId(null);
      setGlobeFocusRegionId(null);
    }
    const onAir = player.current ?? player.pending;
    const fallback =
      [country, onAir?.country, recent[0]?.country, favorites[0]?.country].find(hasCountry) || counts[0]?.[0] || country;
    if (requestedStation) {
      const point = pointsById.get(requestedStation);
      if (point) {
        setCountry(point.country || fallback);
        setScope('country');
        setAreaIds(null);
        setListTitle(null);
        setQuery('');
        setMapAll(false);
        select(requestedStation, true);
        return;
      }
      void resolveStation(requestedStation).then((station) => {
        notify(t('mapExplorer.noCoords'));
        jumpToCountry(hasCountry(station?.country) ? (station as StationLite).country : fallback);
      });
      return;
    }
    if (requestedRegion && hasCountry(requestedRegion)) {
      jumpToCountry(requestedRegion);
      return;
    }
    if (country && cameraRef.current) {
      fly(cameraRef.current.center, cameraRef.current.zoom);
      return;
    }
    setCountry(fallback);
    fly(countryTarget(points, fallback), COUNTRY_ZOOM);
  }, [
    mapReady,
    points,
    pointsById,
    counts,
    country,
    favorites,
    recent,
    player.current,
    player.pending,
    globeFocusStationId,
    globeFocusRegionId,
    setGlobeFocusStationId,
    setGlobeFocusRegionId,
    select,
    jumpToCountry,
    resolveStation,
    fly,
    notify,
    t
  ]);

  useEffect(
    () => () => {
      lastVisit = { country, scope, areaIds, listTitle, query, selectedId, panelSize, mapAll, camera: cameraRef.current };
    },
    [country, scope, areaIds, listTitle, query, selectedId, panelSize, mapAll]
  );

  const personalIds = useMemo(() => [...favorites, ...recent].map((station) => station.stationuuid), [favorites, recent]);
  const editorialIds = useMemo(
    () =>
      [
        ...(summary?.moodRails?.flatMap((rail) => rail.stations) || []),
        ...(summary?.trending || []),
        ...(summary?.topVoted || []),
        ...(summary?.catalogPool || [])
      ].map((station) => station.stationuuid),
    [summary]
  );

  const countryPoints = useMemo(() => (points || []).filter((point) => point.country === country), [points, country]);
  const basePoints = useMemo(() => {
    if (!points) return [];
    if (areaIds) {
      const wanted = new Set(areaIds);
      return points.filter((point) => wanted.has(point.id));
    }
    if (scope === 'world') return points;
    return orderPoints(countryPoints, personalIds, editorialIds);
  }, [points, areaIds, scope, countryPoints, personalIds, editorialIds]);
  const results = useMemo(() => filterPoints(basePoints, query, formatCountryLabel), [basePoints, query]);
  const mapPoints = useMemo(() => {
    if (query.trim()) return results;
    return mapAll || scope !== 'country' ? points || [] : countryPoints;
  }, [query, results, mapAll, scope, points, countryPoints]);

  const unlocatedHere = scope === 'country' && !areaIds && !query.trim() ? unlocated.get(country) || 0 : 0;

  const current = player.current ?? player.pending;
  const activeId = current?.stationuuid || null;
  const selectedPoint = selectedId ? pointsById.get(selectedId) || null : null;
  const selectedStation = selectedPoint ? stationsRef.current.get(selectedPoint.id) || stubStation(selectedPoint) : null;
  const selectedIsCurrent = Boolean(selectedId && activeId === selectedId);
  const selectedPlaying = selectedIsCurrent && player.isPlaying;
  const selectedFailed = selectedIsCurrent && player.status === 'error';
  const selectedConnecting = selectedIsCurrent && !selectedFailed && player.status === 'buffering';
  const trust = resolveNowPlayingTrust({
    station: player.current,
    track: nowPlaying,
    metadataStatus: nowPlayingStatus,
    playerStatus: player.status,
    failure: player.failure
  });
  const liveTrack = selectedIsCurrent && player.current ? trust.track : null;
  const trackSaved = Boolean(liveTrack && trackHistory.some((find) => find.stationId === selectedId && find.track === liveTrack));

  const startStation = useCallback(
    async (id: string) => {
      const station = await resolveStation(id);
      if (!station || !station.url_resolved) {
        notify(t('mapExplorer.stationUnavailable'));
        return;
      }
      playStation(station, { sourceId: 'globe-station', sourceLabel: station.country || station.name });
    },
    [notify, playStation, resolveStation, t]
  );

  const toggleSelected = () => {
    if (!selectedId) return;
    if (selectedIsCurrent && current) {
      // Same rule as the mini player: a failed connection retries the station,
      // anything else is pause/resume of what is already on air.
      if (player.status === 'error') playStation(current);
      else void player.toggle();
      return;
    }
    void startStation(selectedId);
  };

  const withStation = (id: string, action: (station: StationLite) => void) => {
    void resolveStation(id).then((station) => {
      if (station) action(station);
      else notify(t('mapExplorer.stationUnavailable'));
    });
  };

  const setArea = (ids: string[], title: ListTitle) => {
    setAreaIds(ids);
    setListTitle(title);
    setScope('area');
    setSelectedId(null);
    setPanelSize('normal');
    setLimit(PAGE);
    setMoved(false);
  };

  const showWorld = () => {
    setScope('world');
    setAreaIds(null);
    setListTitle(null);
    setSelectedId(null);
    setQuery('');
    setLimit(PAGE);
    setMapAll(true);
    setMoved(false);
    fly(WORLD, WORLD_ZOOM);
  };

  const searchHere = () => {
    if (!points) return;
    const area = mapHandle.current?.area();
    if (!area) return;
    setArea(pointsInBounds(points, area.bounds).map((point) => point.id), 'inArea');
  };

  const onUserMove = (area: ExplorerArea) => {
    cameraRef.current = { center: area.center, zoom: area.zoom };
    setMoved(true);
    setMapAll(true);
  };

  const backToList = () => {
    setSelectedId(null);
    setPanelSize('normal');
  };

  const openSearch = () => {
    setPanelSize('expanded');
    window.setTimeout(() => queryRef.current?.focus(), 60);
  };

  const askLira = () => {
    if (!selectedStation) return;
    const name = normalizeStationName(selectedStation.name);
    const place = stationLocation(selectedStation);
    requestChat(t('chat.promptThisStationQuery', { station: place ? `${name} (${place})` : name }));
  };

  const searchCatalogue = () => {
    startTransition(() => {
      setSearchDraft(query.trim());
      setActiveSection('search');
    });
  };

  // Vertical drag on a heading resizes the panel; buttons remain for keyboards
  // and for anyone who prefers a tap. The click that ends a drag is swallowed.
  const gesture = useRef<{ id: number; y: number; size: PanelSize } | null>(null);
  const suppressClickUntil = useRef(0);
  const onPanelPointerDown = (event: PointerEvent<HTMLElement>) => {
    const handle = (event.target as HTMLElement).closest('[data-panel-drag]');
    if (!handle || event.button !== 0) return;
    gesture.current = { id: event.pointerId, y: event.clientY, size: panelSize };
    handle.setPointerCapture(event.pointerId);
  };
  const onPanelPointerUp = (event: PointerEvent<HTMLElement>) => {
    const active = gesture.current;
    if (!active || active.id !== event.pointerId) return;
    gesture.current = null;
    const next = nextPanelSize(event.clientY - active.y, active.size, Boolean(selectedId));
    if (next === active.size) return;
    suppressClickUntil.current = performance.now() + 350;
    setPanelSize(next);
  };
  const onPanelClickCapture = (event: MouseEvent<HTMLElement>) => {
    if (performance.now() < suppressClickUntil.current) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const countLabel = (count: number) => t(`mapExplorer.count.${pluralForm(count, locale)}`, { count: count.toLocaleString(locale) });
  // Until arrival has chosen a country the list has no subject yet: showing
  // «0 эфиров · ничего не найдено» for that half-second would be a lie.
  const listReady = Boolean(points && (scope !== 'country' || country));
  const expanded = panelSize === 'expanded';
  const collapsed = panelSize === 'collapsed';
  const title =
    listTitle === 'nearby'
      ? t('mapExplorer.nearby')
      : listTitle === 'inArea'
        ? t('mapExplorer.inArea')
        : scope === 'world'
          ? t('mapExplorer.wholeWorld')
          : country
            ? formatCountryLabel(country)
            : t('mapExplorer.title');
  const switchLabel = moved || scope !== 'country' ? t('mapExplorer.countries') : country ? formatCountryLabel(country) : t('mapExplorer.countries');
  const genreSlug = selectedStation ? stationGenreSlug(selectedStation) : null;

  const panelHeader = (
    <header className="explorer-heading">
      <button
        className="explorer-title"
        type="button"
        data-panel-drag
        aria-expanded={expanded}
        aria-label={expanded ? t('mapExplorer.collapse') : t('mapExplorer.expand')}
        onClick={() => setPanelSize(expanded ? 'normal' : 'expanded')}
      >
        <strong>{title}</strong>
        <small>{listReady ? t('mapExplorer.listHint') : pointsError ? t('mapExplorer.loadError') : t('mapExplorer.loading')}</small>
      </button>
      <button className="explorer-icon" type="button" aria-label={t('mapExplorer.searchArea')} onClick={openSearch}>
        <Icon name="search" />
      </button>
      <button
        className="explorer-icon explorer-map-toggle"
        type="button"
        aria-label={collapsed ? t('mapExplorer.showList') : t('mapExplorer.moreMap')}
        onClick={() => setPanelSize(collapsed ? 'normal' : 'collapsed')}
      >
        <Icon name={collapsed ? 'list' : 'down'} />
      </button>
    </header>
  );

  return (
    <section
      className="screen screen-globe-explorer"
      data-globe-explorer
      data-panel={panelSize}
      data-selection={selectedId ? 'station' : 'list'}
      data-scope={scope}
      data-ready={listReady ? 'true' : 'false'}
    >
      {countryPicker && (
        <CalmCountryPicker initial={countries} selected={country} onSelect={jumpToCountry} onClose={() => setCountryPicker(false)} />
      )}
      {countrySheet && (
        <CalmBrowseSheet
          title={formatCountryLabel(country)}
          kicker={t('mapExplorer.unlocatedKicker')}
          copy={t('mapExplorer.unlocatedCopy')}
          query={{ country }}
          picks={[]}
          cache={shelves.current}
          source="globe-country"
          onPlay={(station, playlist, sourceId) => playStation(station, { playlist, sourceId })}
          onSource={setSource}
          onClose={() => setCountrySheet(false)}
        />
      )}
      {source && <CalmSourceSheet station={source} onClose={() => setSource(null)} onPlay={(station) => playStation(station, { sourceId: 'globe-country' })} />}
      <div className="explorer-stage">
        {pointsError ? (
          <div className="explorer-map-error" role="status">
            <p>{t('mapExplorer.loadError')}</p>
            <button className="explorer-primary" type="button" onClick={() => setPointsAttempt((value) => value + 1)}>
              {t('calm.retry')}
            </button>
          </div>
        ) : (
          <ExplorerMap
            points={mapPoints}
            selectedId={selectedId}
            activeId={activeId}
            flight={flight}
            handleRef={mapHandle}
            onReady={() => setMapReady(true)}
            onPick={(id) => select(id, false)}
            onGroup={(ids) => {
              setArea(ids, 'nearby');
              // A group opens on the MAP (a split, a fan) as well as in the
              // list: an expanded list would leave the fan under the heading.
              setPanelSize((size) => (size === 'expanded' ? 'normal' : size));
            }}
            onUserMove={onUserMove}
            onError={() => notify(t('mapExplorer.groupFailed'))}
          />
        )}
        <div className="explorer-vignette" aria-hidden="true" />
        <header className="explorer-map-heading">
          <button className="explorer-country-switch" type="button" onClick={() => setCountryPicker(true)} disabled={!points}>
            <Icon name="globe" />
            <span>{switchLabel}</span>
            <Icon name="down" />
          </button>
          <button className="explorer-world" type="button" onClick={showWorld} disabled={!points} aria-pressed={scope === 'world'}>
            <Icon name="globe" />
            <span>{t('mapExplorer.world')}</span>
          </button>
        </header>
        <div className="explorer-legend" role="list" aria-label={t('mapExplorer.legendLabel')} data-explorer-legend>
          {GENRE_FAMILIES.map((family) => (
            <span className="explorer-legend-item" role="listitem" key={family}>
              <i style={{ background: pointColor(family) }} aria-hidden="true" />
              {t(`mapExplorer.families.${family}`)}
            </span>
          ))}
          <span className="explorer-legend-item" role="listitem">
            <i style={{ background: pointColor(undefined) }} aria-hidden="true" />
            {t('mapExplorer.families.unknown')}
          </span>
        </div>
        <div className="explorer-zoom">
          <button className="explorer-icon" type="button" aria-label={t('mapExplorer.zoomIn')} onClick={() => mapHandle.current?.zoomBy(0.8)}>
            +
          </button>
          <button className="explorer-icon" type="button" aria-label={t('mapExplorer.zoomOut')} onClick={() => mapHandle.current?.zoomBy(-0.8)}>
            −
          </button>
        </div>
        {moved && points ? (
          <button className="explorer-search-here" type="button" onClick={searchHere} data-search-here>
            <Icon name="search" />
            <span>{t('mapExplorer.searchHere')}</span>
          </button>
        ) : null}
      </div>

      <section
        className="explorer-panel"
        data-size={panelSize}
        aria-label={t('mapExplorer.panelLabel')}
        onPointerDown={onPanelPointerDown}
        onPointerUp={onPanelPointerUp}
        onPointerCancel={() => {
          gesture.current = null;
        }}
        onClickCapture={onPanelClickCapture}
      >
        {selectedStation && selectedPoint ? (
          <div className="explorer-selection" aria-live="polite" data-selected-station={selectedPoint.id}>
            <div className="source-preview">
              <button
                className="source-preview-title"
                type="button"
                data-panel-drag
                aria-expanded={expanded}
                aria-label={expanded ? t('mapExplorer.hideDetails') : t('mapExplorer.details')}
                onClick={() => setPanelSize(expanded ? 'normal' : 'expanded')}
              >
                <StationArtwork station={selectedStation} size="sm" className="source-preview-art" />
                <span>
                  <small>
                    {[formatCountryLabel(selectedPoint.country), selectedPoint.state].filter(Boolean).join(' · ')}
                    {selectedPlaying
                      ? ` · ${t('mapExplorer.listening')}`
                      : selectedConnecting
                        ? ` · ${t('mapExplorer.connecting')}`
                        : selectedFailed
                          ? ` · ${t('calm.error')}`
                          : ''}
                  </small>
                  <strong>{normalizeStationName(selectedStation.name)}</strong>
                </span>
              </button>
              <button
                className="source-preview-play"
                type="button"
                data-selected-play
                aria-label={
                  selectedPlaying
                    ? t('common.pause')
                    : selectedFailed
                      ? t('dock.retry')
                      : t('mapExplorer.play', { name: normalizeStationName(selectedStation.name) })
                }
                onClick={toggleSelected}
              >
                <Icon name={selectedPlaying ? 'pause' : 'play'} />
              </button>
            </div>
            <div className="source-preview-actions">
              <button className="explorer-text" type="button" onClick={backToList} data-back-to-list>
                <Icon name="back" />
                <span>{t('mapExplorer.backToList')}</span>
              </button>
              {aiEnabled ? (
                <button className="explorer-text" type="button" onClick={askLira} aria-label={t('mapExplorer.askLira')} data-ask-lira>
                  <Icon name="spark" />
                  <span>{t('mapExplorer.lira')}</span>
                </button>
              ) : null}
              <button
                className="explorer-icon source-favorite"
                type="button"
                aria-pressed={isFavorite(selectedPoint.id)}
                aria-label={isFavorite(selectedPoint.id) ? t('mapExplorer.unfavorite') : t('mapExplorer.favorite')}
                onClick={() => withStation(selectedPoint.id, toggleFavorite)}
                data-source-favorite
              >
                <Icon name="heart" />
              </button>
              <button
                className="explorer-icon source-disclosure"
                type="button"
                aria-expanded={expanded}
                aria-label={expanded ? t('mapExplorer.hideDetails') : t('mapExplorer.details')}
                onClick={() => setPanelSize(expanded ? 'normal' : 'expanded')}
                data-source-details
              >
                <Icon name="down" />
              </button>
            </div>
            {expanded ? (
              <div className="source-details">
                <p className="source-details-line">
                  {[stationLocation(selectedStation), genreSlug ? t(`genre.${genreSlug}`) : '', selectedStation.language?.split(',')[0]?.trim()]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {selectedIsCurrent && player.current ? (
                  liveTrack ? (
                    <div className="source-find" data-source-find>
                      <span>
                        <small>{t('mapExplorer.nowPlaying')}</small>
                        <strong>{liveTrack}</strong>
                      </span>
                      <button
                        className="explorer-icon source-capture"
                        type="button"
                        aria-pressed={trackSaved}
                        aria-label={trackSaved ? t('mapExplorer.trackSaved') : t('mapExplorer.saveTrack')}
                        onClick={() => {
                          void copyTrack();
                        }}
                      >
                        <Icon name="bookmark" />
                      </button>
                    </div>
                  ) : (
                    <p className="source-details-note">{t('mapExplorer.noTrack')}</p>
                  )
                ) : (
                  <p className="source-details-note">{t('mapExplorer.startToCatch')}</p>
                )}
                <p className="source-details-note">{t('mapExplorer.heartNote')}</p>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="explorer-list-mode">
            {panelHeader}
            {expanded ? (
              <label className="explorer-search-field">
                <Icon name="search" />
                <input
                  ref={queryRef}
                  type="search"
                  aria-label={t('mapExplorer.searchLabel')}
                  placeholder={t('mapExplorer.searchPlaceholder')}
                  value={query}
                  autoComplete="off"
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setLimit(PAGE);
                  }}
                />
                {query ? (
                  <button
                    className="explorer-icon"
                    type="button"
                    aria-label={t('mapExplorer.clearSearch')}
                    onClick={() => {
                      setQuery('');
                      queryRef.current?.focus();
                    }}
                  >
                    <Icon name="close" />
                  </button>
                ) : null}
              </label>
            ) : null}
            <div className="explorer-list-meta">
              <span data-result-count>{listReady ? countLabel(results.length) : ''}</span>
              {areaIds || scope === 'world' ? (
                <button className="explorer-text" type="button" onClick={() => setCountryPicker(true)}>
                  <Icon name="globe" />
                  <span>{t('mapExplorer.countries')}</span>
                </button>
              ) : null}
            </div>
            <div className="explorer-results" ref={listRef} tabIndex={0} aria-label={t('mapExplorer.listLabel')} data-explorer-results>
              {listReady && results.length === 0 ? (
                <div className="explorer-empty">
                  <p>{t('mapExplorer.empty')}</p>
                  {query.trim() ? (
                    <button className="explorer-text" type="button" onClick={searchCatalogue}>
                      <Icon name="search" />
                      <span>{t('mapExplorer.searchCatalog')}</span>
                    </button>
                  ) : null}
                  {unlocatedHere > 0 ? (
                    <>
                      <p>{t('mapExplorer.unlocated', { count: unlocatedHere })}</p>
                      <button className="explorer-text" type="button" onClick={() => setCountrySheet(true)} data-unlocated-list>
                        <Icon name="search" />
                        <span>{t('mapExplorer.openList')}</span>
                      </button>
                    </>
                  ) : null}
                  <button className="explorer-text" type="button" onClick={() => setCountryPicker(true)}>
                    <Icon name="globe" />
                    <span>{t('mapExplorer.pickCountry')}</span>
                  </button>
                </div>
              ) : null}
              {(listReady ? results : []).slice(0, limit).map((point) => {
                const station = stationsRef.current.get(point.id) || stubStation(point);
                const name = normalizeStationName(station.name);
                const isActive = point.id === activeId;
                return (
                  <div className="explorer-row" key={point.id} data-point-id={point.id} data-active={isActive || undefined}>
                    <button className="explorer-row-name" type="button" aria-label={t('mapExplorer.showOnMap', { name })} onClick={() => select(point.id, true)}>
                      <StationArtwork station={station} size="sm" className="explorer-row-art" />
                      <span>
                        <strong>{name}</strong>
                        <small>
                          <i className="explorer-genre-dot" style={{ background: pointColor(point.genre) }} aria-hidden="true" />
                          {[point.genre ? t(`mapExplorer.families.${point.genre}`) : '', point.state, formatCountryLabel(point.country)].filter(Boolean).join(' · ')}
                        </small>
                      </span>
                    </button>
                    <button
                      className="explorer-icon explorer-row-play"
                      type="button"
                      aria-label={isActive && player.isPlaying ? t('common.pause') : t('mapExplorer.play', { name })}
                      onClick={() => {
                        if (isActive && player.current) void player.toggle();
                        else void startStation(point.id);
                      }}
                    >
                      <Icon name={isActive && player.isPlaying ? 'pause' : 'play'} />
                    </button>
                  </div>
                );
              })}
              {results.length > limit ? (
                <button className="explorer-load-more" type="button" onClick={() => setLimit((value) => value + PAGE)}>
                  <Icon name="down" />
                  <span>{t('mapExplorer.more')}</span>
                </button>
              ) : null}
              {listReady && results.length > 0 && results.length <= limit && unlocatedHere > 0 ? (
                <button className="explorer-load-more" type="button" onClick={() => setCountrySheet(true)} data-unlocated-list>
                  <Icon name="search" />
                  <span>{t('mapExplorer.unlocatedMore', { count: unlocatedHere })}</span>
                </button>
              ) : null}
            </div>
          </div>
        )}
      </section>
    </section>
  );
};
