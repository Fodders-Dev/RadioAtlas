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
import { localizedCountry, countryCodeOf } from '../lib/countryName';
import { CalmLiraFace } from '../components/CalmLiraFace';
import { StationArtwork } from '../components/StationArtwork';
import { CalmSourceSheet } from './CalmSourceSheet';
import { CalmStoriesSheet } from './CalmStoriesSheet';
import { CalmStationRow } from './CalmStationRow';
import { buildStories, storyStations, topCountries, type CalmStory } from './calmStories';

// Home, rebuilt around one start and a big open choice
// (docs/DISCOVERY-DIRECTION-2026-09-13.md). The «now» card is the station the
// button will start — or the one on air, with its live track — and the two
// entries under it are the ways to change the sound: swipe the Feed, pick a
// dot on the Globe. Then the choice: a grid of real stations with quick
// narrowings and more on demand, the stories, the countries, the rest.
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
const LIVE_PAGE = 10;

type DiscoveryVisit = { seed: number; scrollY?: number; shelves: Map<string, ShelfSnapshot>; crossroad: { country: string; tag: string; countries?: string[] }; live?: { filter: LiveFilter; shown: number } };
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
const FEED_ICON = 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm3 6v6l5-3-5-3ZM12 1v2M12 21v2';
const GLOBE_ICON = 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c-2.5 2.5-3.5 5.5-3.5 9s1 6.5 3.5 9c2.5-2.5 3.5-5.5 3.5-9s-1-6.5-3.5-9ZM3 12h18';

const dedupe = (list: StationLite[]) => [...new Map(list.map((s) => [s.stationuuid, s])).values()];

export function CalmHome({ station, stations, discoveryStations, moodRails, onPlay, onFeed, onSearch }: Props) {
  const { t, locale } = useLocale();
  const { summary } = useCatalog();
  const { player, nowPlaying } = usePlayback();
  const { trackHistory, knownStations, favorites, recent, isStationHiddenFromRecommendations } = useLibrary();
  const { setActiveSection, setLibraryTab, homeState, setGlobeFocusRegionId, setSkinLabOpen, requestChat } = useShell();
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
      starters: dedupe([station, ...leadStations, ...stations]).slice(0, 2),
      countries: topCountries(pool, 3),
      around: summary?.aroundTheWorld && summary.aroundTheWorld.stations.length ? { label: summary.aroundTheWorld.label, stations: summary.aroundTheWorld.stations.filter((s) => s.lastcheckok !== 0).slice(0, 3) } : null,
      genres: calmGenreGroups(pool).slice(0, 8),
      finds: trackHistory.slice(0, 2)
    };
  });
  const [sheet, setSheet] = useState<Sheet>(null);
  const [source, setSource] = useState<StationLite | null>(null);
  const [countryPicker, setCountryPicker] = useState(false);
  const [allStories, setAllStories] = useState(false);
  useEffect(() => () => { discovery.scrollY = window.scrollY; }, [discovery]);

  // The choice: the visit's pool, the listener's own stations first, and the
  // quick narrowings that exist in it — never a chip that yields nothing.
  const [liveFilter, setLiveFilter] = useState<LiveFilter>(discovery.live?.filter ?? 'all');
  const [liveShown, setLiveShown] = useState(discovery.live?.shown ?? LIVE_PAGE);
  useEffect(() => { discovery.live = { filter: liveFilter, shown: liveShown }; }, [discovery, liveFilter, liveShown]);
  const own = useMemo(() => dedupe([...favorites, ...recent]).filter((s) => s.lastcheckok !== 0), [favorites, recent]);
  const liveAll = useMemo(() => dedupe([...own, ...visit.pool]), [own, visit.pool]);
  const liveChips = useMemo(() => {
    const families = new Map<GenreFamily, number>();
    liveAll.forEach((s) => { const family = stationGenreFamily(s); if (family) families.set(family, (families.get(family) ?? 0) + 1); });
    const chips: Array<{ id: LiveFilter; label: string; count: number }> = [{ id: 'all', label: t('journal.liveAll'), count: liveAll.length }];
    if (favorites.length) chips.push({ id: 'favorites', label: t('journal.liveFavorites'), count: favorites.length });
    if (recent.length) chips.push({ id: 'recent', label: t('journal.liveRecent'), count: recent.length });
    [...families.entries()].filter(([, count]) => count >= 3).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .forEach(([family, count]) => chips.push({ id: family, label: t(`mapExplorer.families.${family}`), count }));
    return chips;
  }, [favorites.length, liveAll, recent.length, t]);
  const liveList = useMemo(() => {
    if (liveFilter === 'favorites') return favorites.filter((s) => s.lastcheckok !== 0);
    if (liveFilter === 'recent') return recent.filter((s) => s.lastcheckok !== 0);
    if (liveFilter === 'all') return liveAll;
    return liveAll.filter((s) => stationGenreFamily(s) === liveFilter);
  }, [favorites, liveAll, liveFilter, recent]);
  const liveVisible = liveList.slice(0, liveShown);
  const selectLive = (id: LiveFilter) => { setLiveFilter(id); setLiveShown(LIVE_PAGE); };

  const listener = player.current ?? player.pending ?? null;
  const offer = listener ?? visit.station;
  const onAir = listener?.stationuuid === offer.stationuuid && player.isPlaying;
  const liveTrack = onAir && nowPlaying ? nowPlaying.trim() : '';
  const ai = isAiAssistantEnabled();
  const openGlobe = (country: string) => { setGlobeFocusRegionId(country); setActiveSection('globe'); };
  const openLibrary = (tab: 'tracks' | 'collections' | 'favorites') => { setLibraryTab(tab); setActiveSection('library'); };
  const storyTitle = (story: CalmStory) => t(`journal.stories.${story.copyKey}.title`);
  const storyKicker = (story: CalmStory) => t(`journal.stories.${story.copyKey}.kicker`);
  const storyCopy = (story: CalmStory) => t(`journal.stories.${story.copyKey}.copy`);
  const storyWord = (story: CalmStory) => t(`journal.stories.${story.copyKey}.poster`);
  const stories = useMemo(() => visit.stories.slice(1), [visit.stories]);
  const offerName = normalizeStationName(offer.name);
  const offerFamily = stationGenreFamily(offer);
  const offerLine = [localizedCountry(offer, locale), offerFamily ? t(`mapExplorer.families.${offerFamily}`) : ''].filter(Boolean).join(' · ');

  return <div className="calm-home calm-journal" data-calm-home>
    {sheet?.kind === 'trail' && <CalmBrowseSheet title={sheet.title} kicker={t('journal.crossroads.kicker')} query={sheet.query} picks={sheet.picks} cache={discovery.shelves} source="home-trail" onPlay={onPlay} onSource={setSource} onClose={() => setSheet(null)} />}
    {sheet?.kind === 'story' && <CalmBrowseSheet title={storyTitle(sheet.story)} kicker={storyKicker(sheet.story)} copy={storyCopy(sheet.story)} art={sheet.story.art} word={storyWord(sheet.story)} query={sheet.story.query} picks={storyStations(sheet.story, visit.pool, visit.rails)} cache={discovery.shelves} source={`home-story-${sheet.story.id}`} onPlay={onPlay} onSource={setSource} onClose={() => setSheet(null)} />}
    {sheet?.kind === 'country' && <CalmBrowseSheet title={formatCountryLabel(sheet.country)} kicker={t('journal.mapTitle')} query={{ country: sheet.country }} picks={visit.pool.filter((s) => s.country.trim() === sheet.country)} cache={discovery.shelves} source="home-country" onPlay={onPlay} onSource={setSource} onClose={() => setSheet(null)} />}
    {sheet?.kind === 'genre' && <CalmBrowseSheet title={t(`calm.directions.${sheet.id}.eyebrow`)} kicker={t('journal.genresTitle')} query={{ tag: sheet.query }} picks={sheet.stations} cache={discovery.shelves} source="home-genre" onPlay={onPlay} onSource={setSource} onClose={() => setSheet(null)} />}
    {source && <CalmSourceSheet station={source} onClose={() => setSource(null)} onPlay={(s) => onPlay(s, [s], 'home-source')} />}
    {countryPicker && <CalmCountryPicker initial={visit.countries} selected="" onSelect={openGlobe} onClose={() => setCountryPicker(false)} />}
    {allStories && <CalmStoriesSheet stories={visit.stories} onSelect={(story) => setSheet({ kind: 'story', story })} onClose={() => setAllStories(false)} />}

    <header className="calm-journal-heading">
      <h1>{t('journal.heading')}</h1>
      <div>
        <button className="calm-icon calm-glass" aria-label={t('journal.search')} onClick={() => onSearch('')}><Icon d="M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0" /></button>
        <button className="calm-icon calm-glass" aria-label={t('journal.appearance')} onClick={() => setSkinLabOpen(true)}><Icon d="M12 3a9 9 0 1 0 0 18c3 0 1-3 3-4s6 1 6-5a9 9 0 0 0-9-9M7 8h.01M12 6h.01M17 9h.01M6 13h.01" /></button>
      </div>
    </header>

    {/* One line for the air: idle, the one button and what it starts; on air
        or paused, a status line — the mini player below is the control. */}
    <div className={`calm-air-line ${listener ? 'is-loaded' : ''}`.trim()} data-calm-offer={offer.stationuuid} data-calm-air={onAir ? 'on' : listener ? 'paused' : 'idle'}>
      {listener ? (
        <button className="calm-air-now" onClick={() => onFeed(listener)} aria-label={t('journal.listening')}>
          <StationArtwork station={offer} size="sm" className="calm-air-art" />
          <span><small>{onAir ? t('journal.nowOnAir') : t('journal.nowPaused')}</small><strong>{offerName}</strong>{liveTrack ? <em>{liveTrack}</em> : <em>{offerLine}</em>}</span>
          <Icon d={ARROW} />
        </button>
      ) : (
        <>
          <button className="calm-primary" aria-label={`${t('journal.play')}: ${offerName}`} onClick={() => onPlay(offer, [offer, ...visit.starters], 'home-calm')}>
            <span aria-hidden="true">▶</span>{t('journal.play')}
          </button>
          <button className="calm-air-offer" onClick={() => setSource(offer)} aria-label={t('journal.sourceOpen', { name: offerName })}>
            <StationArtwork station={offer} size="sm" className="calm-air-art" />
            <span><small>{t('journal.nowOffer')}</small><strong>{offerName}</strong><em>{offerLine}</em></span>
          </button>
        </>
      )}
    </div>

    <div className="calm-home-columns">
      <div className="calm-home-lead">
        {/* The two ways to change the sound, drawn as doors: the Feed's own
            art and the Globe's poster. */}
        <section className="calm-section calm-doors" data-calm-doors aria-label={t('journal.doorsLabel')}>
          <button className="calm-door calm-door-feed" data-calm-entry="feed" onClick={() => onFeed(listener ?? offer)}>
            <span className="calm-door-art" aria-hidden="true"><i /></span>
            <span className="calm-door-caption"><b>{t('journal.entryFeed')}</b><small>{t('journal.entryFeedCopy')}</small></span>
            <Icon d={ARROW} />
          </button>
          <button className="calm-door calm-door-globe" data-calm-entry="globe" onClick={() => setActiveSection('globe')}>
            <span className="calm-door-art" aria-hidden="true"><CalmPoster art="world" word={t('journal.entryGlobeWord')} /></span>
            <span className="calm-door-caption"><b>{t('journal.entryGlobe')}</b><small>{t('journal.entryGlobeCopy')}</small></span>
            <Icon d={ARROW} />
          </button>
        </section>

        {ai && <div className="calm-welcome">
          <button className="calm-lira-line" onClick={() => requestChat()} data-calm-lira>
            <span className="calm-lira-face" aria-hidden="true"><CalmLiraFace /></span>
            <span><strong>{t('journal.liraName')}</strong><span>{t('journal.liraLine')}</span></span>
          </button>
        </div>}
      </div>

      <div className="calm-home-body">
        <section className="calm-section calm-live" data-calm-live>
          <div className="calm-heading"><h2>{t('journal.liveTitle')}</h2><button className="calm-text" onClick={() => onSearch('')}>{t('journal.liveCatalog')} <Icon d={ARROW} /></button></div>
          <div className="calm-live-chips" role="group" aria-label={t('journal.liveTitle')}>
            {liveChips.map((chip) => <button key={chip.id} className="calm-chip" aria-pressed={liveFilter === chip.id} data-calm-live-filter={chip.id} onClick={() => selectLive(chip.id)}>{chip.label} · {chip.count}</button>)}
          </div>
          <div className="calm-live-list">
            {liveVisible.map((s, index) => {
              const current = listener?.stationuuid === s.stationuuid;
              const name = normalizeStationName(s.name);
              const family = stationGenreFamily(s);
              const meta = [localizedCountry(s, locale), family ? t(`mapExplorer.families.${family}`) : ''].filter(Boolean).join(' · ');
              return <article key={s.stationuuid} className="calm-live-row" data-calm-live-station={s.stationuuid} data-current={current || undefined}>
                <button className="calm-live-open" onClick={() => setSource(s)} aria-label={t('journal.sourceOpen', { name })}>
                  <span className="calm-live-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                  <StationArtwork station={s} size="sm" className="calm-row-art" />
                  <span><strong>{name}</strong><small>{meta}</small></span>
                </button>
                <button className="calm-icon calm-row-play" onClick={() => { if (current && player.status !== 'error') void player.toggle(); else onPlay(s, liveVisible, 'home-live'); }} aria-label={current && player.isPlaying ? t('common.pause') : t('journal.playStation', { name })}>
                  {current && player.isPlaying ? <Icon d="M8 5h3v14H8zM13 5h3v14h-3z" /> : <Icon d="M7 4l12 8-12 8V4z" />}
                </button>
              </article>;
            })}
          </div>
          <div className="calm-live-foot">
            <small>{t('journal.liveCount', { shown: String(liveVisible.length), total: String(liveList.length) })}</small>
            {liveVisible.length < liveList.length
              ? <button className="calm-more-live" data-calm-live-more onClick={() => setLiveShown((n) => n + LIVE_PAGE)}>{t('journal.liveMore')}</button>
              : <button className="calm-more-live" onClick={() => onSearch('')}>{t('journal.liveCatalog')}</button>}
          </div>
        </section>

        {visit.countries.length > 0 && <section className="calm-section calm-world" data-calm-world>
          <div className="calm-heading"><h2>{t('journal.mapTitle')}</h2><button className="calm-text" onClick={() => setActiveSection('globe')}>{t('journal.mapAll')} <Icon d={ARROW} /></button></div>
          <div className="calm-country-tiles">{visit.countries.map((country, index) => <button key={country} className={`calm-country-tile calm-country-tile-${index}`} data-calm-country-map={country} onClick={() => openGlobe(country)}>
            <span aria-hidden="true">{countryCodeOf({ country }) || '↗'}</span><strong>{localizedCountry({ country }, locale)}</strong><small>{t('journal.exploreCountry')} <Icon d={ARROW} /></small>
          </button>)}</div>
          <button className="calm-text calm-all-countries" onClick={() => setCountryPicker(true)}>{t('calm.allCountries')} <Icon d={ARROW} /></button>
        </section>}

        {visit.lead && <section className="calm-section calm-lead" data-calm-lead={visit.lead.id}>
          <button className="calm-story calm-story-lead" onClick={() => setSheet({ kind: 'story', story: visit.lead as CalmStory })}>
            <CalmPoster art={visit.lead.art} word={storyWord(visit.lead)} lead />
            <span className="calm-story-caption"><span><small>{storyKicker(visit.lead)}</small><strong>{storyTitle(visit.lead)}</strong></span><span>{t('journal.openStory')} <Icon d={ARROW} /></span></span>
          </button>
          {visit.starters.length > 0 && <div className="calm-starters"><span className="calm-eyebrow">{t('journal.startHere')}</span>
            <div className="calm-rows">{visit.starters.map((s) => <CalmStationRow key={s.stationuuid} station={s} onPlay={() => onPlay(s, visit.starters, 'home-starter')} onOpen={() => setSource(s)} />)}</div>
          </div>}
        </section>}

        {stories.length > 0 && <section className="calm-section" data-calm-stories>
          <div className="calm-heading"><h2>{t('journal.moods')}</h2><button className="calm-text" data-calm-stories-all onClick={() => setAllStories(true)}>{t('journal.moodsMore')} <Icon d={ARROW} /></button></div>
          <div className="calm-story-rail">{stories.map((story) => <button key={story.id} className="calm-story" data-calm-story={story.id} onClick={() => setSheet({ kind: 'story', story })}>
            <CalmPoster art={story.art} word={storyWord(story)} />
            <span className="calm-story-caption"><span><small>{storyKicker(story)}</small><strong>{storyTitle(story)}</strong></span></span>
          </button>)}</div>
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
          <button className="calm-teaser calm-find" onClick={() => openLibrary('tracks')}>
            <Icon d="M6 3h12v18l-6-4-6 4V3Z" /><span><strong>{t('journal.teaserTitle')}</strong><small>{t('journal.teaserCopy')}</small></span><Icon d={ARROW} />
          </button>
        </section>

        <section className="calm-section calm-community" data-calm-community>
          <span className="calm-eyebrow">{t('journal.communityKicker')}</span>
          <h3>{t('journal.communityTitle')}</h3>
          <p>{t('journal.communityCopy')}</p>
          <button className="calm-text" onClick={() => openLibrary('collections')}>{t('journal.communityAction')} <Icon d={ARROW} /></button>
        </section>
      </div>
    </div>
  </div>;
}
