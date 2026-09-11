import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { StationLite } from '../types';
import type { CatalogMoodRail } from '../domain/contracts';
import { useCatalog } from '../state/CatalogContext';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import { useLocale } from '../state/LocaleContext';
import { isAiAssistantEnabled } from '../lib/aiChat';
import { formatCountryLabel, normalizeStationName } from '../lib/stationUtils';
import { calmGenreGroups } from '../lib/calmDiscoveries';
import { LiraMark } from '../components/LiraMark';
import type { ShelfSnapshot } from './CalmCatalogShelf';
import { CalmBrowseSheet } from './CalmBrowseSheet';
import { CalmCountryPicker } from './CalmCountryPicker';
import { CalmPoster } from './CalmPoster';
import { CalmSourceSheet } from './CalmSourceSheet';
import { CalmStationRow } from './CalmStationRow';
import { buildStories, storyStations, topCountries, type CalmStory } from './calmStories';

// Home in the A4 «Журнал» composition. One obvious «Включай»; stories that open
// real catalogue shelves with paged continuation; countries that continue on
// the Globe; genres; the listener's own finds. Nothing here starts audio
// except an explicit Play, and saving a find never rebuilds this screen.

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
  | { kind: 'story'; story: CalmStory }
  | { kind: 'country'; country: string }
  | { kind: 'genre'; id: string; query: string; stations: StationLite[] }
  | null;

type DiscoveryVisit = { seed: number; scrollY?: number; shelves: Map<string, ShelfSnapshot> };
// SPA-only visit memory: the scroll position and the pages a sheet already
// loaded, so opening the Feed or the Globe and coming back lands where the
// listener left. Public catalogue state only; a reload drops it.
let discoveryVisit: DiscoveryVisit | undefined;
const resumeDiscovery = (seed: number): DiscoveryVisit => {
  if (!discoveryVisit || discoveryVisit.seed !== seed) discoveryVisit = { seed, shelves: new Map() };
  return discoveryVisit;
};

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
);
const ARROW = 'M5 12h14M14 7l5 5-5 5';

export function CalmHome({ station, stations, discoveryStations, moodRails, onPlay, onFeed, onSearch }: Props) {
  const { t } = useLocale();
  const { summary } = useCatalog();
  const { player } = usePlayback();
  const { trackHistory, knownStations, isStationHiddenFromRecommendations } = useLibrary();
  const { setActiveSection, setLibraryTab, homeState, setGlobeFocusRegionId, setSkinLabOpen, requestChat } = useShell();
  const [discovery] = useState(() => resumeDiscovery(homeState.sessionSeed));
  useLayoutEffect(() => {
    window.scrollTo({ top: discovery.scrollY || 0, behavior: 'instant' });
    return () => { discovery.scrollY = window.scrollY; };
  }, [discovery]);

  // Frozen for the visit: play, save and capture never reshuffle the offers.
  const [visit] = useState(() => {
    const pool = [...new Map([station, ...stations, ...discoveryStations].map((s) => [s.stationuuid, s])).values()]
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
      starters: [station, ...leadStations, ...stations].filter((s, index, all) => all.findIndex((other) => other.stationuuid === s.stationuuid) === index).slice(0, 2),
      countries: topCountries(pool, 3),
      around: summary?.aroundTheWorld && summary.aroundTheWorld.stations.length ? { label: summary.aroundTheWorld.label, stations: summary.aroundTheWorld.stations.filter((s) => s.lastcheckok !== 0).slice(0, 3) } : null,
      genres: calmGenreGroups(pool).slice(0, 8),
      finds: trackHistory.slice(0, 2)
    };
  });
  const [sheet, setSheet] = useState<Sheet>(null);
  const [source, setSource] = useState<StationLite | null>(null);
  const [countryPicker, setCountryPicker] = useState(false);
  useEffect(() => () => { discovery.scrollY = window.scrollY; }, [discovery]);

  const offer = visit.station;
  const onAir = (player.current ?? player.pending)?.stationuuid === offer.stationuuid && player.isPlaying;
  const ai = isAiAssistantEnabled();
  const openGlobe = (country: string) => { setGlobeFocusRegionId(country); setActiveSection('globe'); };
  const openLibrary = (tab: 'tracks' | 'collections' | 'favorites') => { setLibraryTab(tab); setActiveSection('library'); };
  const storyTitle = (story: CalmStory) => t(`journal.stories.${story.copyKey}.title`);
  const storyKicker = (story: CalmStory) => t(`journal.stories.${story.copyKey}.kicker`);
  const storyCopy = (story: CalmStory) => t(`journal.stories.${story.copyKey}.copy`);
  const stories = useMemo(() => visit.stories.slice(1), [visit.stories]);

  return <div className="calm-home calm-journal" data-calm-home>
    {sheet?.kind === 'story' && <CalmBrowseSheet title={storyTitle(sheet.story)} kicker={storyKicker(sheet.story)} copy={storyCopy(sheet.story)} art={sheet.story.art} query={sheet.story.query} picks={storyStations(sheet.story, visit.pool, visit.rails)} cache={discovery.shelves} source={`home-story-${sheet.story.id}`} onPlay={onPlay} onSource={setSource} onClose={() => setSheet(null)} />}
    {sheet?.kind === 'country' && <CalmBrowseSheet title={formatCountryLabel(sheet.country)} kicker={t('journal.mapTitle')} query={{ country: sheet.country }} picks={visit.pool.filter((s) => s.country.trim() === sheet.country)} cache={discovery.shelves} source="home-country" onPlay={onPlay} onSource={setSource} onClose={() => setSheet(null)} />}
    {sheet?.kind === 'genre' && <CalmBrowseSheet title={t(`calm.directions.${sheet.id}.eyebrow`)} kicker={t('journal.genresTitle')} query={{ tag: sheet.query }} picks={sheet.stations} cache={discovery.shelves} source="home-genre" onPlay={onPlay} onSource={setSource} onClose={() => setSheet(null)} />}
    {source && <CalmSourceSheet station={source} onClose={() => setSource(null)} onPlay={(s) => onPlay(s, [s], 'home-source')} />}
    {countryPicker && <CalmCountryPicker initial={visit.countries} selected="" onSelect={openGlobe} onClose={() => setCountryPicker(false)} />}

    <header className="calm-journal-heading">
      <h1>{t('journal.heading')}</h1>
      <div>
        <button className="calm-icon calm-glass" aria-label={t('journal.search')} onClick={() => onSearch('')}><Icon d="M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0" /></button>
        <button className="calm-icon calm-glass" aria-label={t('journal.appearance')} onClick={() => setSkinLabOpen(true)}><Icon d="M12 3a9 9 0 1 0 0 18c3 0 1-3 3-4s6 1 6-5a9 9 0 0 0-9-9M7 8h.01M12 6h.01M17 9h.01M6 13h.01" /></button>
      </div>
    </header>

    <div className="calm-welcome" data-calm-offer={offer.stationuuid}>
      {ai ? (
        <button className="calm-lira-line" onClick={() => requestChat()} data-calm-lira>
          <span className="calm-lira-face" aria-hidden="true"><LiraMark /></span>
          <span><strong>{t('journal.liraName')}</strong><span>{t('journal.liraLine')}</span></span>
        </button>
      ) : (
        <div className="calm-lira-line calm-lira-line-static"><span><strong>{normalizeStationName(offer.name)}</strong><span>{formatCountryLabel(offer.country)}</span></span></div>
      )}
      <button className="calm-primary" aria-label={onAir ? t('journal.listening') : `${t('journal.play')}: ${normalizeStationName(offer.name)}`} onClick={() => (onAir ? onFeed(offer) : onPlay(offer, [offer, ...visit.starters], 'home-calm'))}>
        <span aria-hidden="true">{onAir ? '↗' : '▶'}</span>{onAir ? t('calm.listening') : t('journal.play')}
      </button>
    </div>

    {visit.lead && <section className="calm-section calm-lead" data-calm-lead={visit.lead.id}>
      <button className="calm-story calm-story-lead" onClick={() => setSheet({ kind: 'story', story: visit.lead as CalmStory })}>
        <CalmPoster art={visit.lead.art} lead />
        <span className="calm-story-caption"><small>{storyKicker(visit.lead)}</small><strong>{storyTitle(visit.lead)}</strong><span>{t('journal.openStory')} <Icon d={ARROW} /></span></span>
      </button>
      {visit.starters.length > 0 && <div className="calm-starters"><span className="calm-eyebrow">{t('journal.startHere')}</span>
        <div className="calm-rows">{visit.starters.map((s) => <CalmStationRow key={s.stationuuid} station={s} onPlay={() => onPlay(s, visit.starters, 'home-starter')} onOpen={() => setSource(s)} />)}</div>
      </div>}
    </section>}

    {stories.length > 0 && <section className="calm-section" data-calm-stories>
      <div className="calm-heading"><h2>{t('journal.moods')}</h2></div>
      <div className="calm-story-rail">{stories.map((story) => <button key={story.id} className="calm-story" data-calm-story={story.id} onClick={() => setSheet({ kind: 'story', story })}>
        <CalmPoster art={story.art} />
        <span className="calm-story-caption"><small>{storyKicker(story)}</small><strong>{storyTitle(story)}</strong></span>
      </button>)}</div>
    </section>}

    {visit.countries.length > 0 && <section className="calm-section calm-world" data-calm-world>
      <div className="calm-heading"><h2>{t('journal.mapTitle')}</h2><button className="calm-text" onClick={() => setActiveSection('globe')}>{t('journal.mapAll')} <Icon d={ARROW} /></button></div>
      <p className="calm-section-copy">{t('journal.mapHint')}</p>
      <div className="calm-country-tiles">{visit.countries.map((country, index) => <button key={country} className={`calm-country-tile calm-country-tile-${index}`} data-calm-country-map={country} onClick={() => openGlobe(country)}>
        <span aria-hidden="true">{formatCountryLabel(country).slice(0, 2).toUpperCase()}</span><strong>{formatCountryLabel(country)}</strong><small>{t('journal.exploreCountry')} <Icon d={ARROW} /></small>
      </button>)}</div>
      <button className="calm-text calm-all-countries" onClick={() => setCountryPicker(true)}>{t('calm.allCountries')} <Icon d={ARROW} /></button>
    </section>}

    {visit.around && <section className="calm-section" data-calm-around>
      <div className="calm-heading"><div><h2>{t('journal.aroundTitle')}</h2><p className="calm-section-copy">{formatCountryLabel(visit.around.label)} · {t('journal.aroundCopy')}</p></div></div>
      <div className="calm-rows">{visit.around.stations.map((s) => <CalmStationRow key={s.stationuuid} station={s} onPlay={() => onPlay(s, visit.around!.stations, 'home-around')} onOpen={() => setSource(s)} />)}</div>
      <div className="calm-row-actions"><button className="calm-text" onClick={() => setSheet({ kind: 'country', country: visit.around!.label })}>{t('calm.moreStations')} <Icon d={ARROW} /></button><button className="calm-text" onClick={() => openGlobe(visit.around!.label)}>{t('journal.aroundMore')} <Icon d={ARROW} /></button></div>
    </section>}

    {visit.genres.length > 0 && <section className="calm-section" data-calm-genres>
      <div className="calm-heading"><h2>{t('journal.genresTitle')}</h2><button className="calm-text" onClick={() => onSearch('')}>{t('journal.genresAll')} <Icon d={ARROW} /></button></div>
      <div className="calm-chips">{visit.genres.map((group) => <button key={group.id} className="calm-chip" onClick={() => setSheet({ kind: 'genre', id: group.id, query: group.query, stations: group.stations })}>{t(`calm.directions.${group.id}.eyebrow`)}</button>)}</div>
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
  </div>;
}
