import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { StationLite } from '../types';
import type { CatalogMoodRail } from '../domain/contracts';
import { useCatalog } from '../state/CatalogContext';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import { useLocale } from '../state/LocaleContext';
import { isAiAssistantEnabled } from '../lib/aiChat';
import { formatCountryLabel, normalizeStationName } from '../lib/stationUtils';
import { calmGenreGroups } from '../lib/calmDiscoveries';
import { stationGenreFamily, type GenreFamily } from '../lib/stationGenre';
import type { ShelfSnapshot } from './CalmCatalogShelf';
import { CalmBrowseSheet } from './CalmBrowseSheet';
import { CalmCountryPicker } from './CalmCountryPicker';
import { CalmPoster } from './CalmPoster';
import { CalmCrossroads, type Crossroad } from './CalmCrossroads';
import { localizedCountry } from '../lib/countryName';
import { CalmLiraFace } from '../components/CalmLiraFace';
import { StationArtwork } from '../components/StationArtwork';
import { CalmSourceSheet } from './CalmSourceSheet';
import { CalmStoriesSheet } from './CalmStoriesSheet';
import { CalmStationRow } from './CalmStationRow';
import { CalmDiscoveryStage } from './CalmDiscoveryStage';
import { buildStories, storyStations, topCountries, type CalmStory } from './calmStories';
import { isFeedBrowseVisitCompatible } from '../lib/feedBrowseVisit';
import { buildCalmCountryDecks, type CalmCountryDeck } from './calmHomeStations';
import { CalmWorldOverview } from './CalmWorldOverview';
import './calm-home-wave.css';

// Home starts with one clear offer and one size-paged live catalogue; deeper
// thematic and geographic exploration follows. Browsing never changes audio.
// Nothing here starts audio except an explicit Play; a Play from the grid
// hands the grid to the queue, so the Feed continues exactly that set.

type Props = {
  station: StationLite;
  stations: StationLite[];
  discoveryStations: StationLite[];
  moodRails: CatalogMoodRail[];
  onPlay: (station: StationLite, playlist: StationLite[], source: string) => void;
  onFeed: (station?: StationLite) => void;
  onSearch: (query: string) => void;
};

type Sheet =
  | { kind: 'trail'; query: Crossroad; title: string; picks: StationLite[] }
  | { kind: 'story'; story: CalmStory }
  | { kind: 'country'; country: string }
  | { kind: 'genre'; id: string; query: string; stations: StationLite[] }
  | null;

type LiveFilter = 'all' | 'favorites' | 'recent' | GenreFamily;
type PendingCountryIntent = { stations: StationLite[]; sourceLabel: string; expectedStationId: string; previousExpectedStationId?: string; baseCurrentStationId: string | null; baseSourceId: string | null; baseStationIds: string[]; observedPending: boolean };
const livePage = () => typeof window === 'undefined' ? 4 : window.innerWidth >= 900 ? 12 : window.innerWidth >= 600 ? 6 : 4;

type DiscoveryVisit = { seed: number; scrollY?: number; shelves: Map<string, ShelfSnapshot>; crossroad: { country: string; tag: string; countries?: string[] }; live?: { filter: LiveFilter; pages: number } };
// SPA-only visit memory: the scroll position and the pages a sheet already
// loaded, so opening the Feed or the Globe and coming back lands where the
// listener left. Public catalogue state only; a reload drops it.
let discoveryVisit: DiscoveryVisit | undefined;
const resumeDiscovery = (seed: number): DiscoveryVisit => {
  if (!discoveryVisit || discoveryVisit.seed !== seed) discoveryVisit = { seed, shelves: new Map(), crossroad: { country: '', tag: 'jazz' } };
  return discoveryVisit;
};

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
);
const ARROW = 'M5 12h14M14 7l5 5-5 5';

const dedupe = (list: StationLite[]) => [...new Map(list.map((s) => [s.stationuuid, s])).values()];

const CalmHomePoster = ({ story, word, lead = false }: { story: CalmStory; word?: string; lead?: boolean }) => {
  return <div className="calm-home-poster">
    <CalmPoster art={story.art} word={word} lead={lead} />
  </div>;
};

export function CalmHome({ station, stations, discoveryStations, moodRails, onPlay, onFeed, onSearch }: Props) {
  const { t, locale } = useLocale();
  const { summary } = useCatalog();
  const { player, nowPlaying, queue, playNext, playStation } = usePlayback();
  const { trackHistory, knownStations, favorites, recent, isStationHiddenFromRecommendations } = useLibrary();
  const { setActiveSection, setLibraryTab, homeState, setGlobeFocusRegionId, setSkinLabOpen, requestChat, getFeedBrowseVisit } = useShell();
  const [discovery] = useState(() => resumeDiscovery(homeState.sessionSeed));
  useLayoutEffect(() => {
    window.scrollTo({ top: discovery.scrollY || 0, behavior: 'instant' });
    return () => { discovery.scrollY = window.scrollY; };
  }, [discovery]);

  // Frozen for the visit: play, save and capture never reshuffle the offers.
  const [visit] = useState(() => {
    const pool = dedupe([station, ...stations, ...discoveryStations])
      .filter((s) => !isStationHiddenFromRecommendations(s.stationuuid) && s.lastcheckok !== 0);
    const rails = moodRails.map((rail) => ({ ...rail, stations: rail.stations.filter((s) => !isStationHiddenFromRecommendations(s.stationuuid) && s.lastcheckok !== 0) }));
    const stories = buildStories(pool, rails);
    const lead = stories[0];
    const leadStations = lead ? storyStations(lead, pool, rails) : [];
    return {
      station,
      pool,
      rails,
      stories,
      lead,
      // «Включай» plays the surface's own recommendation, so it is the first
      // visible starter — the listener sees what the button will start.
      storySources: leadStations,
      starters: leadStations.slice(0, typeof window !== 'undefined' && window.innerWidth >= 600 ? 3 : 2),
      countries: topCountries(pool, typeof window !== 'undefined' && window.innerWidth >= 600 ? 6 : 3),
      around: summary?.aroundTheWorld && summary.aroundTheWorld.stations.length ? { label: summary.aroundTheWorld.label, stations: summary.aroundTheWorld.stations.filter((s) => s.lastcheckok !== 0).slice(0, typeof window !== 'undefined' && window.innerWidth >= 600 ? 6 : 3) } : null,
      genres: calmGenreGroups(pool).slice(0, typeof window !== 'undefined' && window.innerWidth >= 900 ? 12 : 8),
      finds: trackHistory.slice(0, 2)
    };
  });
  const [sheet, setSheet] = useState<Sheet>(null);
  const [source, setSource] = useState<StationLite | null>(null);
  const [countryPicker, setCountryPicker] = useState(false);
  const [allStories, setAllStories] = useState(false);
  const [waveStationId, setWaveStationId] = useState('');
  const [countryIntent, setCountryIntent] = useState<PendingCountryIntent | null>(null);
  useEffect(() => () => { discovery.scrollY = window.scrollY; }, [discovery]);

  // The choice: the visit's pool, the listener's own stations first, and the
  // quick narrowings that exist in it — never a chip that yields nothing.
  const [pageSize, setPageSize] = useState(livePage);
  useEffect(() => {
    const onResize = () => setPageSize(livePage());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const [liveFilter, setLiveFilter] = useState<LiveFilter>(discovery.live?.filter ?? 'all');
  const [livePages, setLivePages] = useState(discovery.live?.pages ?? 1);
  const liveShown = pageSize * livePages;
  const countryDecks = useMemo(() => buildCalmCountryDecks(visit.pool), [visit.pool]);
  useEffect(() => { discovery.live = { filter: liveFilter, pages: livePages }; }, [discovery, liveFilter, livePages]);
  const own = useMemo(() => dedupe([...favorites, ...recent]).filter((s) => s.lastcheckok !== 0), [favorites, recent]);
  const liveAll = useMemo(() => dedupe([...own, ...visit.pool]), [own, visit.pool]);
  const liveChips = useMemo(() => {
    const families = new Map<GenreFamily, number>();
    liveAll.forEach((s) => { const family = stationGenreFamily(s); if (family) families.set(family, (families.get(family) ?? 0) + 1); });
    const chips: Array<{ id: LiveFilter; label: string; count: number }> = [{ id: 'all', label: t('journal.liveAll'), count: liveAll.length }];
    const eligibleFavorites = dedupe(favorites).filter((s) => s.lastcheckok !== 0);
    const eligibleRecent = dedupe(recent).filter((s) => s.lastcheckok !== 0);
    if (eligibleFavorites.length) chips.push({ id: 'favorites', label: t('journal.liveFavorites'), count: eligibleFavorites.length });
    if (eligibleRecent.length) chips.push({ id: 'recent', label: t('journal.liveRecent'), count: eligibleRecent.length });
    [...families.entries()].filter(([, count]) => count >= 3).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .forEach(([family, count]) => chips.push({ id: family, label: t(`mapExplorer.families.${family}`), count }));
    return chips;
  }, [favorites, liveAll, recent, t]);
  const liveList = useMemo(() => {
    if (liveFilter === 'favorites') return dedupe(favorites).filter((s) => s.lastcheckok !== 0);
    if (liveFilter === 'recent') return dedupe(recent).filter((s) => s.lastcheckok !== 0);
    if (liveFilter === 'all') return liveAll;
    return liveAll.filter((s) => stationGenreFamily(s) === liveFilter);
  }, [favorites, liveAll, liveFilter, recent]);
  const liveVisible = liveList.slice(0, liveShown);
  const selectLive = (id: LiveFilter) => { setLiveFilter(id); setLivePages(1); };

  // During a Home country start, the shared queue commits only after the first
  // stream succeeds. Keep its explicit snapshot authoritative while that play
  // is pending so rapid Next stays inside the selected country.
  const queueIds = queue.items.map((item) => item.stationuuid);
  const queueMatchesCountryIntent = Boolean(countryIntent && queue.sourceId === 'home-country'
    && queueIds.length === countryIntent.stations.length
    && queueIds.every((id, index) => id === countryIntent.stations[index]?.stationuuid));
  const baseQueueStillCurrent = countryIntent
    && queue.sourceId === countryIntent.baseSourceId
    && queueIds.length === countryIntent.baseStationIds.length
    && queueIds.every((id, index) => id === countryIntent.baseStationIds[index]);
  const authoritativeStationId = player.pending?.stationuuid ?? player.current?.stationuuid ?? null;
  const countryIntentPending = Boolean(countryIntent && !queueMatchesCountryIntent && baseQueueStillCurrent
    && (authoritativeStationId === countryIntent.expectedStationId
      || authoritativeStationId === countryIntent.previousExpectedStationId
      || (!countryIntent.observedPending && authoritativeStationId === countryIntent.baseCurrentStationId)));
  useEffect(() => {
    if (!countryIntent) return;
    if (queueMatchesCountryIntent || !baseQueueStillCurrent) { setCountryIntent(null); return; }
    if (player.pending?.stationuuid === countryIntent.expectedStationId && !countryIntent.observedPending) {
      setCountryIntent({ ...countryIntent, observedPending: true });
      return;
    }
    const authoritativeId = player.pending?.stationuuid ?? player.current?.stationuuid;
    if (countryIntent.observedPending && authoritativeId !== countryIntent.expectedStationId) setCountryIntent(null);
  }, [baseQueueStillCurrent, countryIntent, player.current?.stationuuid, player.pending?.stationuuid, queueMatchesCountryIntent]);
  const listener = player.pending ?? player.current ?? null;
  const offer = listener ?? visit.station;
  const onAir = player.current?.stationuuid === offer.stationuuid && player.isPlaying && !player.pending;
  // Keep Home's status vocabulary aligned with the calm Feed. A pending
  // restored station is idle/paused, while only the player's buffering state
  // earns the connecting label; otherwise a failed or starting row reads as
  // paused even though its next action is retry or resume.
  const listenerStatus = !listener
    ? 'idle'
    : player.status === 'error'
      ? 'error'
      : listener && player.pending?.stationuuid === listener.stationuuid && player.status === 'buffering'
        ? 'buffering'
        : player.isPlaying && player.current?.stationuuid === listener.stationuuid
          ? 'playing'
          : player.status === 'buffering'
            ? 'buffering'
            : 'paused';
  const listenerStatusLabel = listenerStatus === 'error'
    ? t('journal.feedFailed')
    : listenerStatus === 'playing'
      ? t('journal.nowOnAir')
      : listenerStatus === 'buffering'
        ? t('journal.feedConnecting')
        : t('journal.nowPaused');
  const liveTrack = onAir && nowPlaying ? nowPlaying.trim() : '';
  const queueIndex = listener ? queue.items.findIndex((item) => item.stationuuid === listener.stationuuid) : -1;
  const queueOwnsListener = !countryIntentPending && queueIndex >= 0;
  const stageDeck = countryIntentPending && countryIntent ? countryIntent.stations : queueOwnsListener ? queue.items : visit.pool;
  const stageIndex = countryIntentPending && countryIntent ? Math.max(0, stageDeck.findIndex((item) => item.stationuuid === countryIntent.expectedStationId))
    : queueOwnsListener ? queueIndex
      : Math.max(0, stageDeck.findIndex((item) => item.stationuuid === offer.stationuuid));
  const stageNext = stageDeck.slice(stageIndex + 1, stageIndex + 4);
  const stageHasNext = stageIndex >= 0 && stageIndex < stageDeck.length - 1;
  const startHomeDeck = (selected = visit.station) => playStation(selected, {
    playlist: visit.pool,
    sourceId: 'home-calm',
    sourceLabel: t('journal.stageQueue')
  });
  const openNewDeck = () => {
    const activeId = offer.stationuuid;
    const nextDeck = visit.pool.filter((item) => item.stationuuid !== activeId);
    const first = nextDeck[0];
    if (first) playStation(first, { playlist: nextDeck, sourceId: 'home-calm', sourceLabel: t('journal.stageQueue') });
  };
  const startCountryDeck = (deck: CalmCountryDeck, station?: StationLite) => {
    const first = station && deck.stations.some((item) => item.stationuuid === station.stationuuid) ? station : deck.stations[0];
    if (!first) return;
    const sourceLabel = localizedCountry({ country: deck.country, countrycode: deck.countrycode }, locale);
    setWaveStationId(first.stationuuid);
    setCountryIntent({ stations: deck.stations, sourceLabel, expectedStationId: first.stationuuid, baseCurrentStationId: player.pending?.stationuuid ?? player.current?.stationuuid ?? null, baseSourceId: queue.sourceId, baseStationIds: queueIds, observedPending: false });
    playStation(first, {
      playlist: deck.stations,
      sourceId: 'home-country',
      sourceLabel
    });
  };
  const ai = isAiAssistantEnabled();
  const openGlobe = (country: string) => { setGlobeFocusRegionId(country); setActiveSection('globe'); };
  const openLibrary = (tab: 'tracks' | 'collections' | 'favorites') => { setLibraryTab(tab); setActiveSection('library'); };
  const storyTitle = (story: CalmStory) => t(`journal.stories.${story.copyKey}.title`);
  const storyKicker = (story: CalmStory) => t(`journal.stories.${story.copyKey}.kicker`);
  const storyCopy = (story: CalmStory) => t(`journal.stories.${story.copyKey}.copy`);
  const storyWord = (story: CalmStory) => t(`journal.stories.${story.copyKey}.poster`);
  const stories = useMemo(() => visit.stories.slice(1), [visit.stories]);
  const offerFamily = stationGenreFamily(offer);
  const openBrowseFeed = () => {
    const currentStationId = (player.current ?? player.pending)?.stationuuid ?? null;
    const queueIds = queue.items.map((item) => item.stationuuid);
    if (isFeedBrowseVisitCompatible(getFeedBrowseVisit(), queue.sourceId, currentStationId, queueIds)) setActiveSection('feed');
    else onFeed(listener ?? offer);
  };
  const renderLiveRow = (s: StationLite, playlist: StationLite[]) => {
    const current = listener?.stationuuid === s.stationuuid;
    const currentOnAir = current && player.current?.stationuuid === s.stationuuid && player.isPlaying && !player.pending;
    const name = normalizeStationName(s.name);
    const family = stationGenreFamily(s);
    const meta = current
      ? listenerStatusLabel
      : [localizedCountry(s, locale), family ? t(`mapExplorer.families.${family}`) : ''].filter(Boolean).join(' · ');
    const actionLabel = current
      ? `${player.status === 'error' ? t('dock.retry') : currentOnAir ? t('common.pause') : t('common.play')}: ${name}`
      : t('journal.playStation', { name });
    return <article key={s.stationuuid} className="calm-live-row" data-calm-live-station={s.stationuuid} data-current={current || undefined} data-live-playing={currentOnAir || undefined} data-genre-family={family || undefined}>
      <button className="calm-live-open calm-row-play" onClick={() => {
        if (current && listenerStatus === 'buffering') return;
        if (current && currentOnAir) void player.toggle();
        else if (current && player.status !== 'error' && player.current?.stationuuid === s.stationuuid) void player.toggle();
        else onPlay(s, playlist, 'home-live');
      }} aria-label={actionLabel}>
        <StationArtwork station={s} size="sm" className="calm-row-art" />
        <span className="calm-live-copy"><strong>{name}</strong><small>{meta}</small></span>
        <span className="calm-live-play-icon" aria-hidden="true">
          <Icon d={currentOnAir ? 'M8 5h3v14H8zM13 5h3v14h-3z' : 'M7 4l12 8-12 8V4z'} />
        </span>
      </button>
      <button className="calm-icon calm-live-info" onClick={() => setSource(s)} aria-label={t('journal.sourceOpen', { name })}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 10.5v5M12 7.5h.01" /></svg>
      </button>
    </article>;
  };

  return <div className="calm-home calm-journal" data-calm-home>
    {sheet?.kind === 'trail' && <CalmBrowseSheet title={sheet.title} kicker={t('journal.crossroads.kicker')} query={sheet.query} picks={sheet.picks} cache={discovery.shelves} source="home-trail" onPlay={onPlay} onSource={setSource} onClose={() => setSheet(null)} />}
    {sheet?.kind === 'story' && <CalmBrowseSheet title={storyTitle(sheet.story)} kicker={storyKicker(sheet.story)} copy={storyCopy(sheet.story)} art={sheet.story.art} word={storyWord(sheet.story)} query={sheet.story.query} picks={storyStations(sheet.story, visit.pool, visit.rails)} queue={storyStations(sheet.story, visit.pool, visit.rails)} cache={discovery.shelves} source={`home-story-${sheet.story.id}`} onPlay={onPlay} onSource={setSource} onClose={() => setSheet(null)} />}
    {sheet?.kind === 'country' && <CalmBrowseSheet title={formatCountryLabel(sheet.country)} kicker={t('journal.mapTitle')} query={{ country: sheet.country }} picks={visit.pool.filter((s) => s.country.trim() === sheet.country)} cache={discovery.shelves} source="home-country" onPlay={onPlay} onSource={setSource} onClose={() => setSheet(null)} />}
    {sheet?.kind === 'genre' && <CalmBrowseSheet title={t(`calm.directions.${sheet.id}.eyebrow`)} kicker={t('journal.genresTitle')} query={{ tag: sheet.query }} picks={sheet.stations} cache={discovery.shelves} source="home-genre" onPlay={onPlay} onSource={setSource} onClose={() => setSheet(null)} />}
    {source && <CalmSourceSheet station={source} onClose={() => setSource(null)} onPlay={(s) => {
      const queuedIndex = queue.items.findIndex((item) => item.stationuuid === s.stationuuid);
      if (queuedIndex >= 0) queue.playAtIndex(queuedIndex);
      else onPlay(s, [s], 'home-source');
    }} />}
    {countryPicker && <CalmCountryPicker initial={visit.countries} selected="" onSelect={openGlobe} onClose={() => setCountryPicker(false)} />}
    {allStories && <CalmStoriesSheet stories={visit.stories} onSelect={(story) => setSheet({ kind: 'story', story })} onClose={() => setAllStories(false)} />}

    <header className="calm-journal-heading">
      <h1>{t('journal.heading')}</h1>
      <div>
        <button className="calm-icon calm-glass" aria-label={t('journal.search')} onClick={() => onSearch('')}><Icon d="M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0" /></button>
        <button className="calm-icon calm-glass" aria-label={t('journal.appearance')} onClick={() => setSkinLabOpen(true)}><Icon d="M12 3a9 9 0 1 0 0 18c3 0 1-3 3-4s6 1 6-5a9 9 0 0 0-9-9M7 8h.01M12 6h.01M17 9h.01M6 13h.01" /></button>
      </div>
    </header>

    <CalmDiscoveryStage
      station={offer}
      status={listenerStatus}
      statusLabel={listenerStatusLabel}
      country={localizedCountry(offer, locale)}
      details={[offer.state.trim(), offerFamily ? t(`mapExplorer.families.${offerFamily}`) : ''].filter(Boolean).join(' · ')}
      track={liveTrack}
      hasListener={Boolean(listener)}
      isPlaying={onAir}
      canRetry={listenerStatus === 'error'}
      nextStations={stageNext}
      queueSource={countryIntentPending && countryIntent ? countryIntent.sourceLabel : queueOwnsListener ? queue.sourceLabel || '' : ''}
      hasNext={stageHasNext}
      canDiscover={visit.pool.some((item) => item.stationuuid !== offer.stationuuid)}
      onPlay={() => {
        if (listenerStatus === 'buffering') return;
        if (onAir) { void player.toggle(); return; }
        if (countryIntentPending && countryIntent) {
          const selected = listener ?? countryIntent.stations.find((item) => item.stationuuid === countryIntent.expectedStationId);
          if (!selected) return;
          setCountryIntent({ ...countryIntent, expectedStationId: selected.stationuuid, observedPending: false });
          playStation(selected, { playlist: countryIntent.stations, sourceId: 'home-country', sourceLabel: countryIntent.sourceLabel });
          return;
        }
        if (listenerStatus === 'error' && queueOwnsListener) { queue.playAtIndex(queueIndex); return; }
        if (!listener || !queueOwnsListener) { startHomeDeck(listener ?? visit.station); return; }
        void player.toggle();
      }}
      onNext={() => {
        if (!stageHasNext) { openNewDeck(); return; }
        if (queueOwnsListener) { playNext(); return; }
        if (countryIntentPending && countryIntent) {
          const next = stageDeck[stageIndex + 1];
          setCountryIntent({ ...countryIntent, expectedStationId: next.stationuuid, previousExpectedStationId: countryIntent.expectedStationId, observedPending: false });
          playStation(next, { playlist: countryIntent.stations, sourceId: 'home-country', sourceLabel: countryIntent.sourceLabel });
          return;
        }
        startHomeDeck(stageDeck[stageIndex + 1]);
      }}
      onDiscover={openNewDeck}
      onSource={() => setSource(offer)}
      onFeed={openBrowseFeed}
      onGlobe={() => setActiveSection('globe')}
      waveOnStation={waveStationId === offer.stationuuid}
      worldOverview={<CalmWorldOverview
        decks={countryDecks}
        activeStation={offer}
      playingStationId={onAir ? player.current?.stationuuid ?? null : null}
        onPlay={startCountryDeck}
        onMap={openGlobe}
        onAllCountries={() => setCountryPicker(true)}
      />}
    />

    <div className="calm-home-first-row">
    <div className="calm-home-intro">
      {stories.length > 0 && <section className="calm-section calm-home-moods" data-calm-stories>
          <div className="calm-heading"><h2>{t('journal.moods')}</h2><button className="calm-text" data-calm-stories-all onClick={() => setAllStories(true)}>{t('journal.moodsMore')} <Icon d={ARROW} /></button></div>
          <div className="calm-story-rail">{stories.map((story) => <button key={story.id} className="calm-story" data-calm-story={story.id} onClick={() => setSheet({ kind: 'story', story })}>
            <CalmHomePoster story={story} word={storyWord(story)} />
            <span className="calm-story-caption"><span><small>{storyKicker(story)}</small><strong>{storyTitle(story)}</strong></span></span>
          </button>)}</div>
        </section>}

    </div>
      <div className="calm-home-radio">
        <section className="calm-section calm-live" data-calm-live data-calm-live-catalog>
          <div className="calm-heading"><h2>{t('journal.liveTitle')}</h2><button className="calm-text" onClick={() => onSearch('')}>{t('journal.liveCatalog')} <Icon d={ARROW} /></button></div>
          <div className="calm-live-chips" role="group" aria-label={t('journal.liveTitle')}>
            {liveChips.map((chip) => <button key={chip.id} className="calm-chip" aria-pressed={liveFilter === chip.id} data-calm-live-filter={chip.id} onClick={() => selectLive(chip.id)}>{chip.label} · {chip.count}</button>)}
          </div>
          <div className="calm-live-list">{liveVisible.map((s) => renderLiveRow(s, liveVisible))}</div>
          <div className="calm-live-foot">
            <small>{t('journal.liveCount', { shown: String(liveVisible.length), total: String(liveList.length) })}</small>
            {liveVisible.length < liveList.length
              ? <button className="calm-more-live" data-calm-live-more onClick={() => setLivePages((pages) => pages + 1)}>{t('journal.liveMore')}</button>
              : <button className="calm-more-live" onClick={() => onSearch('')}>{t('journal.liveCatalog')}</button>}
          </div>
        </section>
      </div>
    </div>
    <div className="calm-home-discovery">

        {visit.lead && <section className="calm-section calm-lead" data-calm-lead={visit.lead.id}>
          <button className="calm-story calm-story-lead" onClick={() => setSheet({ kind: 'story', story: visit.lead as CalmStory })}>
            <CalmHomePoster story={visit.lead} word={storyWord(visit.lead)} lead />
            <span className="calm-story-caption"><span><small>{storyKicker(visit.lead)}</small><strong>{storyTitle(visit.lead)}</strong></span><span>{t('journal.openStory')} <Icon d={ARROW} /></span></span>
          </button>
          {visit.starters.length > 0 && <div className="calm-starters"><span className="calm-eyebrow">{t('journal.storySources')}</span>
            <div className="calm-rows">{visit.starters.map((s) => <CalmStationRow key={s.stationuuid} station={s} onPlay={() => onPlay(s, visit.storySources, 'home-starter')} onOpen={() => setSource(s)} />)}</div>
          </div>}
        </section>}

        {visit.around && <section className="calm-section calm-country-issue" data-calm-around>
          <div className="calm-heading"><div><h2>{t('journal.aroundTitle')}</h2><p className="calm-section-copy">{localizedCountry({ country: visit.around.label }, locale)} · {t('journal.aroundCopy')}</p></div></div>
          <div className="calm-rows">{visit.around.stations.map((s) => <CalmStationRow key={s.stationuuid} station={s} onPlay={() => onPlay(s, visit.around!.stations, 'home-around')} onOpen={() => setSource(s)} />)}</div>
          <div className="calm-row-actions"><button className="calm-text" onClick={() => setSheet({ kind: 'country', country: visit.around!.label })}>{t('calm.moreStations')} <Icon d={ARROW} /></button><button className="calm-text" onClick={() => openGlobe(visit.around!.label)}>{t('journal.aroundMore')} <Icon d={ARROW} /></button></div>
        </section>}

        <CalmCrossroads memory={discovery.crossroad} countries={visit.countries} onOpen={(query, title, picks) => setSheet({ kind: 'trail', query, title, picks })} onPlay={onPlay} onSource={setSource} onMap={openGlobe} />

        <section className="calm-section calm-detours" data-calm-detours>
          <div className="calm-heading"><div><span className="calm-eyebrow">{t('journal.detours.kicker')}</span><h2>{t('journal.detours.title')}</h2></div></div>
          <div className="calm-detour-grid">{['dub', 'afrobeat', 'bossa nova', 'experimental'].map((tag, index) => <button key={tag} className={`calm-detour calm-detour-${index}`} onClick={() => setSheet({ kind: 'trail', query: { tag, tagExact: true }, title: t(`journal.detours.names.${index}`), picks: visit.pool.filter(s => s.tags.split(',').some(value => value.trim().toLowerCase() === tag)) })}>
            <span className="calm-detour-art" aria-hidden="true" /><small>{String(index + 1).padStart(2, '0')} / RADIOATLAS</small><strong>{t(`journal.detours.names.${index}`)}</strong><span>{t(`journal.detours.copy.${index}`)}</span><i aria-hidden="true">↗</i>
          </button>)}</div>
        </section>

        {visit.genres.length > 0 && <section className="calm-section" data-calm-genres>
          <div className="calm-heading"><h2>{t('journal.genresTitle')}</h2><button className="calm-text" onClick={() => onSearch('')}>{t('journal.genresAll')} <Icon d={ARROW} /></button></div>
          <div className="calm-genre-grid">{visit.genres.map((group) => <button key={group.id} className="calm-genre-door" onClick={() => setSheet({ kind: 'genre', id: group.id, query: group.query, stations: group.stations })}><strong>{t(`journal.genreNames.${group.id}`)}</strong><small>{normalizeStationName(group.stations[0].name)}</small><span aria-hidden="true">↗</span></button>)}</div>
        </section>}

        <section className="calm-section" data-calm-personal>
          {visit.finds.length > 0 && <>
            <div className="calm-heading"><h2>{t('journal.findsTitle')}</h2><button className="calm-text" onClick={() => openLibrary('tracks')}>{t('home.seeAll')} <Icon d={ARROW} /></button></div>
            {visit.finds.map((find) => {
              const findSource = knownStations.find((s) => s.stationuuid === find.stationId);
              return <article className="calm-saved-find" key={find.id}>
                <Icon d="M6 3h12v18l-6-4-6 4V3Z" />
                <div><strong>{find.track}</strong><small>{find.stationName}</small>
                  {findSource && <button className="calm-text" onClick={() => setSource(findSource)}>{t('journal.backToSource')} <Icon d={ARROW} /></button>}
                </div>
              </article>;
            })}
          </>}
          {ai && <div className="calm-welcome" data-calm-lira-context>
            <button className="calm-lira-line" onClick={() => requestChat()} data-calm-lira>
              <span className="calm-lira-face" aria-hidden="true"><CalmLiraFace /></span>
              <span><strong>{t('journal.liraName')}</strong><span>{t('journal.liraLine')}</span></span>
            </button>
          </div>}
          <button className="calm-teaser calm-find" onClick={() => openLibrary('tracks')}>
            <Icon d="M6 3h12v18l-6-4-6 4V3Z" /><span><strong>{t('journal.teaserTitle')}</strong><small>{t('journal.teaserCopy')}</small></span><Icon d={ARROW} />
          </button>
        </section>

      </div>
  </div>;
}
